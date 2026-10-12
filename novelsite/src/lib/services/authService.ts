import 'server-only';
import type { z } from 'zod';
import { registerSchema, loginSchema } from '@/lib/validation/auth';
import { hashPassword, verifyPassword, DUMMY_HASH } from '@/lib/auth/password';
import { rateLimitStore, accountKey } from '@/lib/auth/rateLimit';
import { issueSession, revokeSession, revokeAllSessionsForUser } from '@/lib/auth/session';
import { logSecurityEvent } from '@/lib/auth/audit';
import { usersRepo, sessionsRepo, passwordResetTokensRepo } from '@/lib/repositories';
import { env } from '@/lib/env';
import type { Role } from '@/lib/auth/sessionToken';
import type { User } from '@/generated/prisma/client';

export interface RequestCtx {
  ip: string;
  userAgent: string;
}

export interface AuthResultUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface AuthResult {
  user: AuthResultUser;
  token: string;
}

export type AuthErrorCode =
  'VALIDATION_ERROR' | 'UNAUTHENTICATED' | 'CONFLICT' | 'RATE_LIMITED' | 'SUSPENDED';

export class AuthServiceError extends Error {
  code: AuthErrorCode;
  fields?: Record<string, string>;
  retryAfterSeconds?: number;

  constructor(
    code: AuthErrorCode,
    message: string,
    opts?: { fields?: Record<string, string>; retryAfterSeconds?: number }
  ) {
    super(message);
    this.name = 'AuthServiceError';
    this.code = code;
    this.fields = opts?.fields;
    this.retryAfterSeconds = opts?.retryAfterSeconds;
  }
}

function fieldErrors(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!(key in fields)) fields[key] = issue.message;
  }
  return fields;
}

function toAuthResultUser(user: User): AuthResultUser {
  return { id: user.id, name: user.name, email: user.email, role: user.role as Role };
}

/**
 * 自**未經驗證**的原始輸入取 email，供限流在 Zod 之前計數。
 *
 * FEAT-5 起由 `passwordResetService` 共用（T028）：FR-005 要求帳號鍵對**所有送入的
 * Email 一律計數**，而登入的 FR-046 是同一條規則。兩處各寫一份的結果是有一天其中一份
 * 被改成「先驗證再取值」，而那會讓限流只發生在格式正確的輸入上。
 */
export function extractRawEmail(input: unknown): string {
  if (input && typeof input === 'object' && 'email' in input) {
    const value = (input as Record<string, unknown>).email;
    if (typeof value === 'string') return value;
  }
  return '';
}

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

/**
 * 限流早於 Zod 驗證（FR-009 計數語意） → Email 唯一性檢查 → 409 → 寫入 termsAcceptedAt。
 */
export async function register(input: unknown, ctx: RequestCtx): Promise<AuthResult> {
  const ipKey = `register:ip:${ctx.ip}`;
  const ipLimit = await rateLimitStore.hit(ipKey, HOUR_MS, env.REGISTER_RATE_IP_MAX);
  if (!ipLimit.allowed) {
    logSecurityEvent({ event: 'auth.rate_limited', ip: ctx.ip, result: 'register_ip_limited' });
    throw new AuthServiceError('RATE_LIMITED', '請稍後再試', {
      retryAfterSeconds: ipLimit.retryAfterSeconds,
    });
  }

  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) {
    throw new AuthServiceError('VALIDATION_ERROR', '輸入格式不正確', {
      fields: fieldErrors(parsed.error),
    });
  }

  const existing = await usersRepo.findByEmail(parsed.data.email);
  if (existing) {
    throw new AuthServiceError('CONFLICT', '此 Email 已被註冊');
  }

  const passwordHash = await hashPassword(parsed.data.password);
  const user = await usersRepo.create({
    name: parsed.data.name,
    email: parsed.data.email,
    passwordHash,
    role: 'reader',
    termsAcceptedAt: new Date(),
  });

  const token = await issueSession({ id: user.id, role: user.role as Role }, ctx);

  return { user: toAuthResultUser(user), token };
}

/**
 * 限流早於查帳號（FR-046，兩鍵皆在查詢使用者之前）；帳號不存在時對 DUMMY_HASH 執行一次
 * verify 維持時序不可區分；成功後重置帳號鍵並清理該使用者過期／已撤銷列（FR-044）。
 */
export async function login(input: unknown, ctx: RequestCtx): Promise<AuthResult> {
  const rawEmail = extractRawEmail(input);

  const ipKey = `login:ip:${ctx.ip}`;
  const ipLimit = await rateLimitStore.hit(ipKey, MINUTE_MS, env.LOGIN_RATE_IP_MAX);
  if (!ipLimit.allowed) {
    logSecurityEvent({ event: 'auth.rate_limited', ip: ctx.ip, result: 'login_ip_limited' });
    throw new AuthServiceError('RATE_LIMITED', '請稍後再試', {
      retryAfterSeconds: ipLimit.retryAfterSeconds,
    });
  }

  const acctKey = accountKey(rawEmail);
  const acctLimit = await rateLimitStore.hit(acctKey, 15 * MINUTE_MS, env.LOGIN_RATE_ACCOUNT_MAX);
  if (!acctLimit.allowed) {
    logSecurityEvent({ event: 'auth.rate_limited', ip: ctx.ip, result: 'login_account_limited' });
    throw new AuthServiceError('RATE_LIMITED', '請稍後再試', {
      retryAfterSeconds: acctLimit.retryAfterSeconds,
    });
  }

  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    logSecurityEvent({ event: 'auth.login.failed', ip: ctx.ip, result: 'invalid_credentials' });
    throw new AuthServiceError('UNAUTHENTICATED', 'Email 或密碼不正確');
  }

  const user = await usersRepo.findByEmail(parsed.data.email);
  const isValid = user
    ? await verifyPassword(user.passwordHash, parsed.data.password)
    : await verifyPassword(DUMMY_HASH, parsed.data.password);

  if (!user || !isValid) {
    logSecurityEvent({ event: 'auth.login.failed', ip: ctx.ip, result: 'invalid_credentials' });
    throw new AuthServiceError('UNAUTHENTICATED', 'Email 或密碼不正確');
  }

  if (user.isSuspended) {
    logSecurityEvent({ event: 'auth.login.failed', ip: ctx.ip, result: 'suspended' });
    throw new AuthServiceError('SUSPENDED', '此帳號已被停權，如有疑問請聯繫客服');
  }

  await rateLimitStore.reset(acctKey);

  const token = await issueSession({ id: user.id, role: user.role as Role }, ctx);

  try {
    await sessionsRepo.deleteExpiredForUser(user.id);
  } catch {
    // 清理失敗 MUST NOT 導致登入失敗（FR-044）
  }

  return { user: toAuthResultUser(user), token };
}

export async function logout(sid: string): Promise<void> {
  await revokeSession(sid);
}

/**
 * FR-041：本階段 MUST NOT 開放任何對外端點或 UI；僅供整合測試與 FEAT-3 呼叫。
 * 成功後 MUST 立即撤銷該使用者當時全部工作階段（含發動變更的那一個）。
 */
export async function changePassword(
  uid: string,
  oldPlain: string,
  newPlain: string
): Promise<void> {
  const user = await usersRepo.findById(uid);
  if (!user) {
    throw new AuthServiceError('UNAUTHENTICATED', '使用者不存在');
  }

  const valid = await verifyPassword(user.passwordHash, oldPlain);
  if (!valid) {
    throw new AuthServiceError('UNAUTHENTICATED', '原密碼不正確');
  }

  const newHash = await hashPassword(newPlain);
  await usersRepo.updatePasswordHash(uid, newHash);
  await revokeAllSessionsForUser(uid);
  // FEAT-5 FR-011：其全部未使用的重設憑證一併作廢。
  // **沒有這一行，一封還在有效期內的舊重設信可以覆寫使用者剛改好的新密碼**
  await passwordResetTokensRepo.invalidateActiveForUser(uid);
}
