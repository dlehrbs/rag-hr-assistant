"""[routes/admin] 관리자 패널 API(자족분리분) — 피드백·통계로그·검색파라미터·지침·
사용량·RAG테스트·비번검증·VRAM/로그정리·청크설정·사용자관리. APIRouter.
config·rag.manager·core.auth·state·deps·schemas에만 의존.
※ main-local 결합분(stats/alert-settings/reindex/switch-model/문서업로드)은 main 잔류(후속 패스).
※ 리팩토링으로 main.py에서 이동 — 엔드포인트 본문 byte-동일(@app→@router만)."""
import os
import gc
import time
import sqlite3
import logging
import torch
import pynvml

from fastapi import APIRouter, Request, Depends, HTTPException

from config import FEEDBACK_DB, COMPANY_NAME
from core.auth import verify_password, get_password_hash
from rag.manager import RAGManager, check_vllm_health
from state import live_queries, chunk_config, tps_history
from deps import _require_admin
from monitoring import HAS_NVML, start_time, ALERT_SETTINGS
from schemas import (
    SearchParamsRequest, GlobalInstructionRequest, RagTestRequest, VerifyPasswordRequest,
    CreateUserRequest, ChangeRoleRequest, AdminResetPasswordRequest, ToggleActiveRequest,
)

logger = logging.getLogger("main")

router = APIRouter()


@router.get("/api/admin/feedbacks")
async def get_feedbacks(user_info: dict = Depends(_require_admin)):
    """피드백 목록 조회 API [RLHF-01]"""
    try:
        conn = sqlite3.connect(FEEDBACK_DB)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM feedbacks ORDER BY timestamp DESC")
        rows = cursor.fetchall()
        result = [dict(row) for row in rows]
        conn.close()
        return {"feedbacks": result}
    except Exception as e:
        logger.error(f"❌ 피드백 조회 실패: {e}")
        return {"feedbacks": []}

@router.get("/api/admin/feedbacks/stats")
async def get_feedback_stats(user_info: dict = Depends(_require_admin)):
    """피드백 분석 통계 API"""
    try:
        conn = sqlite3.connect(FEEDBACK_DB)
        conn.row_factory = sqlite3.Row
        c = conn.cursor()

        # 전체/좋아요/싫어요 집계
        c.execute("SELECT COUNT(*) total, SUM(CASE WHEN score>0 THEN 1 ELSE 0 END) likes, SUM(CASE WHEN score<0 THEN 1 ELSE 0 END) dislikes FROM feedbacks")
        row = dict(c.fetchone())

        # 날짜별 피드백 수 (최근 14일, KST 기준)
        c.execute("""
            SELECT date(timestamp, '+9 hours') as day,
                   SUM(CASE WHEN score>0 THEN 1 ELSE 0 END) likes,
                   SUM(CASE WHEN score<0 THEN 1 ELSE 0 END) dislikes
            FROM feedbacks
            WHERE timestamp >= datetime('now','-14 days')
            GROUP BY day ORDER BY day
        """)
        daily = [dict(r) for r in c.fetchall()]

        # 부정 평가 많이 받은 질문 TOP 5
        c.execute("""
            SELECT question, COUNT(*) cnt FROM feedbacks
            WHERE score < 0 GROUP BY question ORDER BY cnt DESC LIMIT 5
        """)
        top_disliked = [dict(r) for r in c.fetchall()]

        # 사유(comment) 분포
        c.execute("""
            SELECT comment, COUNT(*) cnt FROM feedbacks
            WHERE score < 0 AND comment IS NOT NULL AND comment != ''
            GROUP BY comment ORDER BY cnt DESC
        """)
        reasons = [dict(r) for r in c.fetchall()]

        conn.close()
        return {
            "total": row["total"] or 0,
            "likes": row["likes"] or 0,
            "dislikes": row["dislikes"] or 0,
            "daily": daily,
            "top_disliked": top_disliked,
            "reasons": reasons,
        }
    except Exception as e:
        logger.error(f"❌ 피드백 통계 조회 실패: {e}")
        return {"total": 0, "likes": 0, "dislikes": 0, "daily": [], "top_disliked": [], "reasons": []}

@router.delete("/api/admin/feedbacks/{fb_id}")
async def delete_feedback(fb_id: str, user_info: dict = Depends(_require_admin)):
    """피드백 삭제 API [RLHF-01]"""
    try:
        conn = sqlite3.connect(FEEDBACK_DB)
        cursor = conn.cursor()
        cursor.execute("DELETE FROM feedbacks WHERE id = ?", (fb_id,))
        conn.commit()
        conn.close()
        return {"status": "success"}
    except Exception as e:
        logger.error(f"❌ 피드백 삭제 실패: {e}")
        raise HTTPException(status_code=500, detail="삭제 중 오류가 발생했습니다.")

@router.get("/api/admin/query-logs")
async def get_query_logs(user_info: dict = Depends(_require_admin)):
    """[대시보드] 실시간 사용자 질의 로그 — DB에 기록된 전체 질의(최신순) 반환.
    실시간 카드는 메모리 최근 20건만 보여주므로, 관리자가 '싹 다' 보려면 이 엔드포인트를 사용."""
    try:
        conn = sqlite3.connect(FEEDBACK_DB)
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        c.execute("SELECT id, query, username, latency_ms, status, datetime(timestamp, '+9 hours') as timestamp FROM query_logs ORDER BY id DESC")
        rows = [dict(r) for r in c.fetchall()]
        conn.close()
        return {"total": len(rows), "logs": rows}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"질의 로그 조회 실패: {e}")

@router.get("/api/admin/metrics")
async def get_metrics(user_info: dict = Depends(_require_admin)):
    """[관제] 응답시간 p50/p95·에러율·일별 질의량 실측 지표.
    회귀 골든셋(44문항 통과율)이 아닌 '실서비스 품질'의 실제 근거를 제공."""
    try:
        conn = sqlite3.connect(FEEDBACK_DB)
        conn.row_factory = sqlite3.Row
        c = conn.cursor()

        # 최근 7일 latency 분포 (완료 건만 — latency 기록된 것)
        c.execute("""
            SELECT latency_ms FROM query_logs
            WHERE latency_ms IS NOT NULL
              AND timestamp >= datetime('now', '-7 days')
            ORDER BY latency_ms ASC
        """)
        lats = [r["latency_ms"] for r in c.fetchall()]

        def _pct(vals, p):
            if not vals:
                return None
            k = max(0, min(len(vals) - 1, int(round((p / 100.0) * (len(vals) - 1)))))
            return vals[k]

        # 상태 분포 (최근 7일)
        c.execute("""
            SELECT COALESCE(status, 'legacy') AS s, COUNT(*) AS n FROM query_logs
            WHERE timestamp >= datetime('now', '-7 days')
            GROUP BY s
        """)
        status_counts = {r["s"]: r["n"] for r in c.fetchall()}
        finished = status_counts.get("ok", 0) + status_counts.get("error", 0)
        err_rate = round(100.0 * status_counts.get("error", 0) / finished, 2) if finished else 0.0

        # 일별 질의량 (최근 14일, KST)
        c.execute("""
            SELECT substr(datetime(timestamp, '+9 hours'), 1, 10) AS d, COUNT(*) AS n
            FROM query_logs
            WHERE timestamp >= datetime('now', '-14 days')
            GROUP BY d ORDER BY d DESC
        """)
        daily = [{"date": r["d"], "count": r["n"]} for r in c.fetchall()]
        conn.close()

        return {
            "window": "최근 7일",
            "latency_ms": {
                "count": len(lats),
                "p50": _pct(lats, 50),
                "p95": _pct(lats, 95),
                "max": lats[-1] if lats else None,
            },
            "status_counts": status_counts,
            "error_rate_pct": err_rate,
            "daily_volume": daily,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"관제 지표 조회 실패: {e}")

@router.get("/api/admin/search-params")
async def get_search_params(user_info: dict = Depends(_require_admin)):
    """현재 실서비스에 적용된 검색 파라미터 반환"""
    return RAGManager.search_params.copy()

@router.patch("/api/admin/search-params")
async def update_search_params(req: SearchParamsRequest, user_info: dict = Depends(_require_admin)):
    """검색 파라미터 실시간 업데이트 (재시작 시 기본값 복귀)"""
    if req.vector_k is not None:
        if not (1 <= req.vector_k <= 50):
            raise HTTPException(status_code=400, detail="vector_k는 1~50 사이여야 합니다.")
        RAGManager.search_params["vector_k"] = req.vector_k
    if req.bm25_k is not None:
        if not (1 <= req.bm25_k <= 50):
            raise HTTPException(status_code=400, detail="bm25_k는 1~50 사이여야 합니다.")
        RAGManager.search_params["bm25_k"] = req.bm25_k
    if req.final_top_k is not None:
        if not (1 <= req.final_top_k <= 10):
            raise HTTPException(status_code=400, detail="final_top_k는 1~10 사이여야 합니다.")
        RAGManager.search_params["final_top_k"] = req.final_top_k
    if req.mode is not None:
        if req.mode not in ("hybrid", "vector", "bm25"):
            raise HTTPException(status_code=400, detail="mode는 hybrid/vector/bm25 중 하나여야 합니다.")
        RAGManager.search_params["mode"] = req.mode
    if req.rerank_threshold is not None:
        if not (0.0 <= req.rerank_threshold <= 1.0):
            raise HTTPException(status_code=400, detail="rerank_threshold는 0.0~1.0 사이여야 합니다.")
        RAGManager.search_params["rerank_threshold"] = req.rerank_threshold
    logger.info(f"검색 파라미터 업데이트: {RAGManager.search_params}")
    return RAGManager.search_params.copy()

@router.get("/api/admin/global-instruction")
async def get_global_instruction(user_info: dict = Depends(_require_admin)):
    """전역 관리자 지침 조회 — admin 전용(일반 사용자는 조회도 불가)."""
    conn = sqlite3.connect(FEEDBACK_DB)
    try:
        row = conn.execute("SELECT value FROM app_settings WHERE key='global_instruction'").fetchone()
    finally:
        conn.close()
    return {"instruction": (row[0] if row and row[0] else "")}

@router.put("/api/admin/global-instruction")
async def set_global_instruction(req: GlobalInstructionRequest, user_info: dict = Depends(_require_admin)):
    """전역 관리자 지침 설정 — admin 전용. 1500자 서버 cap. 분기 B 사내 답변에 적용."""
    val = (req.instruction or "")[:1500]
    conn = sqlite3.connect(FEEDBACK_DB)
    try:
        conn.execute("INSERT INTO app_settings (key, value) VALUES ('global_instruction', ?) "
                     "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (val,))
        conn.commit()
    finally:
        conn.close()
    logger.info(f"🏢 [전역지침] 관리자 '{user_info.get('username')}' 갱신 ({len(val)}자)")
    return {"ok": True, "instruction": val}

@router.get("/api/admin/usage-stats")
async def get_usage_stats(user_info: dict = Depends(_require_admin)):
    """사용 통계 API — 일별 질문 수, 시간대별 분포, TOP 질문"""
    try:
        conn = sqlite3.connect(FEEDBACK_DB)
        conn.row_factory = sqlite3.Row
        c = conn.cursor()

        # 최근 14일 일별 질문 수 (KST 기준)
        c.execute("""
            SELECT date(timestamp, '+9 hours') as day, COUNT(*) as cnt
            FROM query_logs
            WHERE timestamp >= datetime('now', '-14 days')
            GROUP BY day ORDER BY day
        """)
        daily = [dict(r) for r in c.fetchall()]

        # 시간대별 질문 수 (0~23시, KST 기준)
        c.execute("""
            SELECT strftime('%H', timestamp, '+9 hours') as hour, COUNT(*) as cnt
            FROM query_logs
            WHERE timestamp >= datetime('now', '-30 days')
            GROUP BY hour ORDER BY hour
        """)
        hourly = [dict(r) for r in c.fetchall()]

        # 전체 질문 수
        c.execute("SELECT COUNT(*) FROM query_logs")
        total = c.fetchone()[0]

        # 오늘 질문 수 (KST 기준)
        c.execute("SELECT COUNT(*) FROM query_logs WHERE date(timestamp, '+9 hours') = date('now', '+9 hours')")
        today = c.fetchone()[0]

        # 이번 주 질문 수
        c.execute("SELECT COUNT(*) FROM query_logs WHERE timestamp >= datetime('now', '-7 days')")
        this_week = c.fetchone()[0]

        # TOP 10 자주 묻는 질문 (전체 기간)
        c.execute("""
            SELECT query, COUNT(*) as cnt
            FROM query_logs
            GROUP BY query ORDER BY cnt DESC LIMIT 10
        """)
        top_queries = [dict(r) for r in c.fetchall()]

        conn.close()
        return {
            "total": total,
            "today": today,
            "this_week": this_week,
            "daily": daily,
            "hourly": hourly,
            "top_queries": top_queries,
        }
    except Exception as e:
        logger.error(f"사용 통계 조회 실패: {e}")
        return {"total": 0, "today": 0, "this_week": 0, "daily": [], "hourly": [], "top_queries": []}

@router.post("/api/admin/rag-test")
async def rag_search_test(req: RagTestRequest, user_info: dict = Depends(_require_admin)):
    """RAG 검색 품질 테스트 — 쿼리별 검색 경로, 청크, 리랭킹, LLM 답변 동시 반환"""
    if not RAGManager._is_ready:
        raise HTTPException(status_code=503, detail="RAG 엔진 준비 중입니다.")
    query = req.query.strip()
    try:
        # 요청 파라미터 우선 적용 — 미지정 시 실서비스 search_params 사용
        sp = RAGManager.search_params
        vk  = req.vector_k    if req.vector_k    is not None else sp["vector_k"]
        bk  = req.bm25_k      if req.bm25_k      is not None else sp["bm25_k"]
        ftk = req.final_top_k if req.final_top_k is not None else sp["final_top_k"]
        mode = req.mode       if req.mode         is not None else sp["mode"]

        # 1. Vector 검색 (child 단위) — 검색 경로 추적용
        child_results = RAGManager.chain.retriever.child_vs.similarity_search(query, k=vk)
        vector_parent_ids = set()
        child_map: dict = {}
        for child in child_results:
            pid = child.metadata.get("parent_id")
            if pid:
                vector_parent_ids.add(pid)
                if pid not in child_map:
                    child_map[pid] = child.page_content

        # 2. BM25 검색 (parent 단위) — 검색 경로 추적용
        bm25_docs = RAGManager.chain.retriever.bm25.search(query, k=bk)
        bm25_parent_ids = set()
        for doc in bm25_docs:
            did = doc.metadata.get("doc_id", "")
            if did:
                bm25_parent_ids.add(did)

        # 3. 하이브리드 통합 + 리랭킹 (테스트 파라미터 적용)
        combined = RAGManager.chain.retriever.search(query, vector_k=vk, bm25_k=bk, mode=mode)
        total_candidates = len(combined)
        pre_rerank_order = {doc.metadata.get("doc_id", ""): i + 1 for i, doc in enumerate(combined)}
        scored = RAGManager.chain.reranker.rerank(query, combined, top_k=ftk)

        # 4. LLM 답변 생성 (실제 chat_generator와 동일한 파이프라인)
        answer = "관련 문서를 찾을 수 없습니다."
        if scored:
            final_docs = [doc for doc, _ in scored]
            context = "\n\n".join([f"[참조 {i+1}] {d.page_content}" for i, d in enumerate(final_docs)])
            system_base = f"당신은 {COMPANY_NAME} 사내 문서 기반 AI 어시스턴트입니다.\n반드시 아래 [사내 문서 검색 결과]에 있는 내용만을 근거로 답변하세요.\n문서에 없는 내용은 절대 추측하거나 일반 지식으로 보완하지 마세요. 문서에서 찾을 수 없는 경우 '해당 내용은 제공된 사내 문서에서 확인되지 않습니다.'라고만 답하세요.\n(추정), (가능성), (일반적으로) 등의 표현은 절대 사용하지 마세요."
            prompt = f"{system_base}\n\n[사내 문서 검색 결과]\n{context}\n\n[사용자 질문]\n{query}\n\n답변:"
            try:
                resp = RAGManager.chain._llm.invoke(prompt)
                answer = resp.content.strip() if hasattr(resp, "content") else str(resp).strip()
            except Exception as e:
                answer = f"답변 생성 실패: {e}"

        # 5. 결과 조립
        sentence_endings = ('다.', '요.', '다!', '요!', '다?', '요?', '다,', ')', '】', '다\n', '요\n')
        results = []
        for rank, (doc, score) in enumerate(scored, 1):
            doc_id = doc.metadata.get("doc_id", "")
            in_v = doc_id in vector_parent_ids
            in_b = doc_id in bm25_parent_ids
            source = "both" if (in_v and in_b) else ("vector" if in_v else ("bm25" if in_b else "unknown"))
            child_text = child_map.get(doc_id, "")
            parent_text = doc.page_content
            check = (child_text or parent_text).strip()
            is_truncated = bool(check) and len(check) > 50 and not any(check.endswith(e) for e in sentence_endings)
            pre_rank = pre_rerank_order.get(doc_id, "?")
            results.append({
                "rank": rank,
                "filename": os.path.basename(str(doc.metadata.get("source_file", "알 수 없음"))),
                "page_no": doc.metadata.get("page_no", "?"),
                "rerank_score": round(float(score) * 100, 1),
                "search_source": source,
                "pre_rerank_rank": pre_rank,
                "rank_change": (pre_rank - rank) if isinstance(pre_rank, int) else 0,
                "child_content": child_text,
                "child_size": len(child_text),
                "parent_content": parent_text,
                "parent_size": len(parent_text),
                "is_truncated": is_truncated,
            })

        # 6. 최근 zero_hits
        zero_hits: list = []
        try:
            conn = sqlite3.connect(FEEDBACK_DB)
            c = conn.cursor()
            c.execute("SELECT DISTINCT query FROM zero_hits ORDER BY timestamp DESC LIMIT 5")
            zero_hits = [r[0] for r in c.fetchall()]
            conn.close()
        except Exception:
            pass

        return {
            "query": query,
            "total_candidates": total_candidates,
            "results": results,
            "answer": answer,
            "zero_hits": zero_hits,
            "applied_params": {"vector_k": vk, "bm25_k": bk, "final_top_k": ftk, "mode": mode},
        }
    except Exception as e:
        logger.error(f"RAG 테스트 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/admin/verify-password")
async def verify_admin_password(req: VerifyPasswordRequest, user_info: dict = Depends(_require_admin)):
    """관리자 비밀번호 재확인 — 위험한 작업 실행 전 검증용"""
    try:
        conn = sqlite3.connect(FEEDBACK_DB)
        c = conn.cursor()
        c.execute("SELECT hashed_password FROM users WHERE username=? AND role='admin'", (user_info["username"],))
        row = c.fetchone()
        conn.close()
        if not row or not verify_password(req.password, row[0]):
            raise HTTPException(status_code=403, detail="비밀번호가 올바르지 않습니다.")
        return {"verified": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/admin/usage-stats/reset")
async def reset_usage_stats(user_info: dict = Depends(_require_admin)):
    """사용 통계(질의 로그) 초기화"""
    try:
        conn = sqlite3.connect(FEEDBACK_DB)
        conn.execute("DELETE FROM query_logs")
        conn.commit()
        conn.close()
        logger.warning(f"🗑️ [관리자] 사용 통계(query_logs) 초기화 완료 — {user_info['username']}")
        return {"status": "success", "message": "사용 통계가 초기화되었습니다."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/admin/clear-vram")
async def clear_vram(user_info: dict = Depends(_require_admin)):
    """원격 GPU 캐시 정리 (Kill Switch)"""
    try:
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        gc.collect()
        logger.warning("🧹 [관리자] VRAM 캐시가 수동으로 초기화되었습니다.")
        return {"status": "success", "message": "VRAM 캐시 정리 완료"}
    except Exception as e:
        logger.error(f"❌ VRAM 정리 실패: {e}")
        raise HTTPException(status_code=500, detail="캐시 정리 중 오류가 발생했습니다.")

@router.post("/api/admin/clear-logs")
async def clear_logs(user_info: dict = Depends(_require_admin)):
    """실시간 로그 및 지식 공백 초기화"""
    try:
        # 1. 메모리 로그 초기화
        live_queries.clear()

        # 2. DB 지식 공백 초기화
        with sqlite3.connect(FEEDBACK_DB) as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM zero_hits")
            conn.commit()

        logger.warning("🗑️ [관리자] 모든 실시간 질의 로그 및 지식 공백 데이터가 초기화되었습니다.")
        return {"status": "success", "message": "모든 로그 초기화 완료"}
    except Exception as e:
        logger.error(f"❌ 로그 초기화 실패: {e}")
        raise HTTPException(status_code=500, detail="로그 초기화 중 오류가 발생했습니다.")

@router.patch("/api/admin/chunk-config")
async def update_chunk_config(req: dict, user_info: dict = Depends(_require_admin)):
    """[벤치마크용] 청크 크기 설정 변경 (다음 재인덱싱부터 적용)"""
    for k in ("parent_size", "child_size", "parent_overlap", "child_overlap"):
        if k in req and req[k] is not None:
            chunk_config[k] = int(req[k])
    logger.info(f"청크 설정 업데이트: {chunk_config}")
    return chunk_config

@router.get("/api/admin/chunk-config")
async def get_chunk_config(user_info: dict = Depends(_require_admin)):
    return chunk_config

@router.get("/api/admin/users")
async def list_users(user_info: dict = Depends(_require_admin)):
    """전체 사용자 목록 조회 (pending 포함)"""
    with sqlite3.connect(FEEDBACK_DB) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT id, username, role, created_at, is_active, status, display_name, dept, auth_type FROM users ORDER BY created_at DESC"
        ).fetchall()
    return {"users": [dict(r) for r in rows]}

@router.post("/api/admin/users/{username}/approve")
async def approve_user(username: str, user_info: dict = Depends(_require_admin)):
    """가입 신청 승인"""
    with sqlite3.connect(FEEDBACK_DB) as conn:
        result = conn.execute(
            "UPDATE users SET status = 'active' WHERE username = ? AND status = 'pending'",
            (username,)
        )
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="대기 중인 신청을 찾을 수 없습니다.")
    logger.info(f"✅ [가입 승인] {username} — by {user_info['username']}")
    return {"success": True, "username": username}

@router.post("/api/admin/users/{username}/reject")
async def reject_user(username: str, user_info: dict = Depends(_require_admin)):
    """가입 신청 거절 (삭제)"""
    with sqlite3.connect(FEEDBACK_DB) as conn:
        result = conn.execute(
            "DELETE FROM users WHERE username = ? AND status = 'pending'",
            (username,)
        )
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="대기 중인 신청을 찾을 수 없습니다.")
    logger.info(f"❌ [가입 거절] {username} — by {user_info['username']}")
    return {"success": True, "username": username}

@router.post("/api/admin/users")
async def create_user(req: CreateUserRequest, user_info: dict = Depends(_require_admin)):
    """신규 사용자 계정 생성"""
    if req.role not in ("admin", "user"):
        raise HTTPException(status_code=400, detail="역할은 'admin' 또는 'user'만 허용됩니다.")
    if len(req.password) < 4:
        raise HTTPException(status_code=400, detail="비밀번호는 최소 4자 이상이어야 합니다.")
    try:
        with sqlite3.connect(FEEDBACK_DB) as conn:
            conn.execute(
                "INSERT INTO users (username, hashed_password, role) VALUES (?, ?, ?)",
                (req.username.strip(), get_password_hash(req.password), req.role)
            )
        logger.info(f"✅ [계정 생성] {req.username} (role: {req.role}) — by {user_info['username']}")
        return {"success": True, "username": req.username, "role": req.role}
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail=f"이미 존재하는 아이디입니다: {req.username}")

@router.delete("/api/admin/users/{username}")
async def delete_user(username: str, user_info: dict = Depends(_require_admin)):
    """사용자 계정 삭제"""
    if username == user_info["username"]:
        raise HTTPException(status_code=400, detail="본인 계정은 삭제할 수 없습니다.")
    with sqlite3.connect(FEEDBACK_DB) as conn:
        result = conn.execute("DELETE FROM users WHERE username = ?", (username,))
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail=f"존재하지 않는 사용자: {username}")
    logger.info(f"🗑️ [계정 삭제] {username} — by {user_info['username']}")
    return {"success": True, "deleted": username}

@router.patch("/api/admin/users/{username}/role")
async def change_user_role(username: str, req: ChangeRoleRequest, user_info: dict = Depends(_require_admin)):
    """사용자 역할 변경 (admin ↔ user)"""
    if req.role not in ("admin", "user"):
        raise HTTPException(status_code=400, detail="역할은 'admin' 또는 'user'만 허용됩니다.")
    if username == user_info["username"]:
        raise HTTPException(status_code=400, detail="본인 역할은 변경할 수 없습니다.")
    with sqlite3.connect(FEEDBACK_DB) as conn:
        result = conn.execute("UPDATE users SET role = ? WHERE username = ?", (req.role, username))
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail=f"존재하지 않는 사용자: {username}")
    logger.info(f"🔄 [역할 변경] {username} → {req.role} — by {user_info['username']}")
    return {"success": True, "username": username, "role": req.role}

@router.patch("/api/admin/users/{username}/password")
async def admin_reset_password(username: str, req: AdminResetPasswordRequest, user_info: dict = Depends(_require_admin)):
    """Admin이 다른 사용자 비밀번호 강제 초기화"""
    if len(req.new_password) < 4:
        raise HTTPException(status_code=400, detail="비밀번호는 최소 4자 이상이어야 합니다.")
    with sqlite3.connect(FEEDBACK_DB) as conn:
        result = conn.execute("UPDATE users SET hashed_password = ? WHERE username = ?",
                     (get_password_hash(req.new_password), username))
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail=f"존재하지 않는 사용자: {username}")
    logger.info(f"🔐 [비밀번호 초기화] {username} — by {user_info['username']}")
    return {"success": True}

@router.patch("/api/admin/users/{username}/active")
async def toggle_user_active(username: str, req: ToggleActiveRequest, user_info: dict = Depends(_require_admin)):
    """계정 활성화/정지 토글"""
    if username == user_info["username"]:
        raise HTTPException(status_code=400, detail="본인 계정은 변경할 수 없습니다.")
    with sqlite3.connect(FEEDBACK_DB) as conn:
        result = conn.execute("UPDATE users SET is_active = ? WHERE username = ?",
                     (1 if req.is_active else 0, username))
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail=f"존재하지 않는 사용자: {username}")
    action = "활성화" if req.is_active else "정지"
    logger.info(f"🔒 [계정 {action}] {username} — by {user_info['username']}")
    return {"success": True, "username": username, "is_active": req.is_active}


@router.get("/api/admin/stats")
async def get_system_stats(user_info: dict = Depends(_require_admin)):
    """시스템 실시간 모니터링 지표 반환"""
    stats = {
        "hardware": {},
        "performance": {},
        "service": {},
        "live_queries": live_queries,
        "zero_hits": []
    }
    
    # 실제 엔진이 사용 중인 GPU 번호 파싱 (예: "cuda:1" -> 1)
    try:
        gpu_idx = int(RAGManager.config.get("device", "cuda:0").split(":")[-1])
    except:
        gpu_idx = 0

    # 하드웨어 정보 — 모든 GPU 수집
    gpus = []
    if HAS_NVML:
        try:
            gpu_count = pynvml.nvmlDeviceGetCount()
            for i in range(gpu_count):
                handle = pynvml.nvmlDeviceGetHandleByIndex(i)
                meminfo = pynvml.nvmlDeviceGetMemoryInfo(handle)
                util = pynvml.nvmlDeviceGetUtilizationRates(handle)
                temp = pynvml.nvmlDeviceGetTemperature(handle, pynvml.NVML_TEMPERATURE_GPU)
                name = pynvml.nvmlDeviceGetName(handle)
                gpus.append({
                    "gpu_index": i,
                    "gpu_name": name if isinstance(name, str) else name.decode(),
                    "gpu_temp": temp,
                    "gpu_util": util.gpu,
                    "vram_used": meminfo.used / (1024**2),
                    "vram_total": meminfo.total / (1024**2),
                    "is_rag_device": i == gpu_idx,
                })
        except Exception as e:
            logger.error(f"NVML 조회 실패: {e}")
    elif torch.cuda.is_available():
        for i in range(torch.cuda.device_count()):
            gpus.append({
                "gpu_index": i,
                "gpu_name": torch.cuda.get_device_name(i),
                "gpu_temp": 0,
                "gpu_util": 0,
                "vram_used": torch.cuda.memory_allocated(i) / (1024**2),
                "vram_total": torch.cuda.get_device_properties(i).total_memory / (1024**2),
                "is_rag_device": i == gpu_idx,
            })

    stats["hardware"] = {
        "gpus": gpus,
        # 하위 호환: 단일 GPU 필드도 유지 (RAG 엔진이 쓰는 GPU 기준)
        **(gpus[gpu_idx] if gpu_idx < len(gpus) else {}),
    }

    # 성능 정보 (TPS)
    stats["performance"]["tps_avg"] = sum(tps_history) / len(tps_history) if tps_history else 0
    stats["performance"]["tps_history"] = tps_history

    # 서비스 상태
    stats["service"]["vllm_health"] = await check_vllm_health()
    uptime_sec = int(time.time() - start_time)
    hours, rem = divmod(uptime_sec, 3600)
    minutes, seconds = divmod(rem, 60)
    stats["service"]["uptime"] = f"{hours}h {minutes}m" if hours > 0 else f"{minutes}m {seconds}s"
    # [모델 전환] 현재 모델 및 전환 가능한 모델 목록
    stats["service"]["current_model"]    = RAGManager.config.get("llm_model", "unknown")
    stats["service"]["available_models"] = os.getenv("AVAILABLE_MODELS", "gemma4:e2b").split(",")

    # Zero hits — 전량(상세) + 묶음 집계(마이닝: 같은 질문 빈도순 = 몇 명이 뭘 못 찾는지)
    try:
        conn = sqlite3.connect(FEEDBACK_DB)
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        c.execute("SELECT id, query, datetime(timestamp, '+9 hours') as timestamp FROM zero_hits ORDER BY timestamp DESC")
        stats["zero_hits"] = [dict(r) for r in c.fetchall()]
        # [마이닝] 같은 질문끼리 묶어 빈도순 정렬 → 반복 실패 질문(=진짜 지식 공백)을 상단에 노출.
        #   ★최근 N일만 집계(기본 14, ZERO_HIT_MINING_DAYS로 조정) — 오래된 개발 테스트·수정 이전
        #     기록이 상단을 점령하는 오염을 배제하고 '지금 살아있는' 실패 신호만 본다.
        #   category=regulation(사내규정 관련 → HR/검색 보강 대상) vs general(일반지식·잡담 → 일반대화 모드 커버).
        # 사내규정 관련 여부 자동분류용 키워드(범용 HR 어휘). .env ZERO_HIT_REG_KEYWORDS로 회사 맞춤 가능.
        _REG_KW = tuple(k.strip() for k in os.getenv(
            "ZERO_HIT_REG_KEYWORDS",
            "연차,휴가,급여,수당,여비,출장,경조,학자금,통신비,차량,인사,복지,채용,퇴직,근태,정년,보험,승인,규정,제도,징계,포상"
        ).split(",") if k.strip())
        _mine_days = int(os.getenv("ZERO_HIT_MINING_DAYS", "14"))
        _win = "-%d days" % _mine_days
        c.execute("SELECT query, COUNT(*) AS cnt, MAX(datetime(timestamp,'+9 hours')) AS last_seen "
                  "FROM zero_hits WHERE timestamp > datetime('now', ?) "
                  "GROUP BY query ORDER BY cnt DESC, last_seen DESC LIMIT 40", (_win,))
        top = []
        for r in c.fetchall():
            q = r["query"] or ""
            cat = "regulation" if any(k in q for k in _REG_KW) else "general"
            top.append({"query": q, "count": r["cnt"], "last_seen": r["last_seen"], "category": cat})
        stats["zero_hits_top"] = top
        # 요약도 동일 기간(최근 N일)으로 집계 — 상세 리스트(stats["zero_hits"])는 전량 유지.
        _wq = [(r["query"] or "") for r in
               c.execute("SELECT query FROM zero_hits WHERE timestamp > datetime('now', ?)", (_win,)).fetchall()]
        _reg = sum(1 for q in _wq if any(k in q for k in _REG_KW))
        stats["zero_hits_summary"] = {
            "regulation": _reg,
            "general": len(_wq) - _reg,
            "distinct": len(top),
            "window_days": _mine_days,
        }
        conn.close()
    except Exception:
        pass

    return stats

@router.get("/api/admin/alert-settings")
async def get_alert_settings(user_info: dict = Depends(_require_admin)):
    """현재 알림 임계값 반환"""
    return ALERT_SETTINGS.copy()

@router.patch("/api/admin/alert-settings")
async def update_alert_settings(req: dict, user_info: dict = Depends(_require_admin)):
    """알림 임계값 실시간 업데이트 (재시작 시 기본값 복귀)"""
    if "gpu_temp_threshold" in req:
        v = int(req["gpu_temp_threshold"])
        if not (50 <= v <= 100):
            raise HTTPException(status_code=400, detail="GPU 온도 임계값은 50~100°C 사이여야 합니다.")
        ALERT_SETTINGS["gpu_temp_threshold"] = v
    if "zero_hit_interval_hours" in req:
        v = int(req["zero_hit_interval_hours"])
        if not (1 <= v <= 24):
            raise HTTPException(status_code=400, detail="Zero-hit 알림 간격은 1~24시간 사이여야 합니다.")
        ALERT_SETTINGS["zero_hit_interval_hours"] = v
    if "daily_summary_hour" in req:
        v = int(req["daily_summary_hour"])
        if not (0 <= v <= 23):
            raise HTTPException(status_code=400, detail="일일 요약 발송 시각은 0~23시 사이여야 합니다.")
        ALERT_SETTINGS["daily_summary_hour"] = v
    logger.info(f"알림 임계값 업데이트: {ALERT_SETTINGS}")
    return ALERT_SETTINGS.copy()
