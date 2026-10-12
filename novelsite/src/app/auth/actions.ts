'use server';

import { cookies, headers } from 'next/headers';
import {
  register,
  login,
  logout,
  AuthServiceError,
  type AuthResultUser,
  type RequestCtx,
} from '@/lib/services/authService';
import { readSession, SESSION_COOKIE } from '@/lib/auth/session';
import { sessionCookieOptions } from '@/lib/auth/sessionToken';
import { clientIpFrom } from '@/lib/auth/rateLimit';

/**
 * register/login/logout Server Actions，與 API Route 共用同一個 authService（錯誤語意與
 * 限流行為完全一致）。CSRF 由框架內建保護（比對 Origin/Host），不需自行實作（research.md R-4）；
 * 但每個 Action 內部仍自行驗證身分與權限 —— matcher 變更會靜默移除攔截層覆蓋範圍。
 */

export type ActionResult =
  | { success: true; user: AuthResultUser }
  | { success: false; error: { code: string; message: string; fields?: Record<string, string> } };

export type SimpleActionResult =
  { success: true } | { success: false; error: { code: string; message: string } };

async function resolveCtx(): Promise<RequestCtx> {
  const h = await headers();
  return {
    ip: clientIpFrom(h, 'unknown'),
    userAgent: h.get('user-agent') ?? '',
  };
}

async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE.name, token, sessionCookieOptions());
}

function errorResult(err: unknown): {
  success: false;
  error: { code: string; message: string; fields?: Record<string, string> };
} {
  if (err instanceof AuthServiceError) {
    return { success: false, error: { code: err.code, message: err.message, fields: err.fields } };
  }
  console.error('[auth action] unexpected error', err);
  return { success: false, error: { code: 'INTERNAL_ERROR', message: '未預期錯誤' } };
}

export async function registerAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await resolveCtx();
    const result = await register(input, ctx);
    await setSessionCookie(result.token);
    return { success: true, user: result.user };
  } catch (err) {
    return errorResult(err);
  }
}

export async function loginAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await resolveCtx();
    const result = await login(input, ctx);
    await setSessionCookie(result.token);
    return { success: true, user: result.user };
  } catch (err) {
    return errorResult(err);
  }
}

export async function logoutAction(): Promise<SimpleActionResult> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE.name)?.value;
  const session = await readSession(token);

  if (!session) {
    return { success: false, error: { code: 'UNAUTHENTICATED', message: '尚未登入' } };
  }

  await logout(session.sid);
  store.delete({ name: SESSION_COOKIE.name, path: SESSION_COOKIE.path });
  return { success: true };
}
