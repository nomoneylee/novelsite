import { createHash } from 'node:crypto';
import { env } from '@/lib/env';
import { ServiceError } from '@/lib/services/errors';

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/** 介面保留，FEAT-4 可換共享儲存（FR-050） */
export interface RateLimitStore {
  hit(key: string, windowMs: number, max: number): Promise<RateLimitResult>;
  reset(key: string): Promise<void>;
}

interface WindowRecord {
  count: number;
  windowStart: number;
}

class MemoryRateLimitStore implements RateLimitStore {
  private records = new Map<string, WindowRecord>();

  async hit(key: string, windowMs: number, max: number): Promise<RateLimitResult> {
    const now = Date.now();
    const existing = this.records.get(key);

    if (!existing || now - existing.windowStart >= windowMs) {
      this.records.set(key, { count: 1, windowStart: now });
      return { allowed: true, retryAfterSeconds: 0 };
    }

    existing.count += 1;
    if (existing.count > max) {
      const retryAfterMs = existing.windowStart + windowMs - now;
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
    }

    return { allowed: true, retryAfterSeconds: 0 };
  }

  async reset(key: string): Promise<void> {
    this.records.delete(key);
  }
}

/** 本階段為單一執行個體記憶體實作 */
export const rateLimitStore: RateLimitStore = new MemoryRateLimitStore();

export const rateLimitMode: 'single-instance' | 'shared' = 'single-instance';

/**
 * 依 TRUSTED_PROXY_HOPS 自 X-Forwarded-For 右側往左數第 N 個位址；
 * 未設定（0）或標頭缺漏、hops 數超過既有位址數時一律回退直連位址（FR-039）。
 * MUST NOT 無條件採信轉發標頭最左側的值（可偽造而使限流失效）。
 */
export function clientIpFrom(headers: Headers, directIp: string): string {
  const hops = env.TRUSTED_PROXY_HOPS;
  if (hops <= 0) return directIp;

  const forwardedFor = headers.get('x-forwarded-for');
  if (!forwardedFor) return directIp;

  const parts = forwardedFor
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const index = parts.length - hops;
  if (index < 0) return directIp;

  return parts[index];
}

/** sha256(正規化 Email)，不存明碼（FR-046） */
export function accountKey(email: string): string {
  const normalized = email.trim().toLowerCase();
  return createHash('sha256').update(normalized).digest('hex');
}

// ─────────────────────────────────────────────────────────────
// FEAT-4 4-B 互動限流（T074，contracts/interaction-api.md §4）
// ─────────────────────────────────────────────────────────────

const MINUTE_MS = 60_000;

/**
 * 發表評論與留言的共用額度（`interaction:<userId>`）。
 *
 * **一把鎖，兩個入口共用**：分成兩份額度時，同一個人可以在一分鐘內送出兩倍的內容，
 * 而防的本來就是「同一個人洗版」而非「洗某一種版」。
 * 鍵為使用者識別碼而非位址 —— 要防的那個人換一條網路就換一個位址。
 *
 * 不在 `rateLimitStore` 內加分支（research R-16）：本函式只是把鍵與額度固定下來，
 * 儲存實作仍是同一個。
 */
export async function enforceInteractionQuota(userId: string): Promise<void> {
  const result = await rateLimitStore.hit(
    `interaction:${userId}`,
    MINUTE_MS,
    env.INTERACTION_RATE_MAX
  );
  if (!result.allowed) {
    throw new ServiceError('RATE_LIMITED', '發言太頻繁，請稍後再試', {
      retryAfterSeconds: result.retryAfterSeconds,
    });
  }
}

// ─────────────────────────────────────────────────────────────
// FEAT-9 / 009-admin-dashboard 管理後台速率限制（FR-028）
// ─────────────────────────────────────────────────────────────

export const ADMIN_RATE_LIMIT_MAX = 60;

/**
 * 管理後台操作額度（`admin:<userId>`，每位管理員每分鐘上限 60 次）。
 * 超限時擲出帶 retryAfterSeconds 之 ServiceError('RATE_LIMITED')。
 */
export async function enforceAdminQuota(userId: string, clientIp = 'unknown'): Promise<void> {
  const result = await rateLimitStore.hit(`admin:${userId}`, MINUTE_MS, ADMIN_RATE_LIMIT_MAX);
  if (!result.allowed) {
    try {
      const { auditLogRepo } = await import('@/lib/repositories');
      await auditLogRepo.createAuditLog({
        actorId: userId,
        action: 'admin.rate_limit_exceeded',
        targetType: 'User',
        targetId: userId,
        diff: JSON.stringify({ retryAfterSeconds: result.retryAfterSeconds }),
        reason: '超過每分鐘 60 次上限',
        ip: clientIp,
      });
    } catch {
      // 靜默容錯，確保限流錯誤碼正常拋出
    }
    throw new ServiceError('RATE_LIMITED', '管理操作太頻繁，請稍後再試', {
      retryAfterSeconds: result.retryAfterSeconds,
    });
  }
}
