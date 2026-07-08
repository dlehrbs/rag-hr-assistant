import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { username, password } = body;

    // 백엔드 보안 서버에 로그인 요청 전달
    const backendUrl = process.env.BACKEND_URL || 'http://backend:8123';
    const res = await fetch(`${backendUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // 실제 클라이언트 IP 전달 — backend rate limit이 사용자별로 동작하도록
        'X-Forwarded-For': request.headers.get('x-forwarded-for') ?? '',
      },
      body: JSON.stringify({ username, password }),
    });

    if (res.ok) {
      const data = await res.json();
      const response = NextResponse.json({ success: true });

      // Access Token: 2시간 (httpOnly)
      response.cookies.set('rag_session', data.session_token, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 2,
      });

      // Refresh Token: 7일 (httpOnly — JS 접근 불가)
      if (data.refresh_token) {
        response.cookies.set('rag_refresh', data.refresh_token, {
          httpOnly: true,
          secure: true,
          sameSite: 'lax',
          path: '/',
          maxAge: 60 * 60 * 24 * 7,
        });
      }

      // 역할 쿠키 (JS 접근 허용 — 어드민 메뉴 표시용)
      response.cookies.set('rag_role', data.role, {
        httpOnly: false,
        secure: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 7,
      });

      // 인증 경로 쿠키 — local(ID/PW) 로그인 표시 (SSO와 분기용)
      response.cookies.set('rag_auth', 'local', {
        httpOnly: false,
        secure: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 7,
      });

      // 유저명 쿠키 (JS 접근 허용 — 사이드바 표시용)
      if (username) {
        // Next 쿠키 직렬화가 자동 인코딩 — encodeURIComponent로 또 감싸면 이중 인코딩됨
        response.cookies.set('rag_username', username as string, {
          httpOnly: false,
          secure: true,
          sameSite: 'lax',
          path: '/',
          maxAge: 60 * 60 * 24 * 7,
        });
      }

      return response;
    }

    const errorData = await res.json();
    return NextResponse.json(
      { success: false, message: errorData.detail || '인증에 실패했습니다.' },
      { status: res.status }
    );
  } catch (error) {
    console.error('Auth Proxy Error:', error);
    return NextResponse.json(
      { success: false, message: '보안 서버와 통신할 수 없습니다.' },
      { status: 500 }
    );
  }
}
