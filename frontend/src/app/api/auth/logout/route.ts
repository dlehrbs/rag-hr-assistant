import { NextResponse, NextRequest } from 'next/server';

export async function POST(request: NextRequest) {
  const backendUrl = process.env.BACKEND_URL || 'http://backend:8123';
  const refreshToken = request.cookies.get('rag_refresh')?.value;

  // 백엔드 DB에서 Refresh Token 삭제
  if (refreshToken) {
    try {
      await fetch(`${backendUrl}/api/auth/logout`, {
        method: 'POST',
        headers: { 'Cookie': `rag_refresh=${refreshToken}` },
      });
    } catch {
      // 백엔드 호출 실패해도 클라이언트 쿠키는 삭제
    }
  }

  const response = NextResponse.json({ success: true });
  const expired = { expires: new Date(0), path: '/' };
  response.cookies.set({ name: 'rag_session', value: '', ...expired });
  response.cookies.set({ name: 'rag_refresh', value: '', ...expired });
  response.cookies.set({ name: 'rag_role', value: '', ...expired });
  response.cookies.set({ name: 'rag_username', value: '', ...expired });
  response.cookies.set({ name: 'rag_auth', value: '', ...expired });
  return response;
}
