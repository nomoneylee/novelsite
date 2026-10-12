import { NextResponse, type NextRequest } from 'next/server';
import { buildCspPolicy } from '@/lib/security/csp';
import { verifyClaimsOnly, SESSION_COOKIE } from '@/lib/auth/sessionToken';
import { logSecurityEvent } from '@/lib/auth/audit';

/**
 * 全站路由攔截層：逐請求 nonce／CSP + 受保護前綴（/author/*、/profile/*）的守衛分支。
 * 允許的 import 僅：next/server、@/lib/security/csp、@/lib/auth/sessionToken、
 * @/lib/auth/audit —— MUST NOT import prisma、repositories 或 auth/session（FR-045、FR-053）。
 */
const PROTECTED_PREFIX_RE = /^\/(author|profile|admin)(\/|$)/;

/**
 * 依 TRUSTED_PROXY_HOPS 取得來源位址，邏輯與 auth/rateLimit.ts 的 clientIpFrom 相同，但本檔
 * MUST NOT import 該模組（不在允許清單內）—— 故在此自成一份最小實作，僅供 authz.denied 稽核記錄使用。
 */
function clientIpFromHeaders(headers: Headers): string {
  const hops = Number(process.env.TRUSTED_PROXY_HOPS ?? '0');
  if (!Number.isFinite(hops) || hops <= 0) return 'unknown';

  const forwardedFor = headers.get('x-forwarded-for');
  if (!forwardedFor) return 'unknown';

  const parts = forwardedFor
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const index = parts.length - hops;
  return index >= 0 ? parts[index] : 'unknown';
}

export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isDev = process.env.NODE_ENV === 'development';
  const csp = buildCspPolicy(nonce, { isDev });

  const { pathname } = request.nextUrl;

  if (PROTECTED_PREFIX_RE.test(pathname)) {
    const token = request.cookies.get(SESSION_COOKIE.name)?.value;
    const claims = await verifyClaimsOnly(token);
    const ip = clientIpFromHeaders(request.headers);

    if (!claims) {
      logSecurityEvent({ event: 'authz.denied', ip, result: 'unauthenticated' });
      // MUST 用 `nextUrl.clone()` 而非 `new URL('/auth/login', request.url)`（FR-073）：
      // `request.url` 雖含前綴，但以 `/` 開頭的第二引數會從 **origin** 重新解析，前綴就掉了
      // ——症狀是使用者被送去網域根目錄下的別的站，而本站看起來一切正常。
      // `NextURL` 認得 `basePath` 並會在輸出時補回去。
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = '/auth/login';
      // `pathname` 本身不含前綴（Next 已剝除），`next` 存的就是不含前綴的路徑，登入後由框架加回去
      loginUrl.searchParams.set('next', pathname + request.nextUrl.search);
      const redirectRes = NextResponse.redirect(loginUrl, 302);
      redirectRes.headers.set('Content-Security-Policy', csp);
      return redirectRes;
    }

    if (pathname.startsWith('/author') && claims.role === 'reader') {
      logSecurityEvent({ event: 'authz.denied', ip, result: 'insufficient_role' });
      // 同上：MUST 用 `nextUrl.clone()`，`new URL('/', request.url)` 會把前綴解析掉（FR-073）
      const homeUrl = request.nextUrl.clone();
      homeUrl.pathname = '/';
      const redirectRes = NextResponse.redirect(homeUrl, 302);
      redirectRes.headers.set('Content-Security-Policy', csp);
      return redirectRes;
    }

    if (pathname.startsWith('/admin') && claims.role !== 'admin') {
      logSecurityEvent({ event: 'authz.denied', ip, result: 'insufficient_role' });
      const homeUrl = request.nextUrl.clone();
      homeUrl.pathname = '/';
      const redirectRes = NextResponse.redirect(homeUrl, 302);
      redirectRes.headers.set('Content-Security-Policy', csp);
      return redirectRes;
    }
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);

  return response;
}

// matcher 排除：api（整個前綴，含 /api/health）、_next/static、_next/image、favicon.ico、
// public/ 下常見副檔名的靜態檔案與 prefetch 請求（research.md R-1b）。
export const config = {
  matcher: [
    {
      source:
        '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|txt|xml|json|woff|woff2|ttf|otf)$).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
