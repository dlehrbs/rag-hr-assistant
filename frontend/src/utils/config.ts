/**
 * API Base URL — 상대 경로로 변경 (Proxy 활용)
 * 
 * Next.js next.config.ts의 rewrites() Proxy 규칙을 타기 위해
 * 강제로 상대 경로("")를 사용합니다. 이렇게 하면 클라이언트측 브라우저(로컬이든 원격이든)에서 
 * 발생하는 모든 CORS 문제와 IP 미스매치 이슈를 피해갈 수 있습니다.
 */
export const API_BASE: string = "";
