# RUNBOOK — 운영 가이드

[English](RUNBOOK.en.md) · **한국어**

RAG HR Assistant 운영을 위한 빠른 참조 문서입니다.

## 헬스 체크
```bash
docker compose ps                                  # 모든 서비스 healthy?
curl -f http://localhost:8123/api/health           # 백엔드 (내부망)
curl -f http://localhost:8000/health               # vLLM
```

## 자주 발생하는 문제

| 증상 | 유력한 원인 | 조치 |
|------|-------------|------|
| 채팅이 "AI 엔진 준비 중" 응답 | vLLM이 모델 로딩 중 | 약 1~3분 대기; `docker compose logs vllm` 확인 |
| 502 Bad Gateway | 백/프론트 컨테이너 재시작으로 IP가 낡음 | nginx가 docker DNS로 자동 해석; 지속되면 `docker compose restart proxy` |
| 아는 문서인데 "찾을 수 없음" 응답 | 인덱스 미구축 또는 낡음 | 관리자 → 문서 → **재인덱싱** |
| GPU 메모리 부족 | 모델과 RAG가 같은 GPU에 위치 | `--gpu-memory-utilization` 낮추거나 RAG를 두 번째 GPU로 분리 |
| 웹 폴백이 동작 안 함 | `SEARXNG_URL` 미설정/접근불가 | 선택 기능 — SearXNG 인스턴스 운영 시에만 설정 |

## 백업
```bash
bash backup.sh          # SQLite DB + 인덱스 스냅샷 (스크립트 참고)
```
DB는 `data/databases/`(git 무시)에 저장됩니다. 운영 일정에 맞춰 백업하세요.

## 문서 갱신
1. `data/documents/`에 파일 추가/교체.
2. 관리자 콘솔 → **문서 → 재인덱싱**(무중단; 새 인덱스가 원자적으로 교체됨).

## 재빌드 & 재배포
```bash
# .env의 APP_VERSION 올린 뒤:
docker compose up -d --build
```

## 로그
```bash
docker compose logs -f backend      # 한글 요청 로그, 하트비트(GPU 온도 / 오늘 질문 수)
docker compose logs -f vllm
```
