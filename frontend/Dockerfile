# ─── Stage 1: Dependencies ────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ─── Stage 2: Builder ─────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY . .
COPY --from=deps /app/node_modules ./node_modules

# 빌드 타임 환경변수 (NEXT_PUBLIC_* 는 빌드 시 번들에 포함되므로 ARG로 전달)
# 기본값은 빈 값 = 같은 출처(상대경로 /api) → nginx 프록시가 백엔드로 전달.
# 별도 도메인/포트로 API를 직접 노출할 때만 이 값을 지정한다.
ARG NEXT_PUBLIC_API_URL=
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ARG BACKEND_URL=http://backend:8123
ENV BACKEND_URL=${BACKEND_URL}
ARG NEXT_PUBLIC_APP_NAME="HR Assistant"
ENV NEXT_PUBLIC_APP_NAME=${NEXT_PUBLIC_APP_NAME}

RUN npm run build

# ─── Stage 3: Runner (Standalone) ─────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Standalone 빌드 결과물 복사
COPY --from=builder /app/.next/standalone ./

# ⚠️ [W-03 유의사항] Standalone 빌드는 public/ 와 .next/static/ 을 자동 포함하지 않음
# CSS, 이미지, 폰트가 깨지지 않도록 반드시 명시적 COPY 필요
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000

# Standalone 빌드의 서버 진입점
CMD ["node", "server.js"]
