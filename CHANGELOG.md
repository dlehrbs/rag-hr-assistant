# 변경 이력

[English](CHANGELOG.en.md) · **한국어**

이 프로젝트의 주요 변경 사항을 기록합니다.
형식은 [Keep a Changelog](https://keepachangelog.com/), 버전은 [SemVer](https://semver.org/)를 따릅니다.

## [1.0.0] — 2026-07-08

최초 공개 릴리스 — 범용 온프레미스 문서 기반 RAG 챗봇.

### 추가됨
- **RAG 파이프라인**: LlamaParse/PyMuPDF 문서 로딩, Parent-Child 청킹,
  ChromaDB 벡터 인덱스(multilingual-e5-large), Kiwi BM25 하이브리드 검색,
  BGE 크로스인코더 리랭킹, 출처 인용이 포함된 SSE 토큰 스트리밍.
- **Intent Router**: 인사 / 메타 / 실질 질문 분류 + 후속 질문 재작성.
- **개인 프로젝트 공간**: 사용자별 격리 문서 워크스페이스, 멤버 공유(편집자/뷰어).
- **범용 대화 모드** 토글 및 **웹 검색 폴백**(선택, SearXNG 연동).
- **관리자 콘솔**: 문서 관리, 무중단 재인덱싱, 검색 파라미터 튜닝,
  지식 공백(zero-hit) 마이닝, p50/p95 응답시간 모니터링, 가입 승인형 사용자 관리.
- **삽입형 위젯**(`widget.js`) — 외부 포털 연동.
- `COMPANY_NAME` / `APP_NAME` 기반 **설정 주도 브랜딩**; 단일 명령 Docker Compose 배포.
