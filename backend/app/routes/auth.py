"""[routes/auth] 인증 엔드포인트 — 로그인/회원가입/토큰갱신/로그아웃.
config·core.auth·schemas·deps에만 의존. main이 include_router로 등록."""
import sqlite3
import logging
from datetime import datetime, timedelta

from fastapi import APIRouter, Request, Response, HTTPException

from config import FEEDBACK_DB
from core.auth import create_access_token, create_refresh_token, verify_password, get_password_hash
from schemas import LoginRequest, RegisterRequest
from deps import limiter, _real_client_ip

logger = logging.getLogger("main")

router = APIRouter()


@router.post("/api/auth/login")
@limiter.limit("5/minute", key_func=_real_client_ip)  # 로그인은 실제 클라이언트 IP 기준
async def login(req: LoginRequest, request: Request, response: Response):
    """보안 로그인 — Access Token(2시간) + Refresh Token(7일) 동시 발급"""
    conn = sqlite3.connect(FEEDBACK_DB)
    cursor = conn.cursor()
    cursor.execute(
        "SELECT hashed_password, role, is_active, status FROM users WHERE username = ?",
        (req.username,)
    )
    row = cursor.fetchone()
    conn.close()

    if not row or not verify_password(req.password, row[0]):
        logger.warning(f"🔒 [로그인 실패] 아이디 또는 비밀번호 불일치 (입력 아이디: {req.username})")
        raise HTTPException(status_code=401, detail="아이디 또는 비밀번호가 올바르지 않습니다.")
    if row[3] == 'pending':
        logger.info(f"⛔ [로그인 거부] 승인 대기 계정: {req.username}")
        raise HTTPException(status_code=403, detail="승인 대기 중입니다. 관리자 승인 후 로그인하세요.")
    if row[3] == 'rejected':
        logger.info(f"⛔ [로그인 거부] 가입 거절 계정: {req.username}")
        raise HTTPException(status_code=403, detail="가입이 거절되었습니다. 관리자에게 문의하세요.")
    if not row[2]:
        logger.info(f"⛔ [로그인 거부] 정지된 계정: {req.username}")
        raise HTTPException(status_code=403, detail="계정이 정지되었습니다. 관리자에게 문의하세요.")

    role = row[1]
    logger.info(f"🔑 [로그인 성공] {req.username} (권한: {'관리자' if role == 'admin' else '일반사용자'})")
    access_token = create_access_token(data={"sub": req.username, "role": role})
    refresh_token = create_refresh_token()

    # Refresh Token DB 저장 (이전 토큰 삭제 후 신규 저장)
    expires_at = datetime.utcnow() + timedelta(days=7)
    with sqlite3.connect(FEEDBACK_DB) as conn:
        conn.execute("DELETE FROM refresh_tokens WHERE username = ?", (req.username,))
        conn.execute(
            "INSERT INTO refresh_tokens (token, username, expires_at) VALUES (?, ?, ?)",
            (refresh_token, req.username, expires_at.isoformat())
        )

    # Access Token: 2시간 쿠키
    response.set_cookie(key="rag_session", value=access_token, httponly=True,
                        max_age=60*60*2, samesite="lax", secure=True)
    # Refresh Token: 7일 쿠키 (HttpOnly — JS 접근 불가)
    response.set_cookie(key="rag_refresh", value=refresh_token, httponly=True,
                        max_age=60*60*24*7, samesite="lax", secure=True)
    response.set_cookie(key="rag_role", value=role, httponly=False,
                        max_age=60*60*24*7, samesite="lax", secure=True)
    response.set_cookie(key="rag_username", value=req.username, httponly=False,
                        max_age=60*60*24*7, samesite="lax", secure=True)
    return {"success": True, "role": role, "session_token": access_token, "refresh_token": refresh_token}

@router.post("/api/auth/register")
async def register(req: RegisterRequest):
    """회원가입 신청 — 관리자 승인 대기 상태로 저장"""
    username = req.username.strip()
    if len(username) < 2:
        raise HTTPException(status_code=400, detail="아이디는 최소 2자 이상이어야 합니다.")
    if len(req.password) < 4:
        raise HTTPException(status_code=400, detail="비밀번호는 최소 4자 이상이어야 합니다.")
    try:
        with sqlite3.connect(FEEDBACK_DB) as conn:
            conn.execute(
                "INSERT INTO users (username, hashed_password, role, status) VALUES (?, ?, 'user', 'pending')",
                (username, get_password_hash(req.password))
            )
        logger.info(f"📝 [회원가입 신청] {username}")
        return {"success": True, "message": "가입 신청이 완료되었습니다. 관리자 승인 후 로그인하세요."}
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail=f"이미 사용 중인 아이디입니다: {username}")

@router.post("/api/auth/refresh")
async def refresh_access_token(request: Request, response: Response):
    """Refresh Token으로 새 Access Token 발급 — 프론트엔드 자동 갱신용"""
    refresh_token = request.cookies.get("rag_refresh")
    if not refresh_token:
        raise HTTPException(status_code=401, detail="Refresh Token이 없습니다. 다시 로그인해주세요.")

    with sqlite3.connect(FEEDBACK_DB) as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT username, expires_at FROM refresh_tokens WHERE token = ?",
            (refresh_token,)
        )
        row = cursor.fetchone()

    if not row:
        raise HTTPException(status_code=401, detail="유효하지 않은 Refresh Token입니다.")

    username, expires_at = row[0], row[1]
    if datetime.utcnow() > datetime.fromisoformat(expires_at):
        with sqlite3.connect(FEEDBACK_DB) as conn:
            conn.execute("DELETE FROM refresh_tokens WHERE token = ?", (refresh_token,))
        raise HTTPException(status_code=401, detail="Refresh Token이 만료되었습니다. 다시 로그인해주세요.")

    # 사용자 role 조회
    with sqlite3.connect(FEEDBACK_DB) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT role FROM users WHERE username = ?", (username,))
        role_row = cursor.fetchone()
    role = role_row[0] if role_row else "user"

    new_access_token = create_access_token(data={"sub": username, "role": role})
    response.set_cookie(key="rag_session", value=new_access_token, httponly=True,
                        max_age=60*60*2, samesite="lax", secure=True)
    logger.info(f"🔄 [토큰 갱신] {username} — 새 Access Token 발급")
    return {"success": True, "session_token": new_access_token}

@router.post("/api/auth/logout")
async def logout_endpoint(request: Request, response: Response):
    """로그아웃 — Refresh Token DB에서 삭제 후 쿠키 초기화"""
    refresh_token = request.cookies.get("rag_refresh")
    if refresh_token:
        with sqlite3.connect(FEEDBACK_DB) as conn:
            conn.execute("DELETE FROM refresh_tokens WHERE token = ?", (refresh_token,))
    response.delete_cookie("rag_session")
    response.delete_cookie("rag_refresh")
    response.delete_cookie("rag_role")
    response.delete_cookie("rag_username")
    return {"success": True}
