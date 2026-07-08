import os
import secrets
import bcrypt as _bcrypt
from datetime import datetime, timedelta, timezone
from typing import Optional
from jose import JWTError, jwt
from fastapi import HTTPException, Request

# .env에서 보안 설정 로드
SECRET_KEY = os.getenv("JWT_SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError("JWT_SECRET_KEY 환경변수가 설정되지 않았습니다. .env 파일을 확인하세요.")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 2    # Access Token: 2시간
REFRESH_TOKEN_EXPIRE_DAYS = 7    # Refresh Token: 7일

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """입력된 비번과 저장된 해시가 일치하는지 확인"""
    try:
        return _bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))
    except Exception:
        return False

def get_password_hash(password: str) -> str:
    """비밀번호를 bcrypt 해시로 변환"""
    return _bcrypt.hashpw(password.encode("utf-8"), _bcrypt.gensalt()).decode("utf-8")

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    """복제 불가능한 보안 티켓(JWT) 발급 — 기본 2시간"""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def create_refresh_token() -> str:
    """서버 DB에 저장되는 불투명 Refresh Token 생성 (32바이트 난수)"""
    return secrets.token_hex(32)

def get_current_user(request: Request):
    """
    모든 API 요청에서 출입증(JWT)을 검사하는 보안 관문.
    쿠키 또는 Authorization 헤더에서 토큰을 찾습니다.
    """
    # 1. 쿠키에서 토큰 확인 (브라우저용)
    token = request.cookies.get("rag_session")
    
    # 2. 헤더에서 토큰 확인 (API 호출용)
    if not token:
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header.split(" ")[1]

    if not token:
        raise HTTPException(
            status_code=401,
            detail="출입증(토큰)이 없습니다. 다시 로그인해주세요.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise HTTPException(status_code=401, detail="출입증 정보가 부정확합니다.")
        return username
    except JWTError:
        raise HTTPException(status_code=401, detail="유효하지 않거나 만료된 출입증입니다.")


def get_current_user_info(request: Request) -> dict:
    """username + role 모두 반환하는 의존성 (권한 분기가 필요한 엔드포인트용)"""
    token = request.cookies.get("rag_session")
    if not token:
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header.split(" ")[1]
    if not token:
        raise HTTPException(status_code=401, detail="출입증(토큰)이 없습니다. 다시 로그인해주세요.")
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        role: str = payload.get("role", "user")
        if not username:
            raise HTTPException(status_code=401, detail="출입증 정보가 부정확합니다.")
        return {"username": username, "role": role}
    except JWTError:
        raise HTTPException(status_code=401, detail="유효하지 않거나 만료된 출입증입니다.")
