# RAG HR Assistant

**English** · [한국어](README.md)

> **On-prem, document-grounded HR chatbot.** Drop your company's policy documents in, and employees get accurate, source-cited answers in natural language — running entirely inside your own network, no data ever leaving your servers.
>
> 사내 문서를 넣기만 하면, 임직원이 자연어로 물어보고 **출처가 달린 근거 기반 답변**을 받는 **완전 폐쇄망 RAG 챗봇**입니다.

![version](https://img.shields.io/badge/version-v1.0.0-blue)
![license](https://img.shields.io/badge/license-MIT-green)
![python](https://img.shields.io/badge/python-3.11-3776AB)
![next](https://img.shields.io/badge/Next.js-16-black)
![docker](https://img.shields.io/badge/Docker-Compose-2496ED)

**Contents:** [Features](#-features) · [Architecture](#️-architecture) · [Tech stack](#-tech-stack) · [Quick start](#-quick-start) · [Configuration](#️-configuration) · [Screenshots](#-screenshots) · [Structure](#-project-structure) · [Security](#-security) · [License](#-license)

---

## ✨ Features

- 🔒 **Fully on-premise** — LLM, embeddings, and vector store all run locally. Questions and documents never leave your network.
- 📚 **Grounded RAG** — Parent-Child chunking + Kiwi (Korean morphological) BM25 hybrid retrieval + cross-encoder reranking → answers cite the source document, minimizing hallucination.
- 🧭 **Intent Router** — classifies each question (greeting / meta / substantive) and routes it to the optimal path.
- 🗂️ **Personal Project Spaces** — NotebookLM-style isolated workspaces where each user uploads their own files and chats over just those.
- 🌐 **Web-search fallback** — when the answer isn't in your docs (and it's enabled), it extends with web results, clearly badged as non-official.
- 💬 **General chat mode** — a toggle to switch between "company documents only" and "free-form assistant."
- 🧩 **Embeddable widget** — add the chatbot to any existing portal with a single `<script>` tag.
- 🛠️ **Admin console** — document management, live re-indexing, search-parameter tuning, knowledge-gap (zero-hit) mining, and p50/p95 latency monitoring.

> **Adapting to your company = editing two values** (`COMPANY_NAME`, `APP_NAME`) and dropping your PDFs into `data/documents/`. That's it.

---

## 🏗️ Architecture

```
                         ┌──────────── Docker Compose ────────────┐
  Browser / Portal ─────▶│  nginx (reverse proxy, single entry)    │
       widget.js         │     /api/*  → backend                    │
                         │     /*      → frontend                   │
                         │                                          │
                         │  frontend  Next.js (chat UI · admin)     │
                         │  backend   FastAPI + RAG engine          │
                         │  vllm      local LLM (OpenAI-compatible) │
                         └──────────────────────────────────────────┘
   All within your own GPU server — no external data flow.
```

### RAG pipeline

```
Documents (PDF·Word·Excel·PPT·HTML·txt·md)
  → DocumentLoader      parse (LlamaParse cloud OR local PyMuPDF fallback)
  → ParentChildSplitter chunk (Parent 1500 / Child 300 chars)
  → ChromaDB            embed Child chunks (multilingual-e5-large, 1024-dim)
  → Kiwi BM25           keyword index Parent chunks (Korean morphological)
       ↓ (per query)
  → HybridRetriever     vector + BM25 union
  → BGE Reranker        cross-encoder rerank → top-k
  → LLM (vLLM)          prompt assembly → grounded answer
  → SSE streaming       token-by-token, with source citations
```

**Why these choices**
- **Parent-Child** — search on small precise Child chunks, feed the LLM the larger Parent for context ("search narrow, read wide").
- **Hybrid (vector + BM25)** — semantic recall plus exact keyword match; Kiwi handles Korean morphology so "연차를" matches "연차".
- **Cross-encoder rerank** — a second, more accurate pass over the ~40 candidates to pick the final top-k.
- **AWQ quantization** — runs a 7.8B model in ~5 GB VRAM with minimal quality loss.

---

## 🧰 Tech stack

| Layer | Technology |
|-------|-----------|
| **LLM serving** | vLLM (OpenAI-compatible), EXAONE-3.5-7.8B-Instruct-AWQ (swappable) |
| **Embeddings** | `intfloat/multilingual-e5-large` (1024-dim) |
| **Reranker** | `BAAI/bge-reranker-v2-m3` (cross-encoder) |
| **Vector store** | ChromaDB |
| **Keyword search** | Kiwi morphological analyzer + BM25 |
| **Parsing** | LlamaParse (cloud) / PyMuPDF (local fallback) |
| **Backend** | FastAPI (Python 3.11), SQLite (WAL) |
| **Frontend** | Next.js 16 (App Router), React 19, Zustand, Tailwind |
| **Infra** | Docker Compose, nginx reverse proxy |

---

## 🚀 Quick start

**Prerequisites:** an NVIDIA GPU + drivers, and Docker (with the NVIDIA container runtime).

```bash
git clone https://github.com/<you>/rag-hr-assistant.git
cd rag-hr-assistant

cp .env.example .env          # then set COMPANY_NAME, APP_NAME, JWT_SECRET_KEY, ADMIN_PASSWORD
cp your_policies/*.pdf data/documents/    # drop your documents

docker compose up -d --build
```

Then open `http://localhost:8080`, log in as admin, go to **Admin → Documents → Re-index** to build the index. Done.

> No GPU handy? The RAG/backend/frontend are standard; only the `vllm` service needs the GPU. You can point `VLLM_HOST` at any OpenAI-compatible endpoint instead.

---

## ⚙️ Configuration

Everything is driven by `.env` (see [`.env.example`](.env.example)). The only values you *must* change to rebrand:

| Variable | Meaning |
|----------|---------|
| `COMPANY_NAME` | Company name used in prompts & greetings |
| `APP_NAME` | Chatbot display name (UI, title) |
| `JWT_SECRET_KEY` | Auth signing key (generate a random 64-char hex) |
| `ADMIN_PASSWORD` | Initial admin password |

Optional: `LLAMA_CLOUD_API_KEY` (precise parsing), `SEARXNG_URL` (web search), SMTP\_\* (email alerts), `RERANK_THRESHOLD` and other RAG knobs.

---

## 🖼️ Screenshots

The UI includes:
- **Home** — category quick-chips, capability cards, and a `📘 Docs ↔ 💬 General` answer-mode toggle.
- **Chat** — streamed answers with a `Sources` chip that expands to the exact cited passages, plus follow-up suggestions.
- **Project space** — a file panel (upload PDF/Word/Excel/PPT/HTML) beside the conversation, with per-project instructions and member sharing.
- **Admin console** — real-time p50/p95 latency, GPU status, query logs, zero-hit knowledge-gap mining, and user management.

> Add your own captures (from a running instance with demo data) to `docs/screenshots/` and link them here.

---

## 📁 Project structure

```
rag-hr-assistant/
├── backend/app/
│   ├── main.py                # bootstrap only (assembles FastAPI)
│   ├── config.py              # paths · constants · branding
│   ├── core/                  # RAG atoms: loader·splitter·embedder·vector_store·retriever·reranker·auth
│   ├── rag/                   # manager · router · retrieval_utils · generator (SSE pipeline)
│   ├── handlers/files.py      # upload parsing
│   ├── routes/                # APIRouters: auth·chat·admin·projects·documents·widget·…
│   └── (db · deps · state · monitoring · schemas · logging_setup)
├── frontend/                  # Next.js (chat UI · admin console · widget.js)
├── data/documents/            # ← put your documents here (empty by default)
├── nginx.conf                 # reverse proxy (generic, no IP allowlist by default)
├── docker-compose.yml
├── .env.example
└── LICENSE (MIT)
```

---

## 🔐 Security

- **JWT auth** (access + refresh, HttpOnly cookies); all `/api/admin/*` guarded server-side.
- **Closed network** — vLLM is internal-only (`expose`), nginx is the single entry point; optional IP allowlist in `nginx.conf`.
- **No secrets in the repo** — everything sensitive lives in `.env` (git-ignored); only `.env.example` is committed.
- **Rate limiting** on the public widget endpoint.

---

## 📜 License

MIT — see [LICENSE](LICENSE). Free to use, modify, and distribute (including commercially).

---

<sub>Built as a portfolio project demonstrating a production-style, on-prem RAG system: hybrid retrieval, reranking, streaming generation, multi-tenant project spaces, and an operations console. The default LLM is EXAONE-3.5-7.8B (Korean-optimized), swappable for any OpenAI-compatible model.</sub>
