import { NextResponse } from 'next/server';
import { assertSameOrigin, SameOriginError } from '@/lib/auth/guard';
import { register } from '@/lib/services/authService';
import { authErrorResponse, resolveRequestCtx, setSessionCookie } from '@/lib/auth/routeHelpers';

/** 契約與執行順序見 contracts/http-api.md §1 */
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

  const ctx = resolveRequestCtx(request);
  const body: unknown = await request.json().catch(() => ({}));

  try {
    const result = await register(body, ctx);
    const res = NextResponse.json({ data: { user: result.user } }, { status: 200 });
    setSessionCookie(res, result.token);
    return res;
  } catch (err) {
    return authErrorResponse(err);
  }
}
