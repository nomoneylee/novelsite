/**
 * 純 HTTP 測試輔助，MUST NOT import 任何 src/** 模組（整合與 a11y 兩套件共用）。
 */
import { inject } from 'vitest';

/** 取自 globalSetup 的 provide()，MUST NOT 硬編連接埠（見 tests/globalSetup.ts） */
export function baseUrl(): string {
  return inject('baseUrl');
}

/**
 * ip 為必填、MUST NOT 有預設值 —— 有預設值就會有測試共用它，FR-052 的位址隔離即失效。
 */
export async function testFetch(
  path: string,
  init: RequestInit & { ip: string; cookie?: string }
): Promise<Response> {
  const { ip, cookie, headers, ...rest } = init;
  const finalHeaders = new Headers(headers);
  finalHeaders.set('X-Forwarded-For', ip);
  if (cookie) finalHeaders.set('Cookie', cookie);
  // 預設同源 Origin，使寫入端點的 assertSameOrigin（FR-016）通過；呼叫端仍可覆寫以測試跨站情境
  if (!finalHeaders.has('origin')) finalHeaders.set('Origin', baseUrl());
  return fetch(`${baseUrl()}${path}`, { ...rest, headers: finalHeaders, redirect: 'manual' });
}

/** POST /api/auth/login → 回傳 Set-Cookie 的第一段（name=value），供後續請求帶入 */
export async function loginAs(email: string, password: string, ip: string): Promise<string> {
  const res = await testFetch('/api/auth/login', {
    method: 'POST',
    ip,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const setCookie = res.headers.get('set-cookie');
  if (res.status !== 200 || !setCookie) {
    throw new Error(
      `loginAs(${email}) 失敗：狀態碼 ${res.status}，Set-Cookie=${String(setCookie)}`
    );
  }
  return setCookie.split(';')[0];
}
