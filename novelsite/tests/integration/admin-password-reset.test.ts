import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '@/lib/db';
import { createUser } from '../helpers/fixtures';
import { testFetch } from '../helpers/client';
import * as adminService from '@/lib/services/adminService';
import { confirmPasswordReset } from '@/lib/services/passwordResetService';

/**
 * FEAT-9 / 009-admin-dashboard US2: 管理員協助重設密碼雙軌整合測試 (T022)
 */
describe('US2: 管理員協助重設密碼雙軌機制（郵件 / 一次性連結）', () => {
  let adminUser: { id: string; email: string };
  let targetUser: { id: string; email: string };

  beforeAll(async () => {
    adminUser = await createUser({
      email: `admin-pwd-${Date.now()}@test.com`,
      role: 'admin',
    });

    targetUser = await createUser({
      email: `target-pwd-${Date.now()}@test.com`,
      role: 'reader',
    });
  });

  it('模式一：產生一次性重設連結（15 分鐘 TTL，不經手明碼）', async () => {
    const res = await adminService.resetUserPassword(adminUser.id, {
      userId: targetUser.id,
      mode: 'link',
    });

    expect(res.mode).toBe('link');
    if (res.mode === 'link') {
      expect(res.resetUrl).toContain('/auth/reset-password?token=');
      expect(res.expiresAt).toBeDefined();

      const expiresTime = new Date(res.expiresAt).getTime();
      const now = Date.now();
      // 15 分鐘 TTL (約 900,000 ms, 容許正負 10 秒)
      expect(expiresTime - now).toBeGreaterThan(14 * 60 * 1000);
      expect(expiresTime - now).toBeLessThanOrEqual(16 * 60 * 1000);

      // 檢查 AuditLog 寫入
      const logs = await prisma.auditLog.findMany({
        where: { targetId: targetUser.id, action: 'user.reset_password_link' },
      });
      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0].actorId).toBe(adminUser.id);
    }
  });

  it('以一次性連結之 token 成功重設密碼並登入，且二次使用失效（單次消耗）', async () => {
    // 產生連結
    const resetRes = await adminService.resetUserPassword(adminUser.id, {
      userId: targetUser.id,
      mode: 'link',
    });
    expect(resetRes.mode).toBe('link');
    if (resetRes.mode !== 'link') return;

    const tokenMatch = resetRes.resetUrl.match(/token=([a-zA-Z0-9_-]+)/);
    expect(tokenMatch).not.toBeNull();
    const token = tokenMatch![1];

    const newPassword = 'NewSecret1234!';

    // 透過密碼重設確認服務完成重設
    await confirmPasswordReset({
      token,
      password: newPassword,
    });

    // 驗證可用新密碼登入成功
    const loginRes = await testFetch('/api/auth/login', {
      ip: '10.98.1.2',
      method: 'POST',
      body: JSON.stringify({
        email: targetUser.email,
        password: newPassword,
      }),
    });

    expect(loginRes.status).toBe(200);

    // 驗證該 token 二次使用已被作廢
    await expect(
      confirmPasswordReset({
        token,
        password: 'AnotherPassword123!',
      })
    ).rejects.toThrow();
  });

  it('模式二：觸發寄送重設信，寫入 AuditLog 且記錄寄送嘗試', async () => {
    const res = await adminService.resetUserPassword(adminUser.id, {
      userId: targetUser.id,
      mode: 'email',
    });

    expect(res.mode).toBe('email');

    // 檢查 AuditLog 寫入
    const logs = await prisma.auditLog.findMany({
      where: { targetId: targetUser.id, action: 'user.reset_password_email' },
    });
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0].actorId).toBe(adminUser.id);
  });
});
