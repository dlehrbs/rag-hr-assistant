import { NextResponse, NextRequest } from 'next/server';

export async function POST(request: NextRequest) {
  const backendUrl = process.env.BACKEND_URL || 'http://backend:8123';
  const refreshToken = request.cookies.get('rag_refresh')?.value;

  if (!refreshToken) {
    return NextResponse.json({ success: false }, { status: 401 });
  }

  try {
    const res = await fetch(`${backendUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Cookie': `rag_refresh=${refreshToken}` },
    });

    if (!res.ok) {
      const response = NextResponse.json({ success: false }, { status: 401 });
      const expired = { expires: new Date(0), path: '/' };
      response.cookies.set({ name: 'rag_session', value: '', ...expired });
      response.cookies.set({ name: 'rag_refresh', value: '', ...expired });
      return response;
    }

    const data = await res.json();
    const response = NextResponse.json({ success: true });
    response.cookies.set('rag_session', data.session_token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 2,
    });
    return response;
  } catch {
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
