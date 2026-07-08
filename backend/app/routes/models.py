"""[routes/models] 모델 전환·현재모델 조회·내 비밀번호 변경. APIRouter.
config·core.auth·rag.manager·schemas·deps 의존.
※ 리팩토링 이동 — 본문 byte-동일(@app→@router)."""
import os
import sqlite3
import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException

from config import FEEDBACK_DB
from core.auth import get_current_user, get_current_user_info, verify_password, get_password_hash
from rag.manager import RAGManager
from schemas import SwitchModelRequest, ChangePasswordRequest
from deps import _require_admin

logger = logging.getLogger("main")

router = APIRouter()


@router.get("/api/current-model")
async def get_current_model(user: str = Depends(get_current_user)):
    """사이드바 전용 경량 엔드포인트 — 현재 모델명만 반환"""
    return {
        "current_model": RAGManager.config.get("llm_model", "unknown"),
        "available_models": [m.strip() for m in os.getenv("AVAILABLE_MODELS", "gemma4:e2b").split(",")],
    }

@router.put("/api/users/me/password")
async def change_my_password(req: ChangePasswordRequest, user_info: dict = Depends(get_current_user_info)):
    """본인 비밀번호 변경"""
    username = user_info["username"]
    with sqlite3.connect(FEEDBACK_DB) as conn:
        row = conn.execute("SELECT hashed_password FROM users WHERE username = ?", (username,)).fetchone()
    if not row or not verify_password(req.current_password, row[0]):
        raise HTTPException(status_code=401, detail="현재 비밀번호가 올바르지 않습니다.")
    if len(req.new_password) < 4:
        raise HTTPException(status_code=400, detail="비밀번호는 최소 4자 이상이어야 합니다.")
    with sqlite3.connect(FEEDBACK_DB) as conn:
        conn.execute("UPDATE users SET hashed_password = ? WHERE username = ?",
                     (get_password_hash(req.new_password), username))
    logger.info(f"🔐 [비밀번호 변경] {username}")
    return {"success": True}

async def _do_switch_model(model: str):
    available = [m.strip() for m in os.getenv("AVAILABLE_MODELS", "gemma4:e2b").split(",")]
    if model not in available:
        raise HTTPException(status_code=400, detail=f"허용되지 않은 모델입니다. 사용 가능: {available}")
    if model == RAGManager.config.get("llm_model"):
        return {"success": True, "current_model": model, "message": "이미 해당 모델이 활성화되어 있습니다."}
    try:
        await asyncio.to_thread(RAGManager.switch_model, model)
        logger.info(f"✅ [모델 전환 완료] → {model}")
        return {"success": True, "current_model": model}
    except Exception as e:
        logger.error(f"❌ 모델 전환 실패: {e}")
        raise HTTPException(status_code=500, detail=f"모델 전환 중 오류 발생: {str(e)}")

@router.post("/api/switch-model")
async def switch_model_user(req: SwitchModelRequest, user_info: dict = Depends(_require_admin)):
    """활성 LLM 모델을 런타임에 교체 — 전역 영향(GPU 재로딩, 전사 수분 중단)이라 admin 전용
    [2026-06-12 SSO 검수] 전직원 오픈 대비 일반 사용자 권한 회수"""
    return await _do_switch_model(req.model)

@router.post("/api/admin/switch-model")
async def switch_model_admin(req: SwitchModelRequest, user_info: dict = Depends(_require_admin)):
    """활성 LLM 모델을 런타임에 교체 (admin 대시보드 전용)"""
    return await _do_switch_model(req.model)
