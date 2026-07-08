import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const backendUrl = process.env.BACKEND_URL || 'http://backend:8123';
    const res = await fetch(`${backendUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ detail: '서버와 통신할 수 없습니다.' }, { status: 500 });
  }
}
