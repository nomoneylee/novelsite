import 'server-only';
import { sessionsRepo } from '@/lib/repositories';
import { env } from '@/lib/env';
import {
  signSessionToken,
  verifyClaimsOnly,
  hashToken,
  type Role,
  type SessionClaims,
} from './sessionToken';

export type { SessionClaims };
export { SESSION_COOKIE } from './sessionToken';
// 注意：verifyClaimsOnly MUST NOT 自本模組轉出 —— 轉出等於讓 proxy.ts 有機會 import 本模組，
// 而本模組經 sessionsRepo 拉進 repositories/db，傳遞性禁令即失效（FR-045、FR-053）。
// proxy.ts MUST 直接 import '@/lib/auth/sessionToken'。

export interface SessionUser {
  id: string;
  role: Role;
}

export interface ActiveSession {
  sid: string;
  uid: string;
  role: Role;
}

/** 產生 sid → 簽發 JWT → 以 hashToken() 寫入 Session.tokenHash（FR-006） */
export async function issueSession(
  user: SessionUser,
  meta: { userAgent: string; ip: string }
): Promise<string> {
  const sid = crypto.randomUUID();
  const token = await signSessionToken({ sid, uid: user.id, role: user.role });
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_DAYS * 86_400_000);

  await sessionsRepo.create({
    id: sid,
    userId: user.id,
    tokenHash,
    expiresAt,
    userAgent: meta.userAgent,
    ip: meta.ip,
  });

  return token;
}

/**
 * 驗簽 + 查 DB + 節流延展；回傳 null 表示未登入。
 * 有效期規則（滑動 + 絕對上限 + 節流寫入）見 data-model.md §3.3。
 */
export async function readSession(token: string | undefined): Promise<ActiveSession | null> {
  const claims = await verifyClaimsOnly(token);
  if (!claims || !token) return null;

  const session = await sessionsRepo.findByTokenHash(hashToken(token));
  if (!session || session.revokedAt || session.user?.isSuspended) return null;

  const now = Date.now();
  const absoluteDeadline = session.createdAt.getTime() + env.SESSION_ABSOLUTE_TTL_DAYS * 86_400_000;
  if (now >= absoluteDeadline || now >= session.expiresAt.getTime()) return null;

  // 節流門檻內不寫入，門檻過後才延展；min(...) 是滑動延展 MUST NOT 突破絕對上限的實作點
  const throttleMs = env.SESSION_SLIDING_THROTTLE_HOURS * 3_600_000;
  if (now - session.lastUsedAt.getTime() > throttleMs) {
    const newExpiresAt = new Date(
      Math.min(now + env.SESSION_TTL_DAYS * 86_400_000, absoluteDeadline)
    );
    await sessionsRepo.touch(session.id, newExpiresAt);
  }

  return { sid: session.id, uid: session.userId, role: claims.role };
}

export async function revokeSession(sid: string): Promise<void> {
  await sessionsRepo.revoke(sid);
}

export async function revokeAllSessionsForUser(uid: string): Promise<void> {
  await sessionsRepo.revokeAllForUser(uid);
}
