/**
 * 憑證層：簽發／驗簽／Cookie 屬性／token 雜湊。零資料存取相依。
 * 本檔 MUST 只 import jose 與 @/lib/env，MUST NOT import repositories、db 或任何
 * 帶 import 'server-only' 的模組 —— src/proxy.ts 只允許引用本檔取得驗簽能力（FR-045、FR-053）。
 */
import { createHash } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { env } from '@/lib/env';

export type Role = 'reader' | 'author' | 'admin';

export interface SessionClaims {
  sid: string;
  uid: string;
  role: Role;
}

/** Cookie 名稱與屬性集中於此，MUST NOT 於呼叫端各自拼裝（避免 maxAge 兩處漂移） */
export const SESSION_COOKIE = {
  name: 'novelsite_session' as const,
  // MUST 取絕對上限換算的秒數，MUST NOT 取閒置期限（FR-008）
  maxAge: env.SESSION_ABSOLUTE_TTL_DAYS * 86400,
  httpOnly: true as const,
  sameSite: 'lax' as const,
  // 子路徑部署時 Cookie 範圍 MUST 收斂至前綴（FR-076）。
  // 用 `||` 而非 `??`：空字串是**非法的** Cookie `Path`，未設前綴時 MUST 回落 `'/'`。
  // 簽發與清除 MUST 用同一個值（皆經 `sessionCookieOptions()`）——兩者不同時，
  // 瀏覽器會當成兩個 Cookie，**使用者按了登出卻沒登出**。
  path: process.env.NEXT_PUBLIC_BASE_PATH || '/',
  // 預設 `NODE_ENV === 'production'`；只有跨引擎 E2E 會以 `SESSION_COOKIE_SECURE=false`
  // 明確關閉（見 env.ts 的同名欄位說明）
  secure: env.SESSION_COOKIE_SECURE,
};

/** 供 Route Handler 與 Server Action 共用的 Cookie 選項物件（避免兩處各自拼裝而漂移） */
export function sessionCookieOptions() {
  return {
    httpOnly: SESSION_COOKIE.httpOnly,
    sameSite: SESSION_COOKIE.sameSite,
    path: SESSION_COOKIE.path,
    secure: SESSION_COOKIE.secure,
    maxAge: SESSION_COOKIE.maxAge,
  };
}

function secretKey(): Uint8Array {
  return new TextEncoder().encode(env.SESSION_SECRET);
}

/** 簽發 JWT（payload = claims）。sid 由呼叫端先產生 cuid 後傳入 */
export async function signSessionToken(claims: SessionClaims): Promise<string> {
  return new SignJWT({ sid: claims.sid, uid: claims.uid, role: claims.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .sign(secretKey());
}

function isRole(value: unknown): value is Role {
  return value === 'reader' || value === 'author' || value === 'admin';
}

/** 僅驗簽、零 I/O —— 供路由攔截層使用（FR-045）。竄改 payload（含竄改 role）一律回 null */
export async function verifyClaimsOnly(token: string | undefined): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    const { sid, uid, role } = payload;
    if (typeof sid === 'string' && typeof uid === 'string' && isRole(role)) {
      return { sid, uid, role };
    }
    return null;
  } catch {
    return null;
  }
}

/** DB 只存此值（見 data-model.md §3.1） */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
