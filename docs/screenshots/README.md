# 스크린샷 캡처 가이드

README(`../../README.md`)의 "화면" 섹션이 참조하는 이미지 9장을 이 폴더에 넣습니다.
**모두 더미 데이터(회사명 `ACME`, `samples/ACME_Employee_Handbook.md`)로 캡처합니다 — 실제 사번·실명·회사 규정 금지(공개 저장소).**

## 준비: 더미 환경으로 B 띄우기

```bash
cp .env.example .env
# .env 편집:
#   COMPANY_NAME=ACME
#   APP_NAME=HR Assistant
#   JWT_SECRET_KEY=<랜덤 64 hex>
#   ADMIN_PASSWORD=<임시 비밀번호>
cp samples/ACME_Employee_Handbook.md data/documents/   # 필요시 PDF로 변환해 넣어도 됨
docker compose up -d --build
```
→ `http://localhost:8080` 접속 → admin 로그인 → 관리자 → 문서 → 재인덱싱.
데모용 계정 몇 개(예: `alice`, `bob`)를 더미 이름으로 만들어 두면 프로젝트/사용자 화면이 자연스럽습니다.

## 캡처 목록 (파일명 = README 링크와 일치해야 함)

| 파일명 | 화면 | 체크 포인트 |
|--------|------|-------------|
| `home.png` | 홈 | 질문 칩 · 기능 카드 · `📘 사내규정 ↔ 💬 일반대화` 토글 |
| `chat.png` | 규정 Q&A | 답변 + `출처` 배지 + 후속 질문 추천 |
| `chat-sources.png` | 출처 상세 | 인용 원문 펼침 |
| `project-list.png` | 프로젝트 목록 | 더미 프로젝트 카드(파일 수·공유 인원) |
| `project-inside.png` | 프로젝트 내부 | 파일 패널 + 지침 + 대화 |
| `project-member.png` | 멤버 초대 | 편집자/뷰어 권한 (더미 이름) |
| `admin-dashboard.png` | 대시보드 | p50/p95 · GPU · 질의 로그 · zero-hit |
| `admin-documents.png` | 문서 관리 | 샘플 문서 목록 · 인덱싱 상태 |
| `admin-users.png` | 사용자 관리 | 더미 계정 · 역할 · 승인 |

## 캡처 전 마지막 점검
- [ ] 화면 어디에도 실제 회사명/사번/실명/실제 규정 문서명이 없는가
- [ ] 브라우저 탭·북마크·시스템 트레이에 회사 정보가 노출되지 않았는가
- [ ] 파일명이 위 표와 정확히 일치하는가 (오타 시 README 이미지 깨짐)

캡처 후 이 폴더에 넣고 커밋하면 README에 바로 반영됩니다.
