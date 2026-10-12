import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { createUser, createPublishedNovel, cleanupNovels } from '../helpers/fixtures';
import { resetAuthTables } from '../helpers/resetAuthTables';
import { testFetch } from '../helpers/client';
import * as adminService from '@/lib/services/adminService';
import { ServiceError } from '@/lib/services/errors';

/**
 * FEAT-9 / 009-admin-dashboard US2: 使用者停權/復權與防呆整合測試 (T021)
 */
describe('US2: 使用者停權、復權與自我防呆保護', () => {
  let adminUser: { id: string; email: string };
  let victimUser: { id: string; email: string };
  let authorUser: { id: string; email: string };

  /** 本檔建立的作品，afterAll 逐一刪除；殘留會讓 seed-scale.test.ts 的「恰為 13 部」紅在別人身上 */
  const createdNovels: { authorId: string; novelId: string }[] = [];

  beforeAll(async () => {
    // 建立測試專用管理員
    adminUser = await createUser({
      email: `admin-suspend-${Date.now()}@test.com`,
      role: 'admin',
    });

    // 建立受測讀者
    victimUser = await createUser({
      email: `victim-${Date.now()}@test.com`,
      role: 'reader',
    });

    // 建立受測作者
    authorUser = await createUser({
      email: `author-suspend-${Date.now()}@test.com`,
      role: 'author',
    });

    // 為作者建立一本已發佈作品，驗證停權不連坐下架
    const novel = await createPublishedNovel({
      authorId: authorUser.id,
      title: `公開作品-${Date.now()}`,
    });
    createdNovels.push({ authorId: authorUser.id, novelId: novel.novelId });
  });

  afterAll(async () => {
    // 順序 MUST 為「先刪作品、再清認證表」：作品還在時作者受 Novel.authorId 的 Restrict 擋著刪不掉
    await cleanupNovels(createdNovels);
    await resetAuthTables();
  });

  it('停權使用者：isSuspended 設為 true，並寫入 AuditLog', async () => {
    const res = await adminService.suspendUser(adminUser.id, {
      userId: victimUser.id,
      reason: '違反社群守則發送垃圾訊息',
    });

    expect(res.isSuspended).toBe(true);

    const updated = await prisma.user.findUnique({ where: { id: victimUser.id } });
    expect(updated?.isSuspended).toBe(true);
    expect(updated?.suspendedAt).not.toBeNull();

    // 檢查 AuditLog
    const logs = await prisma.auditLog.findMany({
      where: { targetId: victimUser.id, action: 'user.suspend' },
    });
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0].actorId).toBe(adminUser.id);
    expect(logs[0].reason).toContain('違反社群守則');
  });

  it('被停權使用者登入被拒絕，回傳 SUSPENDED', async () => {
    const loginRes = await testFetch('/api/auth/login', {
      ip: '10.99.1.1',
      method: 'POST',
      body: JSON.stringify({
        email: victimUser.email,
        password: 'Test1234',
      }),
    });

    expect(loginRes.status).toBe(403);
    const body = await loginRes.json();
    expect(body.error?.code).toBe('SUSPENDED');
  });

  it('被停權作者名下已發佈作品不受連坐下架（維持 published）', async () => {
    // 停權作者
    await adminService.suspendUser(adminUser.id, {
      userId: authorUser.id,
      reason: '作者帳號行為異常暫時停權',
    });

    // 查詢作品狀態
    const novel = await prisma.novel.findFirst({
      where: { authorId: authorUser.id },
    });

    expect(novel).toBeDefined();
    expect(novel?.status).toBe('published');
  });

  it('復權使用者：isSuspended 設為 false，並可正常登入', async () => {
    const res = await adminService.reactivateUser(adminUser.id, {
      userId: victimUser.id,
      reason: '申訴審核通過，解除停權',
    });

    expect(res.isSuspended).toBe(false);

    const updated = await prisma.user.findUnique({ where: { id: victimUser.id } });
    expect(updated?.isSuspended).toBe(false);
    expect(updated?.suspendedAt).toBeNull();

    // 復權後可成功登入
    const loginRes = await testFetch('/api/auth/login', {
      ip: '10.99.1.2',
      method: 'POST',
      body: JSON.stringify({
        email: victimUser.email,
        password: 'Test1234',
      }),
    });

    expect(loginRes.status).toBe(200);
    const body = await loginRes.json();
    expect(body.data?.user?.email).toBe(victimUser.email);
  });

  it('自我防呆：管理員不可停權自己的帳號', async () => {
    await expect(
      adminService.suspendUser(adminUser.id, {
        userId: adminUser.id,
        reason: '誤操作自我停權',
      })
    ).rejects.toThrow(ServiceError);

    try {
      await adminService.suspendUser(adminUser.id, {
        userId: adminUser.id,
        reason: '誤操作自我停權',
      });
    } catch (err) {
      expect(err).toBeInstanceOf(ServiceError);
      expect((err as ServiceError).code).toBe('CONFLICT');
    }
  });

  it('自我防呆：管理員不可降級自己的管理員角色', async () => {
    await expect(
      adminService.changeUserRole(adminUser.id, {
        userId: adminUser.id,
        newRole: 'reader',
        reason: '誤操作降級自身',
      })
    ).rejects.toThrow(ServiceError);

    try {
      await adminService.changeUserRole(adminUser.id, {
        userId: adminUser.id,
        newRole: 'reader',
        reason: '誤操作降級自身',
      });
    } catch (err) {
      expect(err).toBeInstanceOf(ServiceError);
      expect((err as ServiceError).code).toBe('CONFLICT');
    }
  });

  it('防呆：當僅剩一位有效管理員時，不可停權或降級該管理員', async () => {
    // 找出所有其他管理員暫時將其停權或降級，製造只剩一位管理員情境
    const allAdmins = await prisma.user.findMany({
      where: { role: 'admin', isSuspended: false },
    });

    // 建立臨時獨立管理員做孤本測試
    const soleAdmin = await createUser({
      email: `sole-admin-${Date.now()}@test.com`,
      role: 'admin',
    });

    // 模擬只剩 soleAdmin (將其他管理員標為 suspended)
    const otherAdminIds = allAdmins.map((a) => a.id);
    await prisma.user.updateMany({
      where: { id: { in: otherAdminIds } },
      data: { isSuspended: true },
    });

    try {
      // 外部操作者嘗試停權 soleAdmin
      await expect(
        adminService.suspendUser(adminUser.id, {
          userId: soleAdmin.id,
          reason: '嘗試停權最後一位有效管理員',
        })
      ).rejects.toThrow(ServiceError);
    } finally {
      // 復原其他管理員
      await prisma.user.updateMany({
        where: { id: { in: otherAdminIds } },
        data: { isSuspended: false },
      });
    }
  });
});
