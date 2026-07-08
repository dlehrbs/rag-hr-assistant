# RAG HR Assistant

[English](README.md) · **한국어**

> **완전 폐쇄망에서 도는 사내 문서 기반 HR 챗봇.** 회사 규정 문서를 넣기만 하면, 임직원이 자연어로 물어보고 **출처가 달린 근거 기반 답변**을 받습니다 — 모든 처리가 사내 서버 안에서 이뤄져 데이터가 밖으로 나가지 않습니다.

![version](https://img.shields.io/badge/version-v1.0.0-blue)
![license](https://img.shields.io/badge/license-MIT-green)
![python](https://img.shields.io/badge/python-3.11-3776AB)
![next](https://img.shields.io/badge/Next.js-16-black)
![docker](https://img.shields.io/badge/Docker-Compose-2496ED)

**목차:** [기능](#-기능) · [아키텍처](#️-아키텍처) · [기술 스택](#-기술-스택) · [빠른 시작](#-빠른-시작) · [설정](#️-설정) · [화면](#️-화면) · [구조](#-프로젝트-구조) · [보안](#-보안) · [라이선스](#-라이선스)

---

## ✨ 기능

- 🔒 **완전 온프레미스** — LLM·임베딩·벡터스토어가 모두 로컬에서 동작. 질문과 문서가 사내망을 벗어나지 않습니다.
- 📚 **근거 기반 RAG** — Parent-Child 청킹 + Kiwi(한국어 형태소) BM25 하이브리드 검색 + 크로스인코더 리랭킹 → 답변이 출처 문서를 인용해 환각을 억제합니다.
- 🧭 **Intent Router** — 질문 유형(인사 / 메타 / 실질 질문)을 분류해 최적 경로로 라우팅합니다.
- 🗂️ **개인 프로젝트 공간** — NotebookLM식 격리 워크스페이스. 각자 자기 파일을 올려 그 문서만 근거로 대화합니다.
- 🌐 **웹 검색 폴백** — 사내 문서에 답이 없을 때(활성화 시) 웹 결과로 확장하며, 공식 규정이 아님을 배지로 명시합니다.
- 💬 **범용 대화 모드** — "사내 문서만" ↔ "자유 답변"을 토글로 전환합니다.
- 🧩 **삽입형 위젯** — 기존 포털에 `<script>` 한 줄로 챗봇을 붙입니다.
- 🛠️ **관리자 콘솔** — 문서 관리, 무중단 재인덱싱, 검색 파라미터 튜닝, 지식 공백(zero-hit) 마이닝, p50/p95 응답시간 모니터링.

> **도입 회사에 맞추는 작업 = 값 두 개 수정**(`COMPANY_NAME`, `APP_NAME`) + `data/documents/`에 PDF 넣기. 끝.

---

## 🏗️ 아키텍처

```
                         ┌──────────── Docker Compose ────────────┐
  브라우저 / 포털 ───────▶│  nginx (리버스 프록시, 단일 진입점)      │
       widget.js         │     /api/*  → backend                    │
                         │     /*      → frontend                   │
                         │                                          │
                         │  frontend  Next.js (채팅 UI · 관리자)     │
                         │  backend   FastAPI + RAG 엔진             │
                         │  vllm      로컬 LLM (OpenAI 호환)         │
                         └──────────────────────────────────────────┘
   전부 사내 GPU 서버 안 — 외부로 나가는 데이터 흐름 없음.
```

### RAG 파이프라인

```
문서 (PDF·Word·Excel·PPT·HTML·txt·md)
  → DocumentLoader      파싱 (LlamaParse 클라우드 또는 로컬 PyMuPDF 폴백)
  → ParentChildSplitter 청킹 (Parent 1500 / Child 300자)
  → ChromaDB            Child 청크 임베딩 (multilingual-e5-large, 1024차원)
  → Kiwi BM25           Parent 청크 키워드 인덱싱 (한국어 형태소)
       ↓ (질문마다)
  → HybridRetriever     벡터 + BM25 병합
  → BGE Reranker        크로스인코더 리랭킹 → top-k
  → LLM (vLLM)          프롬프트 조립 → 근거 기반 답변
  → SSE 스트리밍         토큰 단위, 출처 인용 포함
```

**왜 이렇게 설계했나**
- **Parent-Child** — 작고 정밀한 Child로 검색하고, LLM엔 넓은 Parent를 넘겨 맥락 확보 ("좁게 찾고 넓게 읽힌다").
- **하이브리드(벡터+BM25)** — 의미 검색 + 정확한 키워드 매칭. Kiwi가 한국어 형태소를 처리해 "연차를"이 "연차"에 매칭됩니다.
- **크로스인코더 리랭킹** — 후보 ~40개를 2차로 정밀 재채점해 최종 top-k를 고릅니다.
- **AWQ 양자화** — 7.8B 모델을 ~5GB VRAM으로, 품질 손실 최소.

---

## 🧰 기술 스택

| 계층 | 기술 |
|------|------|
| **LLM 서빙** | vLLM (OpenAI 호환), EXAONE-3.5-7.8B-Instruct-AWQ (교체 가능) |
| **임베딩** | `intfloat/multilingual-e5-large` (1024차원) |
| **리랭커** | `BAAI/bge-reranker-v2-m3` (크로스인코더) |
| **벡터 스토어** | ChromaDB |
| **키워드 검색** | Kiwi 형태소 분석기 + BM25 |
| **파싱** | LlamaParse(클라우드) / PyMuPDF(로컬 폴백) |
| **백엔드** | FastAPI (Python 3.11), SQLite (WAL) |
| **프론트엔드** | Next.js 16 (App Router), React 19, Zustand, Tailwind |
| **인프라** | Docker Compose, nginx 리버스 프록시 |

---

## 🚀 빠른 시작

**사전 준비:** NVIDIA GPU + 드라이버, Docker(NVIDIA 컨테이너 런타임 포함).

```bash
git clone https://github.com/dlehrbs/rag-hr-assistant.git
cd rag-hr-assistant

cp .env.example .env          # COMPANY_NAME, APP_NAME, JWT_SECRET_KEY, ADMIN_PASSWORD 설정
cp your_policies/*.pdf data/documents/    # 문서 넣기

docker compose up -d --build
```

이후 `http://localhost:8080` 접속 → admin 로그인 → **관리자 → 문서 → 재인덱싱**으로 인덱스 구축. 끝.

> GPU가 없다면? RAG/백엔드/프론트는 표준이고 `vllm` 서비스만 GPU가 필요합니다. `VLLM_HOST`를 OpenAI 호환 엔드포인트로 지정해도 됩니다.

---

## ⚙️ 설정

모든 설정은 `.env`로 제어됩니다([`.env.example`](.env.example) 참고). 리브랜딩에 *반드시* 바꿔야 하는 값:

| 변수 | 의미 |
|------|------|
| `COMPANY_NAME` | 프롬프트·인사말에 쓰이는 회사명 |
| `APP_NAME` | 챗봇 표시 이름 (UI·타이틀) |
| `JWT_SECRET_KEY` | 인증 서명 키 (랜덤 64자 hex) |
| `ADMIN_PASSWORD` | 관리자 초기 비밀번호 |

선택: `LLAMA_CLOUD_API_KEY`(정밀 파싱), `SEARXNG_URL`(웹 검색), SMTP\_\*(이메일 알림), `RERANK_THRESHOLD` 등 RAG 튜닝 값.

---

## 🖼️ 화면

UI 구성:
- **홈** — 분야별 질문 칩, 기능 안내 카드, `📘 사내규정 ↔ 💬 일반대화` 답변 모드 토글.
- **채팅** — 스트리밍 답변 + 클릭하면 인용 원문이 펼쳐지는 `출처` 칩, 후속 질문 추천.
- **프로젝트 공간** — 대화 옆의 파일 패널(PDF·Word·Excel·PPT·HTML 업로드), 프로젝트별 지침·멤버 공유.
- **관리자 콘솔** — 실시간 p50/p95 응답시간, GPU 상태, 질의 로그, 지식 공백(zero-hit) 마이닝, 사용자 관리.

> 라이브 인스턴스에서(데모 데이터로) 캡처한 화면을 `docs/screenshots/`에 넣고 여기 링크하세요.

---

## 📁 프로젝트 구조

```
rag-hr-assistant/
├── backend/app/
│   ├── main.py                # 부트스트랩 전용 (FastAPI 조립)
│   ├── config.py              # 경로 · 상수 · 브랜딩
│   ├── core/                  # RAG 원자: loader·splitter·embedder·vector_store·retriever·reranker·auth
│   ├── rag/                   # manager · router · retrieval_utils · generator (SSE 파이프라인)
│   ├── handlers/files.py      # 업로드 파싱
│   ├── routes/                # APIRouter: auth·chat·admin·projects·documents·widget·…
│   └── (db · deps · state · monitoring · schemas · logging_setup)
├── frontend/                  # Next.js (채팅 UI · 관리자 콘솔 · widget.js)
├── data/documents/            # ← 여기에 문서를 넣습니다 (기본 비어있음)
├── nginx.conf                 # 리버스 프록시 (기본은 IP 화이트리스트 없음)
├── docker-compose.yml
├── .env.example
└── LICENSE (MIT)
```

---

## 🔐 보안

- **JWT 인증** (access + refresh, HttpOnly 쿠키); 모든 `/api/admin/*`는 서버측에서 차단.
- **폐쇄망** — vLLM은 내부 전용(`expose`), nginx가 유일 진입점; `nginx.conf`에서 IP 화이트리스트 선택 적용 가능.
- **저장소에 비밀정보 없음** — 민감값은 전부 `.env`(git 무시), 저장소엔 `.env.example`만.
- 공개 위젯 엔드포인트에 **Rate limiting** 적용.

---

## 📜 라이선스

MIT — [LICENSE](LICENSE) 참고. 상업적 이용 포함 자유롭게 사용·수정·배포 가능.

---

<sub>실제 프로덕션급 온프레미스 RAG 시스템(하이브리드 검색·리랭킹·스트리밍 생성·멀티테넌트 프로젝트 공간·운영 콘솔)을 보여주는 포트폴리오 프로젝트입니다. 기본 LLM은 한국어에 최적화된 EXAONE-3.5-7.8B이며, OpenAI 호환 모델로 교체 가능합니다.</sub>
