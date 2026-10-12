import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '@/lib/db';
import { createUser } from '../helpers/fixtures';
import { enforceAdminQuota, ADMIN_RATE_LIMIT_MAX } from '@/lib/auth/rateLimit';

/**
 * FEAT-9 / 009-admin-dashboard Phase 8: 管理後台每分鐘 60 次速率限制整合測試 (T052)
 */
describe('管理後台速率限制 (FR-028)：60 次/分鐘上限、超限阻斷與超限事件稽核留痕', () => {
  let adminA: { id: string; email: string };
  let adminB: { id: string; email: string };

  beforeAll(async () => {
    adminA = await createUser({
      email: `admin-ratelimit-a-${Date.now()}@test.com`,
      role: 'admin',
    });

    adminB = await createUser({
      email: `admin-ratelimit-b-${Date.now()}@test.com`,
      role: 'admin',
    });
  });

  it('管理員連續 60 次請求皆放行，第 61 次被阻斷並拋出 RATE_LIMITED', async () => {
    // 前 60 次請求應放行
    for (let i = 0; i < ADMIN_RATE_LIMIT_MAX; i++) {
      await expect(enforceAdminQuota(adminA.id, '198.51.100.1')).resolves.toBeUndefined();
    }

    // 第 61 次請求應超限並拋出 ServiceError('RATE_LIMITED')
    await expect(enforceAdminQuota(adminA.id, '198.51.100.1')).rejects.toThrowError(
      expect.objectContaining({
        code: 'RATE_LIMITED',
        retryAfterSeconds: expect.any(Number),
      })
    );
  });

  it('速率限制觸發時自動寫入稽核紀錄 (admin.rate_limit_exceeded)', async () => {
    const audit = await prisma.auditLog.findFirst({
      where: {
        actorId: adminA.id,
        action: 'admin.rate_limit_exceeded',
      },
    });

    expect(audit).not.toBeNull();
    expect(audit?.actorId).toBe(adminA.id);
    expect(audit?.reason).toContain('超過每分鐘 60 次上限');
    expect(audit?.ip).toBe('198.51.100.1');
  });

  it('各管理員額度各自獨立累計，Admin A 超限不影響 Admin B', async () => {
    // Admin A 目前已超限
    await expect(enforceAdminQuota(adminA.id)).rejects.toThrowError(
      expect.objectContaining({ code: 'RATE_LIMITED' })
    );

    // Admin B 首次請求應正常放行
    await expect(enforceAdminQuota(adminB.id)).resolves.toBeUndefined();
  });
});
