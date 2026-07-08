"""[routes/widget] 외부 임베딩 위젯 API — 게스트토큰 발급/검증·TOP질문·위젯 채팅 SSE. APIRouter.
config·core.auth·schemas·deps·db·rag.generator 의존.
※ 리팩토링 이동 — 본문 byte-동일(@app→@router)."""
import os
import sqlite3
import time
import asyncio
import logging
from datetime import timedelta

from fastapi import APIRouter, Request, Depends, HTTPException
from fastapi.responses import StreamingResponse
from jose import JWTError, jwt as _jwt

from config import FEEDBACK_DB, DOCS_PATH, extract_doc_name
from core.auth import create_access_token
from schemas import ChatRequest
from deps import limiter
from db import _qlog_start, _qlog_finish
from rag.generator import chat_generator

logger = logging.getLogger("main")

router = APIRouter()


def _verify_widget_token(request: Request) -> str:
    """Authorization: Bearer 헤더에서 위젯 게스트 토큰 검증"""
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="위젯 토큰이 없습니다.")
    token = auth_header.split(" ")[1]
    try:
        payload = _jwt.decode(token, os.getenv("JWT_SECRET_KEY"), algorithms=["HS256"])
        if payload.get("role") != "widget":
            raise HTTPException(status_code=403, detail="위젯 전용 토큰이 아닙니다.")
        return payload.get("sub", "widget_guest")
    except JWTError:
        raise HTTPException(status_code=401, detail="유효하지 않거나 만료된 위젯 토큰입니다.")

@router.get("/api/widget/token")
async def get_widget_token():
    """게스트 JWT 발급 — 인증 불필요, 1시간 유효. widget.js가 로드될 때 자동 호출."""
    token = create_access_token(
        data={"sub": "widget_guest", "role": "widget"},
        expires_delta=timedelta(hours=1),
    )
    return {"token": token}

@router.get("/api/widget/top-questions")
async def get_top_questions():
    """최근 30일 가장 많이 사용된 문서 TOP 4 → '[문서명]에 대해서 설명해주세요' 형식 반환"""
    def _fallback_from_docs() -> list:
        """knowledge base 문서 목록에서 fallback 생성"""
        try:
            files = sorted([f for f in os.listdir(DOCS_PATH) if f.lower().endswith('.pdf')])[:4]
            return [f"{extract_doc_name(f)}에 대해서 설명해주세요" for f in files]
        except Exception:
            return [
                '취업규칙에 대해서 설명해주세요',
                '인사규정에 대해서 설명해주세요',
                '경조사 지원 기준에 대해서 설명해주세요',
                '국내여비규정에 대해서 설명해주세요',
            ]

    try:
        conn = sqlite3.connect(FEEDBACK_DB)
        c = conn.cursor()
        c.execute("""
            SELECT source_file, COUNT(*) as cnt
            FROM doc_access_logs
            WHERE timestamp >= datetime('now', '-30 days')
            GROUP BY source_file
            ORDER BY cnt DESC
            LIMIT 4
        """)
        rows = c.fetchall()
        conn.close()

        if len(rows) >= 4:
            questions = [f"{extract_doc_name(r[0])}에 대해서 설명해주세요" for r in rows]
            return {"questions": questions}
        else:
            return {"questions": _fallback_from_docs()}
    except Exception:
        return {"questions": _fallback_from_docs()}

@router.post("/api/widget/chat/stream")
@limiter.limit("15/minute")
async def widget_chat_stream(req: ChatRequest, request: Request, _user: str = Depends(_verify_widget_token)):
    """위젯 전용 SSE 스트림 — 게스트 JWT 필요, 기존 RAG 파이프라인 재사용"""
    async def _guarded_generator():
        _rid = _qlog_start(req.query, "🌐 위젯게스트")
        _t0 = time.monotonic()
        _status = "ok"
        try:
            async for chunk in chat_generator(req.query, None, req.history, req.user_profile, req.web_search, username="🌐 위젯게스트"):
                if await request.is_disconnected():
                    _status = "disconnected"
                    break
                yield chunk
        except asyncio.CancelledError:
            _status = "disconnected"
            raise
        except Exception as _e:
            _status = "error"
            logger.error(f"❌ [C-1] 위젯 스트리밍 중 예외 — 사용자에게 안내: {_e}")
            yield ("data: \\n\\n⚠️ 답변 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.\n\n")
            yield "data: [DONE]\n\n"
        finally:
            _qlog_finish(_rid, int((time.monotonic() - _t0) * 1000), _status)
    return StreamingResponse(_guarded_generator(), media_type="text/event-stream")
