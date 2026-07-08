"""[deps] 공유 의존성 — rate limiter(+키 함수)·관리자 가드. main·routes/* 공용.
core.auth·slowapi에만 의존(순환 없음).
※ 리팩토링으로 main.py에서 이동 — 함수 본문 byte-동일."""
from fastapi import Request, Depends, HTTPException
from slowapi import Limiter
from slowapi.util import get_remote_address
from core.auth import get_current_user_info


def _real_client_ip(request: Request) -> str:
    """rate limit 키용 실제 클라이언트 IP.
    브라우저→nginx→frontend→backend 경로라 remote_addr은 frontend 컨테이너 IP로 고정됨
    (전 사용자가 한 버킷을 공유하는 버그) → X-Forwarded-For 첫 IP를 우선 사용"""
    xff = request.headers.get("X-Forwarded-For")
    if xff:
        return xff.split(",")[0].strip()
    return get_remote_address(request)


# ── Rate Limiting ─────────────────────────────────────────────────────────────
# 내부망 사용자는 IP가 같을 수 있으므로 인증된 요청은 username 기준으로 제한
def _rate_limit_key(request: Request) -> str:
    username = request.cookies.get("rag_username")
    if username:
        return f"user:{username}"
    return get_remote_address(request)


limiter = Limiter(key_func=_rate_limit_key)


def _require_admin(user_info: dict = Depends(get_current_user_info)):
    """관리자 권한 검증 — admin 역할이 아니면 403 반환"""
    if user_info.get("role") != "admin":
        raise HTTPException(status_code=403, detail="관리자 권한이 필요합니다.")
    return user_info
