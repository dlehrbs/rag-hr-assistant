"""[monitoring] 하트비트·이메일알림·알림임계·GPU상태(NVML). lifespan이 heartbeat_loop 구동.
config·state·rag.manager에 의존. ALERT_SETTINGS·HAS_NVML·start_time은 admin 관제 엔드포인트도 공유.
※ 리팩토링으로 main.py에서 이동 — 코드 byte-동일."""
import os
import time
import asyncio
import sqlite3
import logging
import smtplib
from datetime import datetime, timedelta
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from config import FEEDBACK_DB
from state import live_queries
from rag.manager import RAGManager, check_vllm_health

logger = logging.getLogger("main")

try:
    import pynvml
    pynvml.nvmlInit()
    HAS_NVML = True
except Exception:
    HAS_NVML = False

# [알림] 중복 발송 방지용 상태
_vllm_down_alerted      = False   # vLLM 끊김 알림 발송 여부
_daily_summary_date     = None    # 마지막 일일 요약 발송 날짜
_last_zero_hit_alert    = None    # 마지막 zero-hit 알림 발송 시각 (datetime)
_heartbeat_tick         = 0       # 하트비트 누적 횟수 (로그 빈도 조절용)
_last_error_rate_alert  = None    # [A-1] 마지막 에러율 급등 알림 발송 시각 (datetime)

# [알림 임계값] 런타임 조정 가능 (재시작 시 기본값 복귀)
ALERT_SETTINGS: dict = {
    "gpu_temp_threshold":      90,   # GPU 온도 경고 기준 (°C)
    "zero_hit_interval_hours": 2,    # Zero-hit 누적 알림 간격 (시간)
    "daily_summary_hour":      9,    # 일일 요약 발송 시각 (0~23시)
}

start_time = time.time()


def send_alert_email(subject: str, body: str) -> bool:
    """이메일 알림 발송 — .env의 SMTP 설정 사용"""
    smtp_host     = os.getenv("SMTP_HOST", "smtp.gmail.com")
    smtp_port     = int(os.getenv("SMTP_PORT", "587"))
    smtp_user     = os.getenv("SMTP_USER")
    smtp_password = os.getenv("SMTP_PASSWORD")
    alert_email   = os.getenv("ALERT_EMAIL")

    if not all([smtp_user, smtp_password, alert_email]):
        return False
    try:
        msg = MIMEMultipart()
        msg["From"]    = f"HR챗봇 서버 <{smtp_user}>"
        msg["To"]      = alert_email
        msg["Subject"] = subject
        msg.attach(MIMEText(body, "plain", "utf-8"))
        with smtplib.SMTP(smtp_host, smtp_port) as server:
            server.starttls()
            server.login(smtp_user, smtp_password)
            server.send_message(msg)
        logger.info(f"📧 알림 이메일 발송: {subject}")
        return True
    except Exception as e:
        logger.error(f"❌ 이메일 발송 실패: {e}")
        return False

async def heartbeat_loop():
    """1분마다 서버 건강 상태 모니터링 + 이메일 알림"""
    global _vllm_down_alerted, _daily_summary_date, _last_zero_hit_alert, _heartbeat_tick, _last_error_rate_alert
    while True:
        await asyncio.sleep(60)
        now = datetime.now()
        uptime_sec = int(time.time() - start_time)
        hours, rem = divmod(uptime_sec, 3600)
        minutes, seconds = divmod(rem, 60)
        uptime_str = f"{hours}시간 {minutes}분" if hours > 0 else f"{minutes}분 {seconds}초"

        vllm_ok = await check_vllm_health()
        vllm_status = "✅ 정상" if vllm_ok else "❌ 연결 실패"

        # 점검은 매분 수행하되, 정상 시 로그는 5분마다만 출력(스팸 완화). 비정상이면 매분 기록.
        _heartbeat_tick += 1
        if (not vllm_ok) or (_heartbeat_tick % 5 == 1):
            # GPU 온도(최대) 수집
            gpu_info = ""
            if HAS_NVML:
                try:
                    temps = []
                    for i in range(pynvml.nvmlDeviceGetCount()):
                        h = pynvml.nvmlDeviceGetHandleByIndex(i)
                        temps.append(pynvml.nvmlDeviceGetTemperature(h, pynvml.NVML_TEMPERATURE_GPU))
                    if temps:
                        gpu_info = f" | GPU 온도: {'/'.join(str(t)+'°C' for t in temps)}"
                except Exception:
                    pass
            # 오늘 질문 수
            today_cnt = ""
            try:
                with sqlite3.connect(FEEDBACK_DB) as _c:
                    n = _c.execute("SELECT COUNT(*) FROM query_logs WHERE date(timestamp,'+9 hours')=date('now','+9 hours')").fetchone()[0]
                today_cnt = f" | 오늘 질문 {n}건"
            except Exception:
                pass
            model = RAGManager.config.get("llm_model", "?") if RAGManager._is_ready else "로딩중"
            logger.info(f"💓 [시스템 상태] 가동 {uptime_str} | vLLM: {vllm_status} | 모델: {model}{gpu_info}{today_cnt} | 최근 질의 {len(live_queries)}건(최대 20)")

        # vLLM 연결 끊김 알림
        if not vllm_ok and not _vllm_down_alerted:
            _vllm_down_alerted = True
            asyncio.create_task(asyncio.to_thread(
                send_alert_email,
                "🔴 [HR챗봇] vLLM 서버 연결 끊김",
                f"시각: {now.strftime('%Y-%m-%d %H:%M')}\n"
                f"서버 가동 시간: {uptime_str}\n\n"
                f"vLLM 서버에 연결할 수 없습니다.\n"
                f"서버 상태를 확인해주세요."
            ))
        elif vllm_ok and _vllm_down_alerted:
            _vllm_down_alerted = False
            asyncio.create_task(asyncio.to_thread(
                send_alert_email,
                "✅ [HR챗봇] vLLM 서버 복구됨",
                f"시각: {now.strftime('%Y-%m-%d %H:%M')}\n\nvLLM 서버가 정상 복구되었습니다."
            ))

        # GPU 온도 90도 초과 알림
        if HAS_NVML:
            try:
                for i in range(pynvml.nvmlDeviceGetCount()):
                    handle = pynvml.nvmlDeviceGetHandleByIndex(i)
                    temp = pynvml.nvmlDeviceGetTemperature(handle, pynvml.NVML_TEMPERATURE_GPU)
                    if temp >= ALERT_SETTINGS["gpu_temp_threshold"]:
                        asyncio.create_task(asyncio.to_thread(
                            send_alert_email,
                            f"🔥 [HR챗봇] GPU {i}번 온도 경고 ({temp}°C)",
                            f"시각: {now.strftime('%Y-%m-%d %H:%M')}\n"
                            f"GPU {i}번 온도: {temp}°C\n\n"
                            f"서버 과열 위험이 있습니다. 즉시 확인해주세요."
                        ))
            except Exception:
                pass

        # ── Zero-hit 누적 알림 (2시간마다 체크, 새 건수 있을 때만 발송) ────────
        zero_alert_interval = ALERT_SETTINGS["zero_hit_interval_hours"] * 3600
        if (_last_zero_hit_alert is None or
                (now - _last_zero_hit_alert).total_seconds() >= zero_alert_interval):
            try:
                conn = sqlite3.connect(FEEDBACK_DB)
                c = conn.cursor()
                since_str = (
                    _last_zero_hit_alert or (now - timedelta(seconds=zero_alert_interval))
                ).strftime('%Y-%m-%d %H:%M:%S')
                c.execute(
                    "SELECT query, timestamp FROM zero_hits WHERE timestamp > ? ORDER BY timestamp DESC",
                    (since_str,)
                )
                new_hits = c.fetchall()
                conn.close()
                if new_hits:
                    _last_zero_hit_alert = now
                    queries_text = "\n".join(
                        f"  • {h[0][:80]}  ({h[1][:16]})" for h in new_hits[:20]
                    )
                    asyncio.create_task(asyncio.to_thread(
                        send_alert_email,
                        f"[HR챗봇] 검색 실패 질문 {len(new_hits)}건 발생",
                        f"최근 2시간 내 검색 결과를 찾지 못한 질문이 {len(new_hits)}건 발생했습니다.\n\n"
                        f"[검색 실패 질문 목록]\n{queries_text}\n\n"
                        f"해당 주제의 문서 보충을 검토해주세요.\n"
                        f"관리자 패널 > 시스템 현황 > 지식 공백(Zero-Hit) 섹션에서 전체 내역 확인 가능합니다.\n\n"
                        f"발생 기준 시각: {now.strftime('%Y-%m-%d %H:%M')}"
                    ))
            except Exception as e:
                logger.error(f"Zero-hit 알림 체크 실패: {e}")

        # ── [A-1] 에러율 급등 알림 (관제) ──────────────────────────────────────
        # 최근 N분간 완료된 질의(ok+error) 중 error 비율이 임계 초과 + 최소표본 이상이면
        # 관리자에게 즉시 메일. 쿨다운(기본 1시간)으로 스팸 방지. 관제 지표를 '보는 것'에서
        # '먼저 알려주는 것'으로 — 사용자 항의 전에 우리가 먼저 안다.
        _err_window_min = int(os.getenv("ERROR_ALERT_WINDOW_MIN", "15"))
        _err_min_samples = int(os.getenv("ERROR_ALERT_MIN_SAMPLES", "5"))
        _err_threshold = float(os.getenv("ERROR_ALERT_THRESHOLD_PCT", "30"))
        _err_cooldown = int(os.getenv("ERROR_ALERT_COOLDOWN_SEC", "3600"))
        if (_last_error_rate_alert is None or
                (now - _last_error_rate_alert).total_seconds() >= _err_cooldown):
            try:
                with sqlite3.connect(FEEDBACK_DB) as _ec:
                    row = _ec.execute(
                        "SELECT "
                        "  SUM(CASE WHEN status='error' THEN 1 ELSE 0 END), "
                        "  SUM(CASE WHEN status IN ('ok','error') THEN 1 ELSE 0 END) "
                        "FROM query_logs "
                        "WHERE timestamp >= datetime('now', ?)",
                        (f"-{_err_window_min} minutes",)
                    ).fetchone()
                errs = row[0] or 0
                finished = row[1] or 0
                if finished >= _err_min_samples:
                    rate = 100.0 * errs / finished
                    if rate >= _err_threshold:
                        _last_error_rate_alert = now
                        logger.error(f"🚨 [A-1] 에러율 급등 감지 — 최근 {_err_window_min}분 {errs}/{finished} ({rate:.1f}%)")
                        asyncio.create_task(asyncio.to_thread(
                            send_alert_email,
                            f"🚨 [HR챗봇] 에러율 급등 ({rate:.0f}%)",
                            f"시각: {now.strftime('%Y-%m-%d %H:%M')}\n"
                            f"최근 {_err_window_min}분간 답변 {finished}건 중 {errs}건 오류 (에러율 {rate:.1f}%).\n\n"
                            f"vLLM/GPU 상태 또는 백엔드 로그를 확인해주세요.\n"
                            f"관리자 패널 > 실시간 대시보드 > 관제 지표에서 추이 확인 가능합니다."
                        ))
            except Exception as e:
                logger.error(f"에러율 알림 체크 실패: {e}")

        # ── 매일 오전 9시 일일 요약 ────────────────────────────────────────────
        if now.hour == ALERT_SETTINGS["daily_summary_hour"] and _daily_summary_date != now.date():
            _daily_summary_date = now.date()
            try:
                conn = sqlite3.connect(FEEDBACK_DB)
                c = conn.cursor()
                yesterday = (now - timedelta(days=1)).strftime('%Y-%m-%d')
                c.execute("SELECT COUNT(*) FROM query_logs WHERE date(timestamp, '+9 hours')=?", (yesterday,))
                query_cnt = c.fetchone()[0]
                c.execute(
                    "SELECT COUNT(*), SUM(CASE WHEN score>0 THEN 1 ELSE 0 END) FROM feedbacks WHERE date(timestamp, '+9 hours')=?",
                    (yesterday,)
                )
                fb_row   = c.fetchone()
                fb_total = fb_row[0] or 0
                fb_likes = fb_row[1] or 0
                satisfaction = f"{fb_likes/fb_total*100:.1f}%" if fb_total > 0 else "데이터 없음"
                # 어제 하루 zero-hit 목록
                c.execute(
                    "SELECT query, COUNT(*) as cnt FROM zero_hits WHERE date(timestamp, '+9 hours')=? GROUP BY query ORDER BY cnt DESC LIMIT 10",
                    (yesterday,)
                )
                zh_rows = c.fetchall()
                # [A-1] 어제 관제 지표 — 응답시간 p95·에러율
                c.execute(
                    "SELECT latency_ms FROM query_logs "
                    "WHERE latency_ms IS NOT NULL AND date(timestamp,'+9 hours')=? "
                    "ORDER BY latency_ms ASC", (yesterday,)
                )
                _lat = [r[0] for r in c.fetchall()]
                c.execute(
                    "SELECT SUM(CASE WHEN status='error' THEN 1 ELSE 0 END), "
                    "       SUM(CASE WHEN status IN ('ok','error') THEN 1 ELSE 0 END) "
                    "FROM query_logs WHERE date(timestamp,'+9 hours')=?", (yesterday,)
                )
                _er = c.fetchone()
                _fin = _er[1] or 0
                _p95 = _lat[max(0, min(len(_lat)-1, int(round(0.95*(len(_lat)-1)))))] if _lat else None
                _obs_text = (
                    f"응답시간 p95: {_p95/1000:.1f}s | 에러율: {100.0*(_er[0] or 0)/_fin:.1f}%"
                    if _fin > 0 else "관제 데이터 없음"
                )
                conn.close()
                zh_text = (
                    "\n".join(f"  • {r[0][:80]} ({r[1]}회)" for r in zh_rows)
                    if zh_rows else "  없음"
                )
                asyncio.create_task(asyncio.to_thread(
                    send_alert_email,
                    f"[HR챗봇] {yesterday} 일일 요약",
                    f"날짜: {yesterday}\n\n"
                    f"총 질문 수: {query_cnt}건\n"
                    f"피드백 수: {fb_total}건\n"
                    f"사용자 만족도: {satisfaction}\n"
                    f"관제 지표: {_obs_text}\n\n"
                    f"[검색 실패(Zero-Hit) 질문 TOP 10]\n{zh_text}\n\n"
                    f"자세한 내용은 관리자 패널에서 확인하세요."
                ))
            except Exception as e:
                logger.error(f"일일 요약 이메일 실패: {e}")
