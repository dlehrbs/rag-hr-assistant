import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * [W-03] Docker Standalone 빌드 활성화
   *
   * ⚠️ 주의: Standalone 빌드는 public/ 와 .next/static/ 을
   * standalone/ 폴더로 자동 복사하지 않습니다.
   * frontend/Dockerfile 의 Runner 스테이지에서 반드시 명시적 COPY 필요:
   *   COPY --from=builder /app/public ./public
   *   COPY --from=builder /app/.next/static ./.next/static
   */
  output: "standalone",

  async rewrites() {
    /**
     * [W-03] BACKEND_URL 환경변수 우선 사용
     * - 로컬 dev: 기본값 http://127.0.0.1:8123 (변경 없음)
     * - Docker: docker-compose.yml에서 BACKEND_URL=http://backend:8123 설정
     * - Next.js rewrites()는 빌드 타임이 아닌 런타임에 평가되므로
     *   서버사이드 환경변수(BACKEND_URL) 사용 가능
     */
    const backendUrl = process.env.BACKEND_URL || "http://127.0.0.1:8123";
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
