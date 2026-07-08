"""[config] 앱 전역 경로·상수·브랜딩. 자체 load_dotenv(멱등)로 import 순서와 무관하게 안정."""
import os
from dotenv import load_dotenv

_HERE = os.path.dirname(os.path.abspath(__file__))  # backend/app/
load_dotenv(os.path.abspath(os.path.join(_HERE, "../../.env")))

# ── [제품 브랜딩] 도입 회사만 .env로 바꾸면 되는 값 ────────────────────────────
COMPANY_NAME = os.getenv("COMPANY_NAME", "ACME")             # 회사명 — 프롬프트·인사말에 사용
APP_NAME     = os.getenv("APP_NAME", "HR Assistant")         # 챗봇 표시 이름

DATA_ROOT = os.getenv(
    "DATA_ROOT",
    os.path.abspath(os.path.join(_HERE, "../../data"))
)
FEEDBACK_DB = os.path.join(DATA_ROOT, "databases/feedback.sqlite")
DOCS_PATH = os.path.join(DATA_ROOT, "data/documents")  # [C-02] DATA_ROOT 사용
PROJECT_DB_ROOT = os.path.join(DATA_ROOT, "databases/project_db")
PROJECT_PARSE_CACHE = os.path.join(DATA_ROOT, "databases/project_parse_cache")
PROJECT_RETRIEVER_CACHE_MAX = int(os.getenv("PROJECT_RETRIEVER_CACHE_MAX", "30"))
ALLOWED_ORIGINS = os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:4321,http://127.0.0.1:4321"
).split(",")
MAX_INDEXING_TASKS = 200   # [C-01] 동시 태스크 상한선 — OOM 방지
# 웹 검색(선택 기능) — SearXNG 인스턴스 URL. 없으면 웹 폴백은 자동으로 건너뜀.
SEARXNG_URL = os.getenv("SEARXNG_URL", "http://searxng:8080/search")
SEARXNG_ENGINES = os.getenv("SEARXNG_ENGINES", "google,bing,duckduckgo")
_SCAN_OCR_FALLBACK = os.getenv("SCAN_OCR_FALLBACK", "1") != "0"
_SCAN_CHAR_THRESHOLD = int(os.getenv("SCAN_CHAR_THRESHOLD", "50"))  # 페이지당 추출 글자수 임계

# [리랭커 임계값] main.py에서 이동 (RAGManager·chat_generator 공용)
# [리랭커 임계값] 환경변수 RERANK_THRESHOLD 로 조정 (기본 0.05).
# 0.10→0.05 인하(2026-06-17): 정답이 코퍼스에 있는 추론형 질문(예 "8개월차 정기휴가")이
#   리랭커 5.1%로 낮게 매겨져 부당차단되던 문제 해결. out-of-scope(주가·재택 <1.5%)는 여전히 차단.
# 0.0 으로 두면 차단 비활성화 → 벤치마크에서 전 질문 통과시켜 점수분포 수집용.
RERANK_THRESHOLD: float = float(os.environ.get("RERANK_THRESHOLD", "0.05"))


# 문서 파일명에서 '핵심 이름'을 뽑는 선택적 접두어 규칙 (위젯 추천 질문 표시용).
# 회사 문서에 코드 접두어가 있으면 .env의 DOC_NAME_PREFIX_REGEX로 지정 (예: 'DOC[\\s\\d\\-]+').
# 비우면 확장자만 제거해 파일명을 그대로 사용.
DOC_NAME_PREFIX_REGEX = os.getenv("DOC_NAME_PREFIX_REGEX", "")


def extract_doc_name(filename: str) -> str:
    """파일명에서 문서 핵심 이름 추출. 접두어 규칙이 설정돼 있으면 접두어+괄호 주석을 제거."""
    import re
    if DOC_NAME_PREFIX_REGEX:
        m = re.match(DOC_NAME_PREFIX_REGEX + r'\s*(.+?)(?:\([\d\.].*?\))?(?:_[^.]*)?\.[A-Za-z]+$', filename)
        if m:
            return m.group(1).strip()
    return os.path.splitext(filename)[0]
