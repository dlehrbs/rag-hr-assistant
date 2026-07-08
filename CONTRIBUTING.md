# 기여 가이드

[English](CONTRIBUTING.en.md) · **한국어**

관심 가져주셔서 감사합니다! 이 프로젝트는 이슈와 풀 리퀘스트를 환영합니다.

## 개발 환경

```bash
cp .env.example .env          # COMPANY_NAME, APP_NAME, JWT_SECRET_KEY, ADMIN_PASSWORD 입력
docker compose up -d --build
```

### 백엔드 (Python 3.11)
- 순수 로직·설정 로직은 단위 테스트되며 GPU 없이 CI에서 실행됩니다:
  ```bash
  cd backend/app && python -m unittest tests.test_config -v
  ```
- 회사 특화 로직은 코어에 두지 말고 `.env` / `config.py`로 외부화하세요.

### 프론트엔드 (Next.js 16)
```bash
cd frontend && npm ci && npm run build
```

## 풀 리퀘스트
- 변경은 목적이 분명하게, "왜"를 설명해 주세요.
- CI가 반드시 통과해야 합니다(Docker 빌드 + 단위 테스트).
- 커밋에 비밀정보나 실제 데이터를 넣지 마세요 — 추적되는 건 `.env.example`뿐입니다.

## 라이선스
기여함으로써, 귀하의 기여가 [MIT 라이선스](LICENSE)로 배포되는 데 동의하는 것으로 간주합니다.
