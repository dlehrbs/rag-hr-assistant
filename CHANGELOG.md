# Changelog

All notable changes to this project are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/), versioning per [SemVer](https://semver.org/).

## [1.0.0] — 2026-07-08

Initial public release — a generic, on-premise, document-grounded RAG chatbot.

### Added
- **RAG pipeline**: LlamaParse/PyMuPDF document loading, Parent-Child chunking,
  ChromaDB vector index (multilingual-e5-large), Kiwi BM25 hybrid retrieval,
  BGE cross-encoder reranking, SSE token streaming with source citations.
- **Intent Router**: greeting / meta / substantive classification + follow-up
  query rewriting.
- **Personal Project Spaces**: per-user isolated document workspaces with member
  sharing (editor/viewer).
- **General chat mode** toggle and **web-search fallback** (optional, via SearXNG).
- **Admin console**: document management, live re-indexing, search-parameter
  tuning, knowledge-gap (zero-hit) mining, p50/p95 latency monitoring, user
  management with sign-up approval.
- **Embeddable widget** (`widget.js`) for external portals.
- **Config-driven branding** via `COMPANY_NAME` / `APP_NAME`; single-command
  Docker Compose deployment.
