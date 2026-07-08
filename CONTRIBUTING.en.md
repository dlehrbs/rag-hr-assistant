# Contributing

**English** · [한국어](CONTRIBUTING.md)

Thanks for your interest! This project welcomes issues and pull requests.

## Development

```bash
cp .env.example .env          # fill in COMPANY_NAME, APP_NAME, JWT_SECRET_KEY, ADMIN_PASSWORD
docker compose up -d --build
```

### Backend (Python 3.11)
- Pure/config logic is unit-tested and runs in CI without a GPU:
  ```bash
  cd backend/app && python -m unittest tests.test_config -v
  ```
- Keep company-specific logic out of the core — externalize via `.env` / `config.py`.

### Frontend (Next.js 16)
```bash
cd frontend && npm ci && npm run build
```

## Pull requests
- Keep changes focused; describe the "why".
- CI must pass (Docker build + unit tests).
- No secrets or real data in commits — only `.env.example` is tracked.

## License
By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
