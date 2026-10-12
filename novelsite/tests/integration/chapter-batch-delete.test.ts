import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/db';
import {
  createAuthor,
  createReader,
  addVolume,
  cleanupAuthoring,
  anyCategoryId,
  TEST_PREFIX,
  type TestAuthor,
} from '../helpers/authoring';

/**
 * FEAT-8 US2：一次刪除選取的章節（T030–T033）
 * =============================================
 * **受測層級**（tasks.md 開頭的判準）：本檔全部斷言的都是**資料庫效果**
 * （級聯範圍、章號、計數、全有全無），故一律**服務層直呼**。
 * 結構化紀錄與授權出口打 Action 端點，那些在 `chapter-batch-guard.test.ts`。
 *
 * **T030 的兩個反面斷言（續讀進度與閱讀歷史仍在）現在恆真** ——
 * 三張讀者側資料表刻意都不設 `Chapter` 關聯。正因為它「不做就會過」，
 * 沒有這一案的話，哪天有人「順手補上關聯」時，讀者的續讀位置會**無聲**消失。
 */

/**
 * `refreshNovelCounters`／`touchNovel` 的呼叫計數與交易內的失敗注入。
 * 手法與理由同 `chapter-batch-publish.test.ts`：那兩支是冪等重算，
 * 跑 1 次與 N 次的資料結果完全相同，沒有副作用可供斷言；
 * 而「交易內的必然失敗」只有在 commit 之前擲錯才驗得到交易邊界。
 */
const hooks = vi.hoisted(() => ({ refreshCalls: 0, touchCalls: 0, failTouch: false }));

vi.mock('@/lib/repositories', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/repositories')>();
  return {
    ...actual,
    refreshNovelCounters: async (...args: Parameters<typeof actual.refreshNovelCounters>) => {
      hooks.refreshCalls += 1;
      return actual.refreshNovelCounters(...args);
    },
    touchNovel: async (...args: Parameters<typeof actual.touchNovel>) => {
      hooks.touchCalls += 1;
      if (hooks.failTouch) throw new Error('T032：交易內注入的失敗');
      return actual.touchNovel(...args);
    },
  };
});

// `vi.mock` 由轉譯器提升至全部 import 之前，故受測模組拿到的是上面那份包裝
import { deleteChapters } from '@/lib/services/chapterBatchService';

let author: TestAuthor;
let reader: TestAuthor;
let novelId: string;

let seq = 0;

/** 建立 n 章。**測試自己的前置資料，經 Prisma 直接建置**（同 `helpers/authoring.ts` 的判準） */
async function makeChapters(
  volumeId: string,
  specs: { status?: 'draft' | 'published'; wordCount?: number }[]
): Promise<{ id: string; number: number }[]> {
  const rows = specs.map((spec) => {
    seq += 1;
    return {
      id: `${TEST_PREFIX}bd-${Date.now().toString(36)}-${seq}`,
      novelId,
      volumeId,
      number: seq,
      title: `批次第 ${seq} 章`,
      wordCount: spec.wordCount ?? 10,
      status: spec.status ?? 'draft',
      publishedAt: spec.status === 'published' ? new Date() : null,
      scheduledAt: null,
    };
  });
  // 1000 章的上界案例會撞上 SQLite 的 bind 參數上限，故分批寫入（純前置資料，與受測路徑無關）
  for (let i = 0; i < rows.length; i += 200) {
    await prisma.chapter.createMany({ data: rows.slice(i, i + 200) });
  }
  return rows.map((r) => ({ id: r.id, number: r.number }));
}

async function newVolume(): Promise<string> {
  seq += 1;
  return addVolume(novelId, seq);
}

async function novelCounters(): Promise<{ chapterCount: number; wordCount: number }> {
  return prisma.novel.findUniqueOrThrow({
    where: { id: novelId },
    select: { chapterCount: true, wordCount: true },
  });
}

/** 依實際已發佈章節重算的期望值（期望值的獨立來源，不看服務層算出什麼） */
async function expectedCounters(): Promise<{ chapterCount: number; wordCount: number }> {
  const rows = await prisma.chapter.findMany({
    where: { novelId, status: 'published' },
    select: { wordCount: true },
  });
  return {
    chapterCount: rows.length,
    wordCount: rows.reduce((sum, r) => sum + r.wordCount, 0),
  };
}

beforeAll(async () => {
  await cleanupAuthoring();
  author = await createAuthor('batch-delete');
  reader = await createReader('batch-delete-reader');

  novelId = `${TEST_PREFIX}novel-batch-delete`;
  await prisma.novel.create({
    data: {
      id: novelId,
      title: '批次刪除測試作品',
      authorId: author.id,
      coverColor: 'linear-gradient(135deg, #1a0533 0%, #4a1942 40%, #8b2fc9 100%)',
      categoryId: await anyCategoryId(),
      wordCount: 0,
      chapterCount: 0,
      rating: 0,
      excerpt: '整合測試用的作品簡介。',
      status: 'published',
    },
  });
}, 120_000);

afterAll(async () => {
  await cleanupAuthoring();
});

// ─────────────────────────────────────────
// T030：級聯範圍（FR-019）
// ─────────────────────────────────────────

describe('T030：正文與留言隨章節消失，讀者的續讀進度與閱讀歷史仍在（FR-019）', () => {
  let chapters: { id: string; number: number }[];

  beforeAll(async () => {
    const volumeId = await newVolume();
    chapters = await makeChapters(volumeId, [{ status: 'published' }, { status: 'published' }]);

    for (const chapter of chapters) {
      await prisma.chapterContent.create({
        data: { chapterId: chapter.id, bodyMarkdown: `第 ${chapter.number} 章的正文。` },
      });
      await prisma.comment.create({
        data: { chapterId: chapter.id, userId: reader.id, content: '讀者留言。' },
      });
    }

    // 續讀點與閱讀歷史都指向即將被刪的第一章 —— 連坐刪除的實作在此變紅
    await prisma.readingProgress.create({
      data: { userId: reader.id, novelId, chapterId: chapters[0].id, percent: 42 },
    });
    await prisma.readingHistory.create({
      data: { userId: reader.id, novelId, chapterId: chapters[0].id },
    });

    await deleteChapters(author.id, { volumeId, chapterIds: chapters.map((c) => c.id) });
  }, 60_000);

  it('章節本體與正文、留言皆已移除（由既有級聯處理）', async () => {
    const ids = chapters.map((c) => c.id);
    expect(await prisma.chapter.count({ where: { id: { in: ids } } })).toBe(0);
    expect(await prisma.chapterContent.count({ where: { chapterId: { in: ids } } })).toBe(0);
    expect(await prisma.comment.count({ where: { chapterId: { in: ids } } })).toBe(0);
  });

  it('讀者的續讀位置仍在，且仍指向已消失的那一章（MUST NOT 連坐刪除）', async () => {
    const row = await prisma.readingProgress.findUniqueOrThrow({
      where: { userId_novelId: { userId: reader.id, novelId } },
      select: { chapterId: true, percent: true },
    });
    expect(row.chapterId).toBe(chapters[0].id);
    expect(row.percent).toBe(42);
  });

  it('讀者的閱讀歷史仍在', async () => {
    expect(await prisma.readingHistory.count({ where: { userId: reader.id, novelId } })).toBe(1);
  });
});

// ─────────────────────────────────────────
// T031：章號不自動補正（FR-020）
// ─────────────────────────────────────────

describe('T031：刪除後剩餘章號未被自動補號（FR-020）', () => {
  it('刪除連續 6 章中的第 3、4 章 → 剩餘章號為原本的第 1、2、5、6 個值', async () => {
    const volumeId = await newVolume();
    const chapters = await makeChapters(
      volumeId,
      Array.from({ length: 6 }, () => ({}))
    );
    const numbers = chapters.map((c) => c.number);

    await deleteChapters(author.id, {
      volumeId,
      chapterIds: [chapters[2].id, chapters[3].id],
    });

    const remaining = await prisma.chapter.findMany({
      where: { volumeId },
      orderBy: { number: 'asc' },
      select: { number: true },
    });
    // 自動補號的實作會把這裡變成連號的四個值 —— 而讀者已知的章號會整批位移
    expect(remaining.map((r) => r.number)).toEqual([
      numbers[0],
      numbers[1],
      numbers[4],
      numbers[5],
    ]);
  }, 60_000);
});

// ─────────────────────────────────────────
// T031a：計數重算的**成功路徑**（FR-024）
// ─────────────────────────────────────────

describe('T031a：計數重算與 touch 各只呼叫一次（FR-024）', () => {
  it('作品計數等於依剩餘已發佈章節重算的值、updatedAt 前進，兩支函式各呼叫一次', async () => {
    // `before` MUST 早於建立前置資料 —— 緊接在刪除之前讀，兩者可能落在同一毫秒
    const before = await prisma.novel.findUniqueOrThrow({
      where: { id: novelId },
      select: { updatedAt: true },
    });

    const volumeId = await newVolume();
    const chapters = await makeChapters(volumeId, [
      { status: 'published', wordCount: 7 },
      { status: 'published', wordCount: 7 },
      { status: 'published', wordCount: 7 },
      { status: 'draft', wordCount: 7 },
    ]);

    hooks.refreshCalls = 0;
    hooks.touchCalls = 0;

    await deleteChapters(author.id, {
      volumeId,
      chapterIds: [chapters[0].id, chapters[1].id],
    });

    expect(await novelCounters()).toEqual(await expectedCounters());

    const after = await prisma.novel.findUniqueOrThrow({
      where: { id: novelId },
      select: { updatedAt: true },
    });
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());

    // 每章一次的實作會讓這裡變成 2 —— 資料上看不出差別，成本差 2 倍
    expect(hooks.refreshCalls).toBe(1);
    expect(hooks.touchCalls).toBe(1);
  }, 60_000);
});

// ─────────────────────────────────────────
// T032：全有全無（FR-018）
// ─────────────────────────────────────────

describe('T032：交易內失敗 → 100% 回到刪除前（FR-018）', () => {
  it('章節列數、各章狀態與作品計數皆與刪除前相同', async () => {
    const volumeId = await newVolume();
    const chapters = await makeChapters(volumeId, [
      { status: 'published' },
      { status: 'published' },
      { status: 'draft' },
    ]);
    const ids = chapters.map((c) => c.id);

    const snapshot = JSON.stringify(
      await prisma.chapter.findMany({
        where: { volumeId },
        orderBy: { id: 'asc' },
        select: { id: true, number: true, status: true },
      })
    );
    const countersBefore = await novelCounters();

    hooks.failTouch = true;
    try {
      await expect(deleteChapters(author.id, { volumeId, chapterIds: ids })).rejects.toThrow();
    } finally {
      hooks.failTouch = false;
    }

    const after = JSON.stringify(
      await prisma.chapter.findMany({
        where: { volumeId },
        orderBy: { id: 'asc' },
        select: { id: true, number: true, status: true },
      })
    );
    expect(after).toBe(snapshot);
    expect(await novelCounters()).toEqual(countersBefore);
  }, 60_000);
});

// ─────────────────────────────────────────
// T033：效能與上界（SC-005；**MUST NOT 標為待外部條件**）
// ─────────────────────────────────────────

describe('T033：批量與效能（SC-005）', () => {
  it('100 章的批次刪除在 5 秒內完成', async () => {
    const volumeId = await newVolume();
    const chapters = await makeChapters(
      volumeId,
      Array.from({ length: 100 }, () => ({ status: 'published' as const }))
    );

    const startedAt = Date.now();
    const result = await deleteChapters(author.id, {
      volumeId,
      chapterIds: chapters.map((c) => c.id),
    });
    const elapsed = Date.now() - startedAt;

    expect(result.deleted).toBe(100);
    // 上界不逾時**不蘊含**常用量級夠快 —— SC-005 的門檻就是這一條
    expect(elapsed, `100 章耗時 ${elapsed}ms，超過 SC-005 的 5 秒門檻`).toBeLessThan(5000);
  }, 120_000);

  it('1000 章的上界（含正文與留言的級聯）在交易 timeout 內完成', async () => {
    const volumeId = await newVolume();
    const chapters = await makeChapters(
      volumeId,
      Array.from({ length: 1000 }, () => ({ status: 'published' as const }))
    );
    // 級聯才是這一段最重的部分，故上界案例 MUST 帶著正文一起刪
    for (let i = 0; i < chapters.length; i += 200) {
      await prisma.chapterContent.createMany({
        data: chapters.slice(i, i + 200).map((c) => ({
          chapterId: c.id,
          bodyMarkdown: `第 ${c.number} 章的正文。`,
        })),
      });
    }

    const result = await deleteChapters(author.id, {
      volumeId,
      chapterIds: chapters.map((c) => c.id),
    });

    expect(result.deleted).toBe(1000);
    expect(await prisma.chapter.count({ where: { volumeId } })).toBe(0);
    expect(
      await prisma.chapterContent.count({
        where: { chapterId: { in: chapters.slice(0, 100).map((c) => c.id) } },
      })
    ).toBe(0);
  }, 300_000);
});
