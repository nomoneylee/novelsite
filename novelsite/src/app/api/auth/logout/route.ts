import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { assertSameOrigin, SameOriginError } from '@/lib/auth/guard';
import { logout } from '@/lib/services/authService';
import { readSession, SESSION_COOKIE } from '@/lib/auth/session';
import { clearSessionCookie } from '@/lib/auth/routeHelpers';

/** 契約見 contracts/http-api.md §3 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
  } catch (err) {
    if (err instanceof SameOriginError) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: '跨站請求' } },
        { status: 403 }
      );
    }
    throw err;
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE.name)?.value;
  const session = await readSession(token);

  if (!session) {
    return NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: '尚未登入' } },
      { status: 401 }
    );
  }

  await logout(session.sid);

  const res = NextResponse.json({ data: { ok: true } }, { status: 200 });
  clearSessionCookie(res);
  return res;
}
