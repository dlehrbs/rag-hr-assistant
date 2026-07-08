"""[logging_setup] 로그 설정·한글화 필터·액세스 라벨 정의.
main.py가 import해 실행 배선(필터적용·미들웨어등록)에 사용. 정의만 이동(byte-동일).
note: korean_access_log 미들웨어는 logger·app 결합이라 main.py에 유지."""
import os
import logging
import urllib.parse as _urlparse   # _korean_access_label의 URL 디코딩용 (main.py에서 함께 이동)
from logging.handlers import TimedRotatingFileHandler


def _setup_logging():
    """날짜별 로그 파일 핸들러 설정 (backend_YYYY-MM-DD.log, 30일 보관)"""
    log_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../logs")
    os.makedirs(log_dir, exist_ok=True)

    formatter = logging.Formatter(
        "%(asctime)s [%(levelname)s] %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    file_handler = TimedRotatingFileHandler(
        filename=os.path.join(log_dir, "backend.log"),
        when="midnight",
        interval=1,
        backupCount=30,
        encoding="utf-8",
    )
    # 로테이션 후 파일명: backend_2026-06-01.log
    file_handler.suffix = "%Y-%m-%d"
    file_handler.namer = lambda name: name.replace(
        "backend.log.", "backend_"
    ) + ".log" if "backend.log." in name else name
    file_handler.setFormatter(formatter)

    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)

    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.addHandler(file_handler)
    root.addHandler(console_handler)

class NoiseFilter(logging.Filter):
    def filter(self, record):
        msg = record.getMessage()
        # 필터링할 키워드들
        noise_keywords = ["/api/health", "/api/upload/status", "GET /api/upload/status"]
        return not any(k in msg for k in noise_keywords)

_LOG_TRANSLATIONS = [
    ("Started server process",            "🟢 서버 프로세스 시작"),
    ("Waiting for application startup.",   "⏳ 애플리케이션 기동 준비 중..."),
    ("Application startup complete.",      "✅ 애플리케이션 기동 완료 — 서비스 준비됨"),
    ("Uvicorn running on",                 "🚀 웹서버 구동 중:"),
    ("Started reloader process",           "🔁 자동 리로더 시작"),
    ("Shutting down",                      "🛑 서버 종료 중..."),
    ("Waiting for application shutdown.",  "⏳ 애플리케이션 종료 정리 중..."),
    ("Application shutdown complete.",      "✅ 애플리케이션 종료 완료"),
    ("Finished server process",            "⚫ 서버 프로세스 종료"),
    ("(Press CTRL+C to quit)",             "(종료하려면 Ctrl+C)"),
]

class KoreanLogFilter(logging.Filter):
    """영어 시스템 로그 메시지를 한글로 변환 (관리자 가독성)."""
    def filter(self, record):
        try:
            msg = record.getMessage()
            replaced = msg
            for en, ko in _LOG_TRANSLATIONS:
                if en in replaced:
                    replaced = replaced.replace(en, ko)
            if replaced != msg:
                record.msg = replaced
                record.args = ()
        except Exception:
            pass
        return True

class EndpointFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        # 이 경로들을 포함하는 로그는 무시합니다.
        msg = record.getMessage()
        skip_paths = ["/api/admin/stats", "/api/documents", "/api/admin/feedbacks", "/api/current-model"]
        return not any(path in msg for path in skip_paths)

_LOG_SKIP_EXACT = {"/api/health", "/api/current-model", "/api/admin/alert-settings"}

_LOG_SKIP_PREFIX = ("/api/upload/status", "/api/admin/reindex/status", "/api/admin/stats")

def _korean_access_label(method: str, path: str) -> str:
    """요청 경로를 관리자가 한눈에 알아볼 한글 설명으로 변환."""
    p = path
    try:
        p = _urlparse.unquote(path)
    except Exception:
        pass
    # 규정 문서 PDF 열람
    if p.startswith("/api/docs/"):
        return f"📄 규정 문서 PDF 열람 ({os.path.basename(p)})"
    # ── 정확히 일치하는 경로: 실제 사용자 행위·화면 기준 직관적 라벨 ──
    table = [
        ("POST", "/api/auth/login",          "🔑 로그인"),
        ("POST", "/api/auth/logout",         "🚪 로그아웃"),
        ("POST", "/api/auth/refresh",        "🔄 로그인 세션 자동 연장"),
        ("POST", "/api/auth/register",       "📝 회원가입 신청"),
        ("POST", "/api/auth/sso/verify",     "🔐 그룹웨어에서 챗봇 입장(SSO)"),
        ("GET",  "/api/widget/token",        "🎫 위젯 방문자 입장"),
        ("POST", "/api/widget/chat/stream",  "💬 위젯에서 질문"),
        ("GET",  "/api/widget/top-questions","⭐ 위젯 추천질문 표시"),
        ("POST", "/api/upload_temp",         "📎 대화에 파일 첨부"),
        ("GET",  "/api/documents",           "🏠 홈 화면 열기(규정 문서 목록 표시)"),
        ("POST", "/api/switch-model",        "🔀 AI 모델 변경"),
        ("POST", "/api/feedback",            "👍 답변 평가(좋아요/싫어요)"),
        ("GET",  "/api/conversations",       "🗂️ 대화 목록 불러오기"),
        ("POST", "/api/conversations",       "🆕 새 대화 시작"),
        ("DELETE","/api/conversations/all",  "🗑️ 모든 대화 삭제"),
        ("GET",  "/api/projects",            "📁 프로젝트 목록 불러오기"),
        ("POST", "/api/projects",            "📂 프로젝트 생성"),
    ]
    for m, pref, label in table:
        if method == m and p == pref:
            return label
    # ── 패턴 경로 ──
    if p.startswith("/api/conversations/"):
        if "/messages/from/" in p and method == "DELETE":
            return "🧹 대화 일부 삭제(메시지 편집·재생성)"
        if p.endswith("/messages") and method == "POST":
            return "💾 대화 내용 저장"
        if "/messages/" in p and method == "PATCH":
            return "👍 답변 평가 반영"
        if method == "DELETE":
            return "🗑️ 대화 삭제"
        if method == "PUT":
            return "✏️ 대화 정리(제목 변경·고정·프로젝트 이동)"
    if p.startswith("/api/projects/"):
        if "/files/status/" in p:
            return "⏳ 파일 분석 진행상태 확인"
        if "/files" in p and method == "POST":
            return "📤 프로젝트에 파일 올리기"
        if "/files/" in p and method == "DELETE":
            return "🗑️ 프로젝트 파일 삭제"
        if method == "PUT":
            return "✏️ 프로젝트 정보 변경(이름·설명·별표·보관)"
        if method == "DELETE":
            return "🗑️ 프로젝트 삭제"
    # 관리자 작업 — 자주 쓰는 것은 구체 라벨
    if p.startswith("/api/admin/"):
        sub = p.replace("/api/admin/", "")
        admin_map = {
            "upload":        "📥 규정 문서 추가(관리자)",
            "reindex":       "🔁 전체 문서 재색인(관리자)",
            "switch-model":  "🔀 AI 모델 변경(관리자)",
            "clear-vram":    "🧯 GPU 메모리 정리(관리자)",
            "clear-logs":    "🧹 로그 초기화(관리자)",
            "rag-test":      "🔬 검색 품질 테스트(관리자)",
            "verify-password":"🔑 관리자 비밀번호 재확인",
        }
        for key, lab in admin_map.items():
            if sub.startswith(key):
                return lab
        if sub.startswith("users"):
            return "👤 사용자 계정 관리(관리자)"
        if sub.startswith("feedbacks"):
            return "📊 피드백 통계 조회(관리자)"
        return f"🛠️ 관리자 작업 ({method} {sub})"
    if p.startswith("/api/users/"):
        return "👤 내 계정 설정 변경"
    # 기본
    return f"{method} {p}"
