import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 정적 리소스, API, 로그인/회원가입 페이지 자체는 통과
  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/register') ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next/') ||
    pathname === '/favicon.ico' ||
    pathname === '/widget.js' ||
    pathname === '/test.html'
  ) {
    return NextResponse.next();
  }

  const authToken = req.cookies.get('rag_session');
  const refreshToken = req.cookies.get('rag_refresh');
  const expiredDest = '/login';   // 미인증 시 로그인 페이지로

  // Access Token 없고 Refresh Token 있을 때 → 자동 갱신 시도
  if (!authToken && refreshToken) {
    try {
      const backendUrl = process.env.BACKEND_URL || 'http://backend:8123';
      const refreshRes = await fetch(`${backendUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Cookie': `rag_refresh=${refreshToken.value}` },
      });

      if (refreshRes.ok) {
        const data = await refreshRes.json();
        const response = NextResponse.next();
        response.cookies.set('rag_session', data.session_token, {
          httpOnly: true,
          secure: false,
          sameSite: 'lax',
          path: '/',
          maxAge: 60 * 60 * 2,
        });
        return response;
      }
    } catch {
      // 갱신 실패 → 로그인 페이지로
    }

    const loginUrl = new URL(expiredDest, req.url);
    return NextResponse.redirect(loginUrl);
  }

  if (!authToken) {
    const loginUrl = new URL(expiredDest, req.url);
    return NextResponse.redirect(loginUrl);
  }

  // 관리자 권한 확인
  if (pathname.startsWith('/admin')) {
    const role = req.cookies.get('rag_role')?.value;
    if (role !== 'admin') {
      return NextResponse.redirect(new URL('/', req.url));
    }
  }

  return NextResponse.next();
}

// Next.js standalone에서 미들웨어가 동작하려면 matcher 필요
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/|widget\\.js|test\\.html).*)'],
};
