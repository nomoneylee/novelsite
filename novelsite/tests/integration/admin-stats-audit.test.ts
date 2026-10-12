import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { createUser, createPublishedNovel, cleanupNovels } from '../helpers/fixtures';
import { resetAuthTables } from '../helpers/resetAuthTables';
import * as adminStatsService from '@/lib/services/adminStatsService';
import * as adminService from '@/lib/services/adminService';
import { auditLogRepo } from '@/lib/repositories';

/**
 * FEAT-9 / 009-admin-dashboard US5: 營運統計儀表板、趨勢計算與安全稽核留痕整合測試 (T044)
 */
describe('US5: 全站統計聚合、歷史趨勢、分類分佈與稽核日誌純追加及 IP 雜湊化', () => {
  let adminUser: { id: string; email: string };
  let authorUser: { id: string; email: string };
  let readerUser: { id: string; email: string };

  /** 本檔建立的作品，afterAll 逐一刪除；殘留會讓 seed-scale.test.ts 的「恰為 13 部」紅在別人身上 */
  const createdNovels: { authorId: string; novelId: string }[] = [];

  beforeAll(async () => {
    adminUser = await createUser({
      email: `admin-stats-${Date.now()}@test.com`,
      role: 'admin',
    });

    authorUser = await createUser({
      email: `author-stats-${Date.now()}@test.com`,
      role: 'author',
    });

    readerUser = await createUser({
      email: `reader-stats-${Date.now()}@test.com`,
      role: 'reader',
    });

    // 建立作品與章節
    const novel = await createPublishedNovel({
      authorId: authorUser.id,
      title: `統計測試作品一-${Date.now()}`,
      chapterCount: 2,
    });
    createdNovels.push({ authorId: authorUser.id, novelId: novel.novelId });
  });

  afterAll(async () => {
    // 順序 MUST 為「先刪作品、再清認證表」：作品還在時作者受 Novel.authorId 的 Restrict 擋著刪不掉
    await cleanupNovels(createdNovels);
    await resetAuthTables();
  });

  it('全站指標概覽 (getSiteOverview)：精確聚合各角色、作品狀態、字數與章節數', async () => {
    const overview = await adminStatsService.getSiteOverview();

    // 驗證使用者數指標
    expect(overview.users.total).toBeGreaterThanOrEqual(3);
    expect(overview.users.admins).toBeGreaterThanOrEqual(1);
    expect(overview.users.authors).toBeGreaterThanOrEqual(1);
    expect(overview.users.readers).toBeGreaterThanOrEqual(1);

    // 驗證作品與字數統計指標
    expect(overview.novels.total).toBeGreaterThanOrEqual(1);
    expect(overview.novels.published).toBeGreaterThanOrEqual(1);
    expect(overview.chapters.total).toBeGreaterThanOrEqual(2);
    expect(overview.chapters.totalWords).toBeGreaterThan(0);
  });

  it('全站營運趨勢 (getDailyTrends)：7 天與 30 天序列對齊台北日，無資料時提供零值基線', async () => {
    const trends7 = await adminStatsService.getDailyTrends(7);
    expect(trends7.length).toBe(7);
    for (const point of trends7) {
      expect(point.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(point.views).toBeGreaterThanOrEqual(0);
      expect(point.newUsers).toBeGreaterThanOrEqual(0);
    }

    const trends30 = await adminStatsService.getDailyTrends(30);
    expect(trends30.length).toBe(30);
  });

  it('小說分類分佈 (getCategoryDistribution)：回傳各分類作品數與連載狀態統計', async () => {
    const distribution = await adminStatsService.getCategoryDistribution();
    expect(Array.isArray(distribution)).toBe(true);
    expect(distribution.length).toBeGreaterThan(0);

    const firstCat = distribution[0];
    expect(firstCat).toHaveProperty('id');
    expect(firstCat).toHaveProperty('name');
    expect(firstCat).toHaveProperty('totalNovels');
    expect(firstCat).toHaveProperty('ongoingNovels');
    expect(firstCat).toHaveProperty('completedNovels');
  });

  it('安全稽核留痕：純追加不可竄改（無 update/delete API 出口）', async () => {
    // 寫入測試稽核紀錄
    const created = await auditLogRepo.createAuditLog({
      actorId: adminUser.id,
      action: 'novel.admin_suspend',
      targetType: 'Novel',
      targetId: 'test-novel-id',
      diff: JSON.stringify({ before: 'published', after: 'admin_suspended' }),
      reason: '測試違規下架留痕',
      ip: '192.0.2.1',
    });

    expect(created.id).toBeDefined();

    // 經服務層查詢
    const logs = await adminService.listAuditLogs({
      actorId: adminUser.id,
      action: 'novel.admin_suspend',
    });

    expect(logs.items.some((l) => l.id === created.id)).toBe(true);

    // 靜態邊界驗證：auditLogRepo 與 adminService 絕無任何 updateAuditLog 或 deleteAuditLog 函式
    const repoExports = Object.keys(auditLogRepo);
    expect(repoExports.some((k) => k.toLowerCase().includes('deleteaudit'))).toBe(false);
    expect(repoExports.some((k) => k.toLowerCase().includes('updateaudit'))).toBe(false);

    const serviceExports = Object.keys(adminService);
    expect(serviceExports.some((k) => k.toLowerCase().includes('deleteaudit'))).toBe(false);
    expect(serviceExports.some((k) => k.toLowerCase().includes('updateaudit'))).toBe(false);
  });

  it('IP 90 天雜湊化作業：90 天以上舊日誌 IP 轉為 SHA-256 雜湊，近期日誌保持明文', async () => {
    const rawIp = '198.51.100.99';
    const ninetyFiveDaysAgo = new Date(Date.now() - 95 * 24 * 3600 * 1000);
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 3600 * 1000);

    // 建立 95 天前舊紀錄
    const oldLog = await prisma.auditLog.create({
      data: {
        actorId: adminUser.id,
        action: 'user.suspend',
        targetType: 'User',
        targetId: readerUser.id,
        reason: '過期舊日誌測試',
        ip: rawIp,
        createdAt: ninetyFiveDaysAgo,
      },
    });

    // 建立 2 天前新紀錄
    const recentLog = await prisma.auditLog.create({
      data: {
        actorId: adminUser.id,
        action: 'user.suspend',
        targetType: 'User',
        targetId: readerUser.id,
        reason: '近期日誌測試',
        ip: rawIp,
        createdAt: twoDaysAgo,
      },
    });

    // 執行 90 天前 IP 雜湊化
    const cutoff = new Date(Date.now() - 90 * 24 * 3600 * 1000);
    const hashedCount = await auditLogRepo.hashOldAuditIps(cutoff);
    expect(hashedCount).toBeGreaterThanOrEqual(1);

    // 驗證舊紀錄的 IP 已經被雜湊化（長度為 64 且不等於 rawIp）
    const oldLogAfter = await prisma.auditLog.findUniqueOrThrow({ where: { id: oldLog.id } });
    expect(oldLogAfter.ip).not.toBe(rawIp);
    expect(oldLogAfter.ip.length).toBe(64);

    // 驗證新紀錄的 IP 仍然保持原始明文
    const recentLogAfter = await prisma.auditLog.findUniqueOrThrow({ where: { id: recentLog.id } });
    expect(recentLogAfter.ip).toBe(rawIp);
  });
});
