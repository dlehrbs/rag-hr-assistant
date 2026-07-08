// [제품 브랜딩] 챗봇 표시 이름 — 빌드 시 NEXT_PUBLIC_APP_NAME 환경변수로 지정.
// docker-compose build-arg 또는 .env로 회사별 이름을 주입한다. 기본값은 범용.
export const APP_NAME: string = process.env.NEXT_PUBLIC_APP_NAME || "HR Assistant";
