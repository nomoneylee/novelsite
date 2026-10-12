import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { createUser, createPublishedNovel, cleanupNovels } from '../helpers/fixtures';
import { resetAuthTables } from '../helpers/resetAuthTables';
import * as adminService from '@/lib/services/adminService';

/**
 * FEAT-9 / 009-admin-dashboard US4: 標籤治理、合併去重與關聯轉移整合測試 (T038)
 */
describe('US4: 標籤治理、合併去重、searchText 重建與保護性刪除', () => {
  let adminUser: { id: string; email: string };
  let authorUser: { id: string; email: string };
  let novel1: { novelId: string };
  let novel2: { novelId: string };
  let novel3: { novelId: string };

  let tagA: { id: string; name: string; slug: string };
  let tagB: { id: string; name: string; slug: string };

  /** 本檔建立的作品，afterAll 逐一刪除；殘留會讓 seed-scale.test.ts 的「恰為 13 部」紅在別人身上 */
  const createdNovels: { authorId: string; novelId: string }[] = [];

  beforeAll(async () => {
    adminUser = await createUser({
      email: `admin-tag-${Date.now()}@test.com`,
      role: 'admin',
    });

    authorUser = await createUser({
      email: `author-tag-${Date.now()}@test.com`,
      role: 'author',
    });

    // 建立三部測試作品
    novel1 = await createPublishedNovel({
      authorId: authorUser.id,
      title: `標籤測試作品一-${Date.now()}`,
      chapterCount: 1,
    });

    novel2 = await createPublishedNovel({
      authorId: authorUser.id,
      title: `標籤測試作品二-${Date.now()}`,
      chapterCount: 1,
    });

    novel3 = await createPublishedNovel({
      authorId: authorUser.id,
      title: `標籤測試作品三-${Date.now()}`,
      chapterCount: 1,
    });

    for (const { novelId } of [novel1, novel2, novel3]) {
      createdNovels.push({ authorId: authorUser.id, novelId });
    }
  });

  afterAll(async () => {
    // 順序 MUST 為「先刪作品、再清認證表」：作品還在時作者受 Novel.authorId 的 Restrict 擋著刪不掉
    await cleanupNovels(createdNovels);
    await resetAuthTables();
  });

  it('新增標籤與唯一性約束限制', async () => {
    const timestamp = Date.now();
    const createdA = await adminService.createTag(adminUser.id, {
      name: `源標籤-${timestamp}`,
      slug: `source-tag-${timestamp}`,
    });
    tagA = { id: createdA.id, name: `源標籤-${timestamp}`, slug: `source-tag-${timestamp}` };

    const createdB = await adminService.createTag(adminUser.id, {
      name: `目標標籤-${timestamp}`,
      slug: `target-tag-${timestamp}`,
    });
    tagB = { id: createdB.id, name: `目標標籤-${timestamp}`, slug: `target-tag-${timestamp}` };

    // 驗證唯一性約束（重複名稱或 slug 應拋出 CONFLICT）
    await expect(
      adminService.createTag(adminUser.id, {
        name: tagA.name,
        slug: `different-slug-${timestamp}`,
      })
    ).rejects.toThrowError(
      expect.objectContaining({
        code: 'CONFLICT',
      })
    );

    await expect(
      adminService.createTag(adminUser.id, {
        name: `different-name-${timestamp}`,
        slug: tagA.slug,
      })
    ).rejects.toThrowError(
      expect.objectContaining({
        code: 'CONFLICT',
      })
    );
  });

  it('標籤合併：去重轉移作品關聯、源標籤安全刪除、searchText 重建與 AuditLog', async () => {
    // 設置關聯：
    // Novel 1: 關聯 Tag A
    // Novel 2: 同時關聯 Tag A 與 Tag B（測試去重轉移）
    // Novel 3: 只關聯 Tag B
    await prisma.novelTag.createMany({
      data: [
        { novelId: novel1.novelId, tagId: tagA.id },
        { novelId: novel2.novelId, tagId: tagA.id },
        { novelId: novel2.novelId, tagId: tagB.id },
        { novelId: novel3.novelId, tagId: tagB.id },
      ],
    });

    // 執行將 Tag A 合併至 Tag B
    const result = await adminService.mergeTags(adminUser.id, {
      sourceTagId: tagA.id,
      targetTagId: tagB.id,
      reason: '整併重複同義標籤',
    });

    expect(result.affectedCount).toBe(2); // Novel 1 & Novel 2

    // 驗證源標籤已自資料庫安全刪除
    const sourceInDb = await prisma.tag.findUnique({ where: { id: tagA.id } });
    expect(sourceInDb).toBeNull();

    // 驗證 Novel 1 現在擁有 Tag B
    const n1Tags = await prisma.novelTag.findMany({ where: { novelId: novel1.novelId } });
    expect(n1Tags.some((t) => t.tagId === tagB.id)).toBe(true);

    // 驗證 Novel 2 只有一筆 Tag B 關聯（去重成功，沒有重複的 NovelTag）
    const n2Tags = await prisma.novelTag.findMany({
      where: { novelId: novel2.novelId, tagId: tagB.id },
    });
    expect(n2Tags.length).toBe(1);

    // 驗證作品的 searchText 已同步更新
    const n1 = await prisma.novel.findUniqueOrThrow({ where: { id: novel1.novelId } });
    expect(n1.searchText.toLowerCase()).toContain(tagB.name.toLowerCase());
    expect(n1.searchText.toLowerCase()).not.toContain(tagA.name.toLowerCase());

    // 驗證 AuditLog 紀錄
    const audit = await prisma.auditLog.findFirst({
      where: {
        action: 'tag.merge',
        targetId: tagB.id,
      },
    });
    expect(audit).not.toBeNull();
    expect(audit?.actorId).toBe(adminUser.id);
    expect(audit?.reason).toBe('整併重複同義標籤');

    /*
      diff MUST 列出受影響作品的 id（2026-09-06 補）。
      只記數量的話，事後看日誌知道「影響 2 部」卻查不出是哪 2 部 ——
      而標籤合併是不可逆的（來源標籤已刪，目標標籤上新舊關聯混在一起分不出來），
      沒有這份清單就沒有補救的依據。
    */
    const mergeDiff = JSON.parse(audit!.diff) as {
      affectedNovelsCount: number;
      affectedNovelIds: string[];
      truncated?: boolean;
    };
    expect(mergeDiff.affectedNovelsCount).toBe(2);
    expect([...mergeDiff.affectedNovelIds].sort()).toEqual([novel1.novelId, novel2.novelId].sort());
    expect(mergeDiff.truncated).toBeUndefined();
  });

  it('編輯/更名標籤：更新關聯作品 searchText 並寫入 AuditLog', async () => {
    const newName = `${tagB.name}-更名`;
    const newSlug = `${tagB.slug}-renamed`;

    await adminService.renameTag(adminUser.id, {
      tagId: tagB.id,
      name: newName,
      slug: newSlug,
    });

    const updated = await prisma.tag.findUniqueOrThrow({ where: { id: tagB.id } });
    expect(updated.name).toBe(newName);
    expect(updated.slug).toBe(newSlug);

    // 作品 searchText 已同步包含新標籤名稱
    const n1 = await prisma.novel.findUniqueOrThrow({ where: { id: novel1.novelId } });
    expect(n1.searchText.toLowerCase()).toContain(newName.toLowerCase());

    const audit = await prisma.auditLog.findFirst({
      where: {
        action: 'tag.rename',
        targetId: tagB.id,
      },
    });
    expect(audit).not.toBeNull();
  });

  it('刪除標籤：關聯作品 > 0 時無 force 應被拒，勾選 force 後安全刪除', async () => {
    // tagB 目前關聯了 3 部作品
    await expect(
      adminService.deleteTag(adminUser.id, {
        tagId: tagB.id,
        force: false,
        reason: '廢棄標籤刪除',
      })
    ).rejects.toThrowError(
      expect.objectContaining({
        code: 'VALIDATION_ERROR',
      })
    );

    // 帶 force = true 強制刪除
    await adminService.deleteTag(adminUser.id, {
      tagId: tagB.id,
      force: true,
      reason: '管理員確認強制清理關聯並刪除',
    });

    const deleted = await prisma.tag.findUnique({ where: { id: tagB.id } });
    expect(deleted).toBeNull();

    // 關聯已全數清理
    const relations = await prisma.novelTag.findMany({ where: { tagId: tagB.id } });
    expect(relations.length).toBe(0);

    const audit = await prisma.auditLog.findFirst({
      where: {
        action: 'tag.delete',
        targetId: tagB.id,
      },
    });
    expect(audit).not.toBeNull();
    expect(audit?.reason).toBe('管理員確認強制清理關聯並刪除');

    /*
      diff MUST 列出被強制解除關聯的作品 id（2026-09-06 補）。
      `Tag.id` 是 cuid，重建同名標籤拿到的是新 id、原關聯回不來 ——
      這份清單是事後唯一能知道「該把標籤補回哪幾部作品」的依據。
    */
    const deleteDiff = JSON.parse(audit!.diff) as {
      affectedNovelsCount: number;
      affectedNovelIds: string[];
      truncated?: boolean;
    };
    expect(deleteDiff.affectedNovelsCount).toBe(deleteDiff.affectedNovelIds.length);
    expect([...deleteDiff.affectedNovelIds].sort()).toEqual(
      [novel1.novelId, novel2.novelId, novel3.novelId].sort()
    );
    expect(deleteDiff.truncated).toBeUndefined();
  });
});
