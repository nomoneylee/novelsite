import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';

/**
 * US2（2-B）示範資料的規模與自洽（FR-011／FR-011a／FR-012a、contracts/seed-content）。
 *
 * 規模為裁示定案值：13 部 / 15 卷 / 96 章（`featured-1` 沿用 3 卷 60 章、其餘 12 部各 1 卷 3 章），
 * 外加 1 章草稿（`draft-1`）。字數與章節數一律由實際正文推導，不沿用 mockData 展示值。
 */

const EXPECTED_NOVELS = 13;
const EXPECTED_VOLUMES = 15;
const EXPECTED_PUBLISHED_CHAPTERS = 96;
const DRAFT_CHAPTER_ID = 'draft-1';

describe('示範資料規模（FR-011）', () => {
  it('13 部作品 / 15 卷 / 96 章已發佈章節', async () => {
    expect(await prisma.novel.count()).toBe(EXPECTED_NOVELS);
    expect(await prisma.volume.count()).toBe(EXPECTED_VOLUMES);
    expect(await prisma.chapter.count({ where: { status: 'published' } })).toBe(
      EXPECTED_PUBLISHED_CHAPTERS
    );
  });

  it('每一部作品都有 ≥1 章可讀，且每章都有正文列', async () => {
    const novels = await prisma.novel.findMany({
      select: {
        id: true,
        chapters: {
          where: { status: 'published' },
          select: { id: true, content: { select: { chapterId: true } } },
        },
      },
    });

    expect(novels).toHaveLength(EXPECTED_NOVELS);
    for (const novel of novels) {
      expect(novel.chapters.length).toBeGreaterThan(0);
      for (const chapter of novel.chapters) {
        expect(chapter.content, `${novel.id} 的章節 ${chapter.id} 缺少正文列`).not.toBeNull();
      }
    }
  });
});

describe('字數與章節數由正文推導（FR-011a）', () => {
  it('每部 Novel.wordCount 等於其已發佈章節 wordCount 加總、chapterCount 等於實際章節數', async () => {
    const novels = await prisma.novel.findMany({
      select: {
        id: true,
        wordCount: true,
        chapterCount: true,
        chapters: { where: { status: 'published' }, select: { wordCount: true } },
      },
    });

    for (const novel of novels) {
      const sum = novel.chapters.reduce((acc, c) => acc + c.wordCount, 0);
      expect(novel.wordCount, `${novel.id} 的 wordCount 與章節加總不符`).toBe(sum);
      expect(novel.chapterCount, `${novel.id} 的 chapterCount 與實際章節數不符`).toBe(
        novel.chapters.length
      );
    }
  });

  it('每章的 wordCount 等於其正文去空白後的字元數', async () => {
    const chapters = await prisma.chapter.findMany({
      where: { status: 'published' },
      select: { id: true, wordCount: true, content: { select: { bodyMarkdown: true } } },
    });

    for (const chapter of chapters) {
      const expected = (chapter.content?.bodyMarkdown ?? '').replace(/\s/g, '').length;
      expect(chapter.wordCount, `${chapter.id} 的 wordCount 與正文字數不符`).toBe(expected);
    }
  });
});

describe('草稿資料（FR-012a）', () => {
  it('存在 id 為 draft-1 的草稿章節，且附有正文', async () => {
    const draft = await prisma.chapter.findUnique({
      where: { id: DRAFT_CHAPTER_ID },
      select: { status: true, publishedAt: true, content: { select: { bodyMarkdown: true } } },
    });

    expect(draft).not.toBeNull();
    expect(draft!.status).toBe('draft');
    expect(draft!.publishedAt).toBeNull();
    expect(draft!.content?.bodyMarkdown.length ?? 0).toBeGreaterThan(0);
  });
});
