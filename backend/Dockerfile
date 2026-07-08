# ─── Stage 1: Dependencies (C++ 컴파일 환경) ──────────────────────────────────
FROM python:3.11-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gcc \
    g++ \
    cmake \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# ─── Stage 2: Runner ──────────────────────────────────────────────────────────
FROM python:3.11-slim AS runner

# 런타임 의존성만 최소 설치
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Stage 1에서 설치된 패키지 복사
COPY --from=builder /install /usr/local

# RAG 코어 모듈 (app/core/) 복사
COPY app /app/app

# 데이터 디렉터리 초기화 (볼륨로 마운트되지 않은 경우 빈 상태로 시작)
RUN mkdir -p /app/databases /app/data/documents /app/data/parsed_cache /app/databases/temp_db

# Python import 경로 설정 (uvicorn이 /app/app/ 디렉터리에서 실행되므로)
ENV PYTHONPATH=/app/app
ENV DATA_ROOT=/app
ENV PYTHONUNBUFFERED=1

EXPOSE 8123

# uvicorn을 /app/app 디렉터리에서 실행 (core/ 임포트 경로 보장)
WORKDIR /app/app
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8123", "--workers", "1"]
