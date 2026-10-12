import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';

/**
 * US3（2-C）級聯刪除（FR-021、SC-005／SC-006）。
 *
 * 刪除一部作品後，其 `Volume`／`Chapter`／`ChapterContent`／`Review`／`RankingEntry`／
 * `NovelTag`／`NovelRelation`（From 與 To 兩個方向）MUST 全部消失、無孤兒列；
 * 共享實體 `Tag` 與被關聯的另一部作品 MUST 保留。
 *
 * 一致性驗收方式：本檔在 SQLite 與 PostgreSQL 兩軌各跑一次，結果 MUST 相同
 * （`DATABASE_PROVIDER=postgresql npm run test:integration`，quickstart §3）。
 *
 * 資料自備：MUST NOT 刪除示範作品 —— 本套件其他檔案（seed-scale、derived-fields、
 * pages-smoke）都依賴示範資料的完整性，且檔案間循序執行。故本檔自建一部拋棄式作品，
 * 並在 afterAll 兜底清除，避免中途失敗污染後續檔案。
 */

const NOVEL_ID = 'cascade-test-novel';
const VOLUME_ID = 'cascade-test-volume';
const CHAPTER_ID = 'cascade-test-chapter';
const REVIEW_ID = 'cascade-test-review';
const RANKING_RANK = 999;

/** 既有示範資料，用來驗證「不該被連帶刪除」的一方 */
let otherNovelId: string;
let tagId: string;
let userId: string;
let categoryId: string;

beforeAll(async () => {
  const otherNovel = await prisma.novel.findFirstOrThrow({
    select: { id: true, authorId: true, categoryId: true },
  });
  otherNovelId = otherNovel.id;
  userId = otherNovel.authorId;
  categoryId = otherNovel.categoryId;
  tagId = (await prisma.tag.findFirstOrThrow({ select: { id: true } })).id;

  await prisma.novel.create({
    data: {
      id: NOVEL_ID,
      title: '級聯刪除測試作品',
      authorId: userId,
      categoryId,
      coverColor: 'linear-gradient(135deg, #000, #333)',
      wordCount: 0,
      chapterCount: 0,
      rating: 0,
      excerpt: '整合測試用，不對外顯示',
      status: 'draft',
      publishedAt: new Date(),
      volumes: { create: { id: VOLUME_ID, number: 1, title: '正文' } },
      tags: { create: { tagId } },
      // FEAT-4 4-B：`publishedAt` 已拆為 `createdAt` + `updatedAt`（data-model.md §3.1）；
      // `updatedAt` 由 Prisma 於建立時自動寫入，故此處不再指定日期欄位
      reviews: {
        create: {
          id: REVIEW_ID,
          userId,
          rating: 5,
          content: '整合測試用評論',
        },
      },
      rankings: { create: { period: 'weekly', rank: RANKING_RANK } },
      // 方向性關聯的兩端都要建：From（本作品→他人）與 To（他人→本作品）
      relations: { create: { relatedNovelId: otherNovelId, sortOrder: 0 } },
      relatedBy: { create: { novelId: otherNovelId, sortOrder: 99 } },
    },
  });

  await prisma.chapter.create({
    data: {
      id: CHAPTER_ID,
      novelId: NOVEL_ID,
      volumeId: VOLUME_ID,
      number: 1,
      title: '級聯刪除測試章節',
      wordCount: 10,
      status: 'published',
      publishedAt: new Date(),
      content: { create: { bodyMarkdown: '整合測試用正文。', format: 'markdown' } },
    },
  });
});

afterAll(async () => {
  // 兜底：測試中途失敗時，殘留的測試作品會使 seed-scale 的 13 部斷言轉紅
  await prisma.novel.deleteMany({ where: { id: NOVEL_ID } });
});

describe('刪除作品：全部從屬資料級聯消失、無孤兒列（FR-021、SC-006）', () => {
  it('前置：測試作品與其全部從屬資料都已建立', async () => {
    expect(await prisma.volume.count({ where: { novelId: NOVEL_ID } })).toBe(1);
    expect(await prisma.chapter.count({ where: { novelId: NOVEL_ID } })).toBe(1);
    expect(await prisma.chapterContent.count({ where: { chapterId: CHAPTER_ID } })).toBe(1);
    expect(await prisma.review.count({ where: { novelId: NOVEL_ID } })).toBe(1);
    expect(await prisma.rankingEntry.count({ where: { novelId: NOVEL_ID } })).toBe(1);
    expect(await prisma.novelTag.count({ where: { novelId: NOVEL_ID } })).toBe(1);
    expect(await prisma.novelRelation.count({ where: { novelId: NOVEL_ID } })).toBe(1);
    expect(await prisma.novelRelation.count({ where: { relatedNovelId: NOVEL_ID } })).toBe(1);
  });

  it('刪除作品後，七類從屬資料皆為 0 筆', async () => {
    await prisma.novel.delete({ where: { id: NOVEL_ID } });

    expect(await prisma.novel.count({ where: { id: NOVEL_ID } })).toBe(0);
    expect(await prisma.volume.count({ where: { novelId: NOVEL_ID } })).toBe(0);
    expect(await prisma.chapter.count({ where: { novelId: NOVEL_ID } })).toBe(0);
    expect(await prisma.chapterContent.count({ where: { chapterId: CHAPTER_ID } })).toBe(0);
    expect(await prisma.review.count({ where: { novelId: NOVEL_ID } })).toBe(0);
    expect(await prisma.rankingEntry.count({ where: { novelId: NOVEL_ID } })).toBe(0);
    expect(await prisma.novelTag.count({ where: { novelId: NOVEL_ID } })).toBe(0);
    // 反向（relatedBy）也 MUST 級聯，否則會留下指向已刪作品的孤兒關聯
    expect(await prisma.novelRelation.count({ where: { relatedNovelId: NOVEL_ID } })).toBe(0);
  });

  it('共享實體與被關聯的另一部作品 MUST 保留', async () => {
    expect(await prisma.tag.count({ where: { id: tagId } })).toBe(1);
    expect(await prisma.novel.count({ where: { id: otherNovelId } })).toBe(1);
    expect(await prisma.user.count({ where: { id: userId } })).toBe(1);
    expect(await prisma.category.count({ where: { id: categoryId } })).toBe(1);
  });

  it('全庫掃描：不存在任何指向已刪作品的孤兒列', async () => {
    const [volumes, chapters, reviews, rankings, novelTags, relationsFrom, relationsTo] =
      await Promise.all([
        prisma.volume.count({ where: { novelId: NOVEL_ID } }),
        prisma.chapter.count({ where: { novelId: NOVEL_ID } }),
        prisma.review.count({ where: { novelId: NOVEL_ID } }),
        prisma.rankingEntry.count({ where: { novelId: NOVEL_ID } }),
        prisma.novelTag.count({ where: { novelId: NOVEL_ID } }),
        prisma.novelRelation.count({ where: { novelId: NOVEL_ID } }),
        prisma.novelRelation.count({ where: { relatedNovelId: NOVEL_ID } }),
      ]);

    expect([volumes, chapters, reviews, rankings, novelTags, relationsFrom, relationsTo]).toEqual([
      0, 0, 0, 0, 0, 0, 0,
    ]);
  });
});
