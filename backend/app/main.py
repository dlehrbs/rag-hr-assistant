"""
RAG HR Assistant — 백엔드 진입점 (부트스트랩 전용).

이 파일은 앱을 "조립"만 한다. 모든 도메인 로직은 아래 모듈에 있다.

  [엔진]        rag/manager         RAG 엔진(GPU 할당·모델 로딩·상태) — 중앙 관리자
                rag/router          Intent Router(인사/메타/일반 분류·후속질문 재작성)
                rag/retrieval_utils 이중질의 리랭킹·컨텍스트 재구성·후속질문 생성(범용)
                rag/generator       ★핵심 응답 생성기 chat_generator (SSE 스트리밍 파이프라인)
  [핸들러]      handlers/files 파일 파싱(PDF·스캔OCR폴백·HTML·DOCX·PPTX·XLSX + 캐시)
                projects_logic 프로젝트 공간(디스크 영속 인덱스·LRU 캐시·인덱싱·멤버 권한)
  [엔드포인트]  routes/auth·chat·widget·conversations·projects·documents·admin·
                reindex·models  — 도메인별 APIRouter (아래 include_router로 마운트)
  [공통]        config 상수·경로   schemas 요청 모델   db DB초기화·헬퍼
                state 런타임 가변전역   deps limiter·인증가드
                monitoring 하트비트·이메일알림   logging_setup 로그 설정·한글화

요청 흐름:
  브라우저 → nginx → frontend → (이 백엔드) korean_access_log 미들웨어
    → routes/*(APIRouter) → rag/generator.chat_generator → vLLM(EXAONE 3.5 7.8B AWQ)

main.py가 직접 갖는 것 (부트스트랩만):
  init_user_db          사용자 DB 초기화·admin 시드 (RAGManager 무관하나 기동 시퀀스상 잔류)
  lifespan              기동/종료 — DB init·live_queries 복원·하트비트/클린업 태스크·엔진 로딩(3회 재시도)
  korean_access_log     모든 HTTP 요청을 한글 라벨로 기록하는 미들웨어
  cleanup_temp_indices  만료된 임시 인덱스 정리 루프 (lifespan이 백그라운드로 구동)
  app 생성 · limiter/CORS/정적파일 · include_router 배선
"""

# ── 표준 라이브러리 ──
import os
import time
import shutil
import asyncio
import logging
import sqlite3
import urllib.parse as _urlparse
from contextlib import asynccontextmanager
from datetime import datetime, timedelta

# ── 서드파티 ──
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

# ── 환경변수·.env 로드 (transformers/torch·core.auth import보다 반드시 먼저) ──
os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"
os.environ["TRANSFORMERS_VERBOSITY"] = "error"
os.environ["HUGGINGFACE_HUB_VERBOSITY"] = "error"
env_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../.env"))
load_dotenv(env_path)

# ── 내부 모듈: 공통 (경량) ──
from config import DATA_ROOT, FEEDBACK_DB, DOCS_PATH, ALLOWED_ORIGINS
from core.auth import get_password_hash
from db import init_feedback_db
from state import live_queries, indexing_tasks
from deps import limiter
from logging_setup import (
    _setup_logging, NoiseFilter, KoreanLogFilter, EndpointFilter,
    _korean_access_label, _LOG_SKIP_EXACT, _LOG_SKIP_PREFIX,
)

# ── 내부 모듈: 엔진·모니터링 (torch/transformers 로드 — env 설정 이후) ──
from rag.manager import RAGManager, check_vllm_health
from monitoring import heartbeat_loop

# ── 엔드포인트: 도메인별 APIRouter ──
from routes.conversations import router as conversations_router
from routes.auth import router as auth_router
from routes.admin import router as admin_router
from routes.projects import router as projects_router
from routes.chat import router as chat_router
from routes.widget import router as widget_router
from routes.documents import router as documents_router
from routes.reindex import router as reindex_router
from routes.models import router as models_router

# ═══ 로깅 설정 ═══════════════════════════════════════════════════════════════
_setup_logging()
logger = logging.getLogger(__name__)

# 라이브러리 로그 소음 억제
logging.getLogger("uvicorn.access").addFilter(NoiseFilter())
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("llama_index").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("sentence_transformers").setLevel(logging.ERROR)
logging.getLogger("transformers").setLevel(logging.ERROR)
logging.getLogger("huggingface_hub").setLevel(logging.ERROR)

# uvicorn 영어 시스템 메시지 → 한글 자동 치환. 기본 액세스로그는 비활성(아래 미들웨어로 대체)
_korean_log_filter = KoreanLogFilter()
for _lname in ("uvicorn", "uvicorn.error"):
    logging.getLogger(_lname).addFilter(_korean_log_filter)
for _h in logging.getLogger().handlers:
    _h.addFilter(_korean_log_filter)
logging.getLogger("uvicorn.access").disabled = True
logging.getLogger("uvicorn.access").addFilter(EndpointFilter())


# ═══ 부트스트랩 함수 ═════════════════════════════════════════════════════════
def init_user_db():
    """사용자 계정 DB 초기화 — users 테이블 생성 및 기본 admin 시드"""
    try:
        conn = sqlite3.connect(FEEDBACK_DB)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=5000")
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                hashed_password TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                is_active INTEGER DEFAULT 1,
                status TEXT NOT NULL DEFAULT 'active'
            )
        """)
        conn.commit()
        # 기존 DB에 status 컬럼 없으면 마이그레이션
        try:
            cursor.execute("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'")
            conn.commit()
            logger.info("✅ users 테이블 status 컬럼 마이그레이션 완료")
        except Exception:
            pass  # 이미 존재하면 무시
        # [SSO] auth_type(local/sso)·display_name(화면표시 이름)·dept 컬럼 마이그레이션
        for ddl in (
            "ALTER TABLE users ADD COLUMN auth_type TEXT NOT NULL DEFAULT 'local'",
            "ALTER TABLE users ADD COLUMN display_name TEXT",
            "ALTER TABLE users ADD COLUMN dept TEXT",
        ):
            try:
                cursor.execute(ddl)
                conn.commit()
                logger.info(f"✅ users 테이블 SSO 컬럼 마이그레이션: {ddl.split('COLUMN ')[1].split(' ')[0]}")
            except Exception:
                pass  # 이미 존재하면 무시
        # .env의 admin 계정이 DB에 없으면 자동 생성
        admin_user = os.getenv("ADMIN_USERNAME", "admin")
        admin_pass = os.getenv("ADMIN_PASSWORD")
        if not admin_pass:
            raise RuntimeError("ADMIN_PASSWORD 환경변수가 설정되지 않았습니다. .env 파일을 확인하세요.")
        cursor.execute("SELECT id FROM users WHERE username = ?", (admin_user,))
        if not cursor.fetchone():
            cursor.execute(
                "INSERT INTO users (username, hashed_password, role) VALUES (?, ?, 'admin')",
                (admin_user, get_password_hash(admin_pass))
            )
            conn.commit()
            logger.info(f"✅ 기본 admin 계정 생성: {admin_user}")
        conn.close()
        logger.info("✅ 사용자 DB 초기화 완료")
    except Exception as e:
        logger.error(f"❌ 사용자 DB 초기화 실패: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """앱 시작/종료 lifespan 핸들러 [C-03] 엔진 로드 실패 시 최대 3회 재시도"""
    # [RLHF-01] 시작 시 피드백 DB 초기화
    init_feedback_db()
    init_user_db()

    # 재시작 후 live_queries를 DB 최근 20건으로 복원
    try:
        with sqlite3.connect(FEEDBACK_DB) as _c:
            rows = _c.execute(
                "SELECT query, timestamp FROM query_logs ORDER BY timestamp DESC LIMIT 20"
            ).fetchall()
        for q, ts in reversed(rows):
            try:
                # SQLite CURRENT_TIMESTAMP는 UTC → KST(+9h) 변환
                t = (datetime.strptime(ts[:16], "%Y-%m-%d %H:%M") + timedelta(hours=9)).strftime("%m/%d %H:%M")
            except Exception:
                t = ts[:5]
            live_queries.append({"query": q, "time": t})
    except Exception:
        pass

    # [Premium Log] 하트비트 루틴 시작
    asyncio.create_task(heartbeat_loop())
    
    # [vLLM 가용성 사전 체크]
    if not await check_vllm_health():
        logger.critical("❌ [비상] vLLM 서버를 찾을 수 없습니다! (vLLM 컨테이너 상태를 확인하세요)")
    
    for attempt in range(3):
        await asyncio.to_thread(RAGManager.load)
        if RAGManager._is_ready:
            break
        logger.warning(f"⚠️ 엔진 로드 재시도 ({attempt + 1}/3)...")
        await asyncio.sleep(10)
    
    if not RAGManager._is_ready:
        logger.critical("❌ 엔진 로드 최종 실패. 서버가 비가용 상태로 실행됩니다.")
    asyncio.create_task(cleanup_temp_indices())
    yield

# ═══ 앱 조립 ═════════════════════════════════════════════════════════════════
app = FastAPI(title="DY RAG API", lifespan=lifespan)

# Rate Limiting (limiter·키함수·클라이언트IP는 deps.py)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# 정적 파일 서빙 (사내 문서 PDF)
if not os.path.exists(DOCS_PATH):
    os.makedirs(DOCS_PATH, exist_ok=True)
app.mount("/api/docs", StaticFiles(directory=DOCS_PATH), name="docs")

# CORS (허용 오리진은 ALLOWED_ORIGINS 환경변수로 제한)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "DELETE", "PATCH", "PUT"],
    allow_headers=["Content-Type", "Authorization"],
)

# 도메인 라우터 마운트
app.include_router(conversations_router)
app.include_router(auth_router)
app.include_router(admin_router)
app.include_router(projects_router)
app.include_router(chat_router)
app.include_router(widget_router)
app.include_router(documents_router)
app.include_router(reindex_router)
app.include_router(models_router)


# ═══ 미들웨어: 요청 로그 한글화 ══════════════════════════════════════════════
@app.middleware("http")
async def korean_access_log(request: Request, call_next):
    _t0 = time.time()
    path = request.url.path
    # 소음 경로는 로깅 생략
    skip = path in _LOG_SKIP_EXACT or any(path.startswith(pp) for pp in _LOG_SKIP_PREFIX)
    try:
        response = await call_next(request)
    except Exception as e:
        if not skip:
            dur = (time.time() - _t0) * 1000
            who = request.cookies.get("rag_username")
            who = _urlparse.unquote(who) if who else "비로그인"
            logger.error(f"❌ [요청실패] {_korean_access_label(request.method, path)} | 처리오류 | {dur:.0f}ms | 사용자:{who} | {e}")
        raise
    if not skip:
        dur = (time.time() - _t0) * 1000
        status = response.status_code
        who = request.cookies.get("rag_username")
        who = _urlparse.unquote(who) if who else "비로그인"
        label = _korean_access_label(request.method, path)
        # 채팅 요청은 종류(일반/프로젝트/파일첨부)를 함께 표기
        _ck = getattr(request.state, "chat_kind", None)
        if _ck:
            label = f"💬 채팅 질의 [{_ck}]"
        mark = "✅" if status < 400 else ("🔒" if status in (401, 403) else ("⏳" if status == 429 else ("⚠️" if status < 500 else "❌")))
        logger.info(f"{mark} [요청] {label} | 상태 {status} | {dur:.0f}ms | 사용자:{who}")
    return response


# ═══ 백그라운드: 임시 인덱스 정리 루프 (lifespan이 구동) ═══════════════════════
async def cleanup_temp_indices():
    """만료된 임시 인덱스 정리 (디스크 직접 스캔 방식)"""
    while True:
        try:
            logger.info("🧹 [CLEANUP] 임시 인덱스 물리 스캔 및 정리 루틴 가동...")
            # [C-02] 상대경로(./databases/temp_db) → DATA_ROOT 기반 절대경로
            temp_db_root = os.path.join(DATA_ROOT, "databases/temp_db")
            if not os.path.exists(temp_db_root):
                os.makedirs(temp_db_root, exist_ok=True)
                
            now = time.time()
            # 1. 메모리 상의 만료된 태스크 제거
            to_delete_memory = [tid for tid, tinfo in indexing_tasks.items() if now - tinfo.get("timestamp", 0) > 24 * 3600]
            for tid in to_delete_memory:
                indexing_tasks.pop(tid, None)

            # 2. 물리 디스크 상의 만료된 폴더 제거 (서버 재시작 후 남은 유령 폴더 방지)
            for folder_name in os.listdir(temp_db_root):
                folder_path = os.path.join(temp_db_root, folder_name)
                if os.path.isdir(folder_path):
                    mtime = os.path.getmtime(folder_path)
                    if now - mtime > 24 * 3600:
                        logger.info(f"🗑️ [CLEANUP] 만료된 물리 폴더 삭제: {folder_name[:8]}")
                        try:
                            shutil.rmtree(folder_path, ignore_errors=True)
                            # [C-02] 메모리에서도 retriever 객체 명시적 제거 및 딕셔너리 정리
                            if folder_name in indexing_tasks:
                                indexing_tasks[folder_name]["retriever"] = None
                                indexing_tasks.pop(folder_name, None)
                        except Exception as e:
                            logger.error(f"❌ [CLEANUP] 폴더 삭제 실패 ({folder_name}): {e}")
        except Exception as e:
            logger.error(f"❌ [CLEANUP] 에러: {e}")
        await asyncio.sleep(3600)
