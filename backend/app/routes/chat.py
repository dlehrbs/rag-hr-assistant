"""[routes/chat] 채팅 SSE 스트리밍(연결해제 감지·관제계측) + 피드백 제출. APIRouter.
config·core.auth·schemas·deps·db·projects_logic·rag.generator 의존.
※ 리팩토링 이동 — 엔드포인트 본문 byte-동일(@app→@router)."""
import sqlite3
import time
import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

from config import FEEDBACK_DB
from core.auth import get_current_user
from schemas import ChatRequest, FeedbackRequest
from deps import limiter
from db import _qlog_start, _qlog_finish
from projects_logic import _get_project_role
from rag.generator import chat_generator

logger = logging.getLogger("main")

router = APIRouter()


@router.post("/api/chat/stream")
@limiter.limit("10/minute")
async def chat_stream(req: ChatRequest, request: Request, user: str = Depends(get_current_user)):
    """[C-05] SSE 스트리밍 — 클라이언트 연결 해제 시 vLLM 추론 자동 중단"""
    # 요청 로그에서 채팅 종류를 구분하기 위해 state에 표시
    request.state.chat_kind = "프로젝트" if req.project_id else ("파일첨부" if req.file_id else "일반")
    # [보안] 프로젝트 채팅은 소유자/멤버만 — 비멤버가 타인 프로젝트에 질의하는 것 차단
    if req.project_id:
        _c = sqlite3.connect(FEEDBACK_DB)
        _role = _get_project_role(_c, req.project_id, user)
        _c.close()
        if _role is None:
            raise HTTPException(status_code=403, detail="이 프로젝트에 접근할 권한이 없습니다.")
    async def _guarded_generator():
        _rid = _qlog_start(req.query, user)
        _t0 = time.monotonic()
        _status = "ok"
        try:
            async for chunk in chat_generator(req.query, req.file_id, req.history, req.user_profile, req.web_search, req.project_id, username=user, answer_mode=req.answer_mode):
                if await request.is_disconnected():
                    logger.info("🔌 클라이언트 연결 해제 감지 — vLLM 스트리밍 중단")
                    _status = "disconnected"
                    break
                yield chunk
        except asyncio.CancelledError:
            _status = "disconnected"
            raise
        except Exception as _e:
            # [C-1] 스트리밍 도중 vLLM/엔진 예외 — raw 끊김 대신 안내 후 정상 종료
            _status = "error"
            logger.error(f"❌ [C-1] 스트리밍 중 예외 — 사용자에게 안내: {_e}")
            yield ("data: \\n\\n⚠️ 답변 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.\n\n")
            yield "data: [DONE]\n\n"
        finally:
            _qlog_finish(_rid, int((time.monotonic() - _t0) * 1000), _status)
    return StreamingResponse(_guarded_generator(), media_type="text/event-stream")

@router.post("/api/feedback")
async def submit_feedback(feedback: FeedbackRequest):
    """사용자 피드백 저장 API [RLHF-01]"""
    try:
        conn = sqlite3.connect(FEEDBACK_DB)
        cursor = conn.cursor()
        cursor.execute("""
            INSERT OR REPLACE INTO feedbacks (id, question, answer, score, sources, comment)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (feedback.message_id, feedback.question, feedback.answer, feedback.score, feedback.sources, feedback.comment))
        conn.commit()
        conn.close()
        logger.info(f"💾 피드백 저장 성공: {feedback.message_id} ({'UP' if feedback.score > 0 else 'DOWN'})")
        return {"status": "success"}
    except Exception as e:
        logger.error(f"❌ 피드백 저장 실패: {e}")
        raise HTTPException(status_code=500, detail="피드백 저장 중 오류가 발생했습니다.")
