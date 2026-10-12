import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import {
  createUser,
  createPublishedNovel,
  cleanupNovels,
  type TestPublishedNovel,
} from '../helpers/fixtures';
import { resetAuthTables } from '../helpers/resetAuthTables';
import * as adminService from '@/lib/services/adminService';
import * as novelService from '@/lib/services/novelService';
import * as chapterService from '@/lib/services/chapterService';
import * as chapterBatchService from '@/lib/services/chapterBatchService';
import { getNovelDetail } from '@/lib/repositories/novels';

/**
 * FEAT-9 / 009-admin-dashboard US3: 內容管理、下架與審查整合測試 (T030)
 */
describe('US3: 作品與章節違規下架、發佈鎖定、硬刪除重算與留言審查', () => {
  let adminUser: { id: string; email: string };
  let authorUser: { id: string; email: string };
  let readerUser: { id: string; email: string };
  let novelData: TestPublishedNovel;

  /** 本檔建立的作品，afterAll 逐一刪除；殘留會讓 seed-scale.test.ts 的「恰為 13 部」紅在別人身上 */
  const createdNovels: { authorId: string; novelId: string }[] = [];

  beforeAll(async () => {
    adminUser = await createUser({
      email: `admin-content-${Date.now()}@test.com`,
      role: 'admin',
    });

    authorUser = await createUser({
      email: `author-content-${Date.now()}@test.com`,
      role: 'author',
    });

    readerUser = await createUser({
      email: `reader-content-${Date.now()}@test.com`,
      role: 'reader',
    });

    novelData = await createPublishedNovel({
      authorId: authorUser.id,
      title: `內容審查測試作品-${Date.now()}`,
      chapterCount: 3,
    });
    createdNovels.push({ authorId: authorUser.id, novelId: novelData.novelId });
  });

  afterAll(async () => {
    // 順序 MUST 為「先刪作品、再清認證表」：作品還在時作者受 Novel.authorId 的 Restrict 擋著刪不掉
    await cleanupNovels(createdNovels);
    await resetAuthTables();
  });

  describe('作品違規下架與恢復', () => {
    it('前台初始可讀取已發佈作品', async () => {
      const detail = await getNovelDetail(novelData.novelId);
      expect(detail).not.toBeNull();
      expect(detail?.title).toContain('內容審查測試作品');
    });

    it('管理員下架作品：作品狀態變更為 admin_suspended，前台 404，寫入 AuditLog', async () => {
      await adminService.adminSuspendNovel(adminUser.id, {
        novelId: novelData.novelId,
        reason: '內容涉及重大違規緊急下架',
      });

      // 資料庫狀態確認
      const inDb = await prisma.novel.findUnique({ where: { id: novelData.novelId } });
      expect(inDb?.status).toBe('admin_suspended');

      // 前台讀者端查詢回傳 null (404)
      const detail = await getNovelDetail(novelData.novelId);
      expect(detail).toBeNull();

      // 驗證稽核日誌
      const audit = await prisma.auditLog.findFirst({
        where: {
          targetId: novelData.novelId,
          action: 'novel.admin_suspend',
        },
      });
      expect(audit).not.toBeNull();
      expect(audit?.actorId).toBe(adminUser.id);
      expect(audit?.reason).toBe('內容涉及重大違規緊急下架');
    });

    it('作者嘗試自主變更遭管理員下架之作品：拋出 FORBIDDEN 拒絕', async () => {
      await expect(
        novelService.setNovelStatus(authorUser.id, {
          novelId: novelData.novelId,
          status: 'published',
        })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'FORBIDDEN',
        })
      );

      await expect(
        novelService.setNovelStatus(authorUser.id, {
          novelId: novelData.novelId,
          status: 'draft',
        })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'FORBIDDEN',
        })
      );
    });

    it('管理員恢復作品上架：作品狀態回歸 published，前台可見，寫入 AuditLog', async () => {
      await adminService.adminRestoreNovel(adminUser.id, {
        novelId: novelData.novelId,
        reason: '作者完成整改，審查合格恢復上架',
      });

      const inDb = await prisma.novel.findUnique({ where: { id: novelData.novelId } });
      expect(inDb?.status).toBe('published');

      const detail = await getNovelDetail(novelData.novelId);
      expect(detail).not.toBeNull();

      const audit = await prisma.auditLog.findFirst({
        where: {
          targetId: novelData.novelId,
          action: 'novel.restore',
        },
      });
      expect(audit).not.toBeNull();
      expect(audit?.reason).toBe('作者完成整改，審查合格恢復上架');
    });
  });

  describe('章節違規下架與發佈阻絕', () => {
    it('管理員下架第 1 章：狀態變更為 admin_suspended，寫入 AuditLog', async () => {
      const chapterId = novelData.chapterIds[0];

      await adminService.adminSuspendChapter(adminUser.id, {
        chapterId,
        reason: '該章節包含未授權內容',
      });

      const inDb = await prisma.chapter.findUnique({ where: { id: chapterId } });
      expect(inDb?.status).toBe('admin_suspended');

      const audit = await prisma.auditLog.findFirst({
        where: {
          targetId: chapterId,
          action: 'chapter.admin_suspend',
        },
      });
      expect(audit).not.toBeNull();
      expect(audit?.reason).toBe('該章節包含未授權內容');
    });

    it('作者嘗試發佈遭下架之單章：遭伺服器 FORBIDDEN 阻斷', async () => {
      const chapterId = novelData.chapterIds[0];

      // 立即發佈
      await expect(
        chapterService.publishChapter(authorUser.id, { chapterId })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'FORBIDDEN',
        })
      );

      // 變更狀態
      await expect(
        chapterService.setChapterStatus(authorUser.id, { chapterId, status: 'published' })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'FORBIDDEN',
        })
      );

      // 排程發佈
      await expect(
        chapterService.schedulePublish(
          authorUser.id,
          chapterId,
          new Date(Date.now() + 24 * 60 * 60 * 1000)
        )
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'FORBIDDEN',
        })
      );
    });

    it('作者嘗試批次發佈包含遭下架之章節：整批遭到阻斷', async () => {
      await expect(
        chapterBatchService.publishChapters(authorUser.id, {
          volumeId: novelData.volumeId,
          chapterIds: [novelData.chapterIds[0], novelData.chapterIds[1]],
        })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'FORBIDDEN',
        })
      );
    });

    it('管理員恢復章節發佈：章節恢復 published，寫入 AuditLog', async () => {
      const chapterId = novelData.chapterIds[0];

      await adminService.adminRestoreChapter(adminUser.id, {
        chapterId,
        reason: '版權確認無誤恢復發佈',
      });

      const inDb = await prisma.chapter.findUnique({ where: { id: chapterId } });
      expect(inDb?.status).toBe('published');

      const audit = await prisma.auditLog.findFirst({
        where: {
          targetId: chapterId,
          action: 'chapter.restore',
        },
      });
      expect(audit).not.toBeNull();
      expect(audit?.reason).toBe('版權確認無誤恢復發佈');
    });
  });

  describe('章節硬刪除與字數/章節數精確重算', () => {
    it('管理員硬刪除第 3 章：同一交易內刪除章節並重算作品字數與章節數', async () => {
      const targetChapterId = novelData.chapterIds[2];
      const beforeNovel = await prisma.novel.findUniqueOrThrow({
        where: { id: novelData.novelId },
      });
      const beforeChapter = await prisma.chapter.findUniqueOrThrow({
        where: { id: targetChapterId },
      });

      expect(beforeNovel.chapterCount).toBe(3);

      const recount = await adminService.adminDeleteChapter(adminUser.id, {
        chapterId: targetChapterId,
        reason: '管理員強制刪除違規垃圾章節',
      });

      // 檢查回傳
      expect(recount.chapterCount).toBe(2);
      expect(recount.wordCount).toBe(beforeNovel.wordCount - beforeChapter.wordCount);

      // 檢查資料庫章節已不存在
      const deletedChapter = await prisma.chapter.findUnique({ where: { id: targetChapterId } });
      expect(deletedChapter).toBeNull();

      // 檢查作品即時重算
      const afterNovel = await prisma.novel.findUniqueOrThrow({ where: { id: novelData.novelId } });
      expect(afterNovel.chapterCount).toBe(2);
      expect(afterNovel.wordCount).toBe(recount.wordCount);

      // 檢查稽核日誌
      const audit = await prisma.auditLog.findFirst({
        where: {
          targetId: targetChapterId,
          action: 'chapter.delete',
        },
      });
      expect(audit).not.toBeNull();
      expect(audit?.reason).toBe('管理員強制刪除違規垃圾章節');
    });
  });

  describe('留言審閱與階層墓碑刪除', () => {
    let commentId: string;

    beforeAll(async () => {
      const comment = await prisma.comment.create({
        data: {
          chapterId: novelData.chapterIds[0],
          userId: readerUser.id,
          content: '這是一則測試違規留言',
          status: 'visible',
        },
      });
      commentId = comment.id;
    });

    it('管理員隱藏留言：status 更新為 hidden，寫入 AuditLog', async () => {
      await adminService.moderateComment(adminUser.id, commentId, 'hide', '含有廣告連結，暫行隱藏');

      const inDb = await prisma.comment.findUnique({ where: { id: commentId } });
      expect(inDb?.status).toBe('hidden');

      const audit = await prisma.auditLog.findFirst({
        where: {
          targetId: commentId,
          action: 'comment.hide',
        },
      });
      expect(audit).not.toBeNull();
      expect(audit?.reason).toBe('含有廣告連結，暫行隱藏');
    });

    it('管理員墓碑刪除留言：status 更新為 deleted，保留階層，寫入 AuditLog', async () => {
      await adminService.moderateComment(
        adminUser.id,
        commentId,
        'delete',
        '嚴重違規文字，永久墓碑刪除'
      );

      const inDb = await prisma.comment.findUnique({ where: { id: commentId } });
      expect(inDb?.status).toBe('deleted');

      const audit = await prisma.auditLog.findFirst({
        where: {
          targetId: commentId,
          action: 'comment.delete',
        },
      });
      expect(audit).not.toBeNull();
      expect(audit?.reason).toBe('嚴重違規文字，永久墓碑刪除');
    });
  });
});
