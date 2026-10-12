import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { loginAs } from '../helpers/client';
import { callAction } from '../helpers/serverAction';
import { waitForBatchLogs } from '../helpers/serverLog';
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
 * FEAT-8 US1：一次發佈整卷草稿章節（T020–T024a）
 * ================================================
 * **本檔最重要的一條是 T020：N 章 → 一則通知。**
 * 逐章呼叫 `publishChapter` 湊批次的錯誤實作**不會產生任何型別錯誤**，
 * 也會通過本檔其餘每一條斷言 —— 唯一的症狀是每位收藏者收到 N 則通知，
 * 而那是寄出去就收不回來的東西。
 *
 * **受測層級**（tasks.md 開頭的判準）：
 *
 * | 斷言的東西 | 層級 | 本檔的案 |
 * |---|---|---|
 * | 資料庫效果、通知則數、計數重算、全有全無 | **服務層直呼** | T020–T022、T024、T024a |
 * | 結構化紀錄的 `result` | **Action 端點**（`callAction`） | T023 |
 *
 * T023 打端點而非服務層，是因為 `logBatchEvent` 落在 Action 層 ——
 * 服務層直呼**永遠看不到那一行**，寫在這裡就等於沒驗到紀錄。
 *
 * 本檔專屬位址前綴：`10.130.*`
 */

/**
 * `refreshNovelCounters`／`touchNovel` 的呼叫計數與交易內的失敗注入。
 *
 * **為何要包一層而不是斷言副作用**：T021a 要的是「**各只被呼叫一次**，不是每章一次」——
 * 那兩支都是冪等的重算，跑 1 次與跑 N 次的**結果完全相同**，
 * 差別只在 N 倍的成本，沒有任何資料上的痕跡可供斷言。
 *
 * `failTouch` 供 T024a 在**交易內**製造一個必然失敗的項目：
 * 兩次條件更新已經跑完、commit 之前擲錯，正是「全有全無」唯一該被驗證的那一瞬間。
 * 由外部（跨卷章節）製造的失敗全部發生在交易**之前**，證明不了交易邊界。
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
      if (hooks.failTouch) throw new Error('T024a：交易內注入的失敗');
      return actual.touchNovel(...args);
    },
  };
});

// `vi.mock` 由轉譯器提升至全部 import 之前，故受測模組拿到的是上面那份包裝
import { publishChapters } from '@/lib/services/chapterBatchService';
import { publishDueScheduled } from '@/lib/services/chapterService';

const IP = '10.130.1.1';

let author: TestAuthor;
let novelId: string;
const followerIds: string[] = [];

let seq = 0;

/** 建立 n 章草稿。**測試自己的前置資料，經 Prisma 直接建置**（同 `helpers/authoring.ts` 的判準） */
async function makeChapters(
  volumeId: string,
  specs: { status?: 'draft' | 'published'; wordCount?: number; publishedAt?: Date | null }[]
): Promise<{ id: string; number: number }[]> {
  const rows = specs.map((spec) => {
    seq += 1;
    return {
      id: `${TEST_PREFIX}bp-${Date.now().toString(36)}-${seq}`,
      novelId,
      volumeId,
      number: seq,
      title: `批次第 ${seq} 章`,
      wordCount: spec.wordCount ?? 10,
      status: spec.status ?? 'draft',
      publishedAt: spec.publishedAt ?? (spec.status === 'published' ? new Date() : null),
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

async function notificationCount(): Promise<number> {
  return prisma.notification.count({ where: { userId: { in: followerIds } } });
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
  author = await createAuthor('batch-publish');

  novelId = `${TEST_PREFIX}novel-batch-publish`;
  await prisma.novel.create({
    data: {
      id: novelId,
      title: '批次發佈測試作品',
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

  // 兩位收藏者：「只發一則」要有一個不為 0 的期望值才有意義
  for (const label of ['batch-follower-1', 'batch-follower-2']) {
    const reader = await createReader(label);
    followerIds.push(reader.id);
    await prisma.bookshelf.create({ data: { userId: reader.id, novelId } });
  }
}, 120_000);

afterAll(async () => {
  await cleanupAuthoring();
});

// ─────────────────────────────────────────
// T020：一批一則通知（**本階段最重要的一條**）
// ─────────────────────────────────────────

describe('T020：5 章草稿一次發佈，每位收藏者恰多 1 則通知（FR-010、FR-052a）', () => {
  let volumeId: string;
  let chapters: { id: string; number: number }[];

  beforeAll(async () => {
    await prisma.notification.deleteMany({ where: { userId: { in: followerIds } } });
    volumeId = await newVolume();
    chapters = await makeChapters(
      volumeId,
      Array.from({ length: 5 }, () => ({}))
    );

    await publishChapters(author.id, { volumeId, chapterIds: chapters.map((c) => c.id) });
  }, 60_000);

  it('5 章全部轉為已發佈', async () => {
    const rows = await prisma.chapter.findMany({
      where: { id: { in: chapters.map((c) => c.id) } },
      select: { status: true },
    });
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.status === 'published')).toBe(true);
  });

  it('每位收藏者恰多 1 則通知（**不是 5 則** —— 逐章呼叫的實作在此變紅）', async () => {
    expect(await notificationCount()).toBe(followerIds.length);
    for (const userId of followerIds) {
      expect(await prisma.notification.count({ where: { userId } })).toBe(1);
    }
  });

  it('該則通知的章節數為 5，且指向章號最大者', async () => {
    const row = await prisma.notification.findFirstOrThrow({
      where: { userId: followerIds[0] },
      select: { type: true, payload: true },
    });
    expect(row.type).toBe('chapter_published');

    const payload = JSON.parse(row.payload) as { chapterCount: number; latestChapterId: string };
    expect(payload.chapterCount).toBe(5);

    const highest = chapters.reduce((max, c) => (c.number > max.number ? c : max), chapters[0]);
    expect(payload.latestChapterId).toBe(highest.id);
  });
});

// ─────────────────────────────────────────
// T021：略過已發佈者
// ─────────────────────────────────────────

describe('T021：選取中已發佈者被略過（FR-008、FR-011）', () => {
  it('5 章中 2 章已發佈 → published 3、skipped 2，通知內章節數為 3', async () => {
    await prisma.notification.deleteMany({ where: { userId: { in: followerIds } } });
    const volumeId = await newVolume();
    const chapters = await makeChapters(volumeId, [
      {},
      {},
      {},
      { status: 'published' },
      { status: 'published' },
    ]);

    const result = await publishChapters(author.id, {
      volumeId,
      chapterIds: chapters.map((c) => c.id),
    });

    expect(result.published).toBe(3);
    expect(result.skipped).toBe(2);
    expect(result.skippedNumbers).toEqual(chapters.slice(3).map((c) => c.number));
    expect(result.notified).toBe(true);

    const notification = await prisma.notification.findFirstOrThrow({
      where: { userId: followerIds[0] },
      select: { payload: true },
    });
    expect((JSON.parse(notification.payload) as { chapterCount: number }).chapterCount).toBe(3);
  });

  it('全部已發佈 → 零通知、published 為 0，且 notified 仍為 true', async () => {
    await prisma.notification.deleteMany({ where: { userId: { in: followerIds } } });
    const volumeId = await newVolume();
    const chapters = await makeChapters(volumeId, [
      { status: 'published' },
      { status: 'published' },
    ]);

    const result = await publishChapters(author.id, {
      volumeId,
      chapterIds: chapters.map((c) => c.id),
    });

    expect(result.published).toBe(0);
    expect(result.skipped).toBe(2);
    // 沒有要送的通知，就沒有「未送出」可言 —— 定為 false 會讓摘要對著
    // 一個根本不該有通知的情形顯示「追更通知未送出」
    expect(result.notified).toBe(true);
    expect(await notificationCount()).toBe(0);
  });
});

// ─────────────────────────────────────────
// T021a：計數重算的**成功路徑**（FR-024）
// ─────────────────────────────────────────

describe('T021a：計數重算與 touch 各只呼叫一次（FR-024）', () => {
  it('作品計數等於依實際已發佈章節重算的值、updatedAt 前進，兩支函式各呼叫一次', async () => {
    const volumeId = await newVolume();
    const chapters = await makeChapters(
      volumeId,
      Array.from({ length: 5 }, () => ({ wordCount: 7 }))
    );

    const before = await prisma.novel.findUniqueOrThrow({
      where: { id: novelId },
      select: { updatedAt: true },
    });
    hooks.refreshCalls = 0;
    hooks.touchCalls = 0;

    await publishChapters(author.id, { volumeId, chapterIds: chapters.map((c) => c.id) });

    expect(await novelCounters()).toEqual(await expectedCounters());

    const after = await prisma.novel.findUniqueOrThrow({
      where: { id: novelId },
      select: { updatedAt: true },
    });
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());

    // 每章一次的實作會讓這裡變成 5 —— 資料上看不出差別，成本差 5 倍
    expect(hooks.refreshCalls).toBe(1);
    expect(hooks.touchCalls).toBe(1);
  }, 60_000);
});

// ─────────────────────────────────────────
// T022：publishedAt 的「首發才寫」與 scheduledAt 清空
// ─────────────────────────────────────────

describe('T022：上架日期與排程欄（FR-012、FR-013）', () => {
  it('曾發佈→下架→批次重發者保留原 publishedAt；首次發佈者寫入本次時刻', async () => {
    const volumeId = await newVolume();
    const originalDate = new Date('2026-01-15T03:00:00.000Z');
    const [republished, firstTime] = await makeChapters(volumeId, [
      // 下架後的樣子：狀態回到 draft，但上架日期還在
      { status: 'draft', publishedAt: originalDate },
      { status: 'draft', publishedAt: null },
    ]);

    const startedAt = new Date();
    await publishChapters(author.id, { volumeId, chapterIds: [republished.id, firstTime.id] });

    const rows = await prisma.chapter.findMany({
      where: { id: { in: [republished.id, firstTime.id] } },
      select: { id: true, status: true, publishedAt: true },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));

    expect(byId.get(republished.id)!.status).toBe('published');
    // 讀者看到的章節日期 MUST NOT 因為作者臨時下架又上架而跳到今天
    expect(byId.get(republished.id)!.publishedAt?.toISOString()).toBe(originalDate.toISOString());

    expect(byId.get(firstTime.id)!.publishedAt).not.toBeNull();
    expect(byId.get(firstTime.id)!.publishedAt!.getTime()).toBeGreaterThanOrEqual(
      startedAt.getTime() - 1000
    );
  }, 60_000);

  it('原本已排程者發佈後 scheduledAt 為 null，再跑一次排程掃描不產生第二則通知', async () => {
    await prisma.notification.deleteMany({ where: { userId: { in: followerIds } } });
    const volumeId = await newVolume();
    const [scheduled] = await makeChapters(volumeId, [{}]);
    // 到期的排程：不清空的話，下一次掃描會再選中同一章並再發一次通知
    await prisma.chapter.update({
      where: { id: scheduled.id },
      data: { scheduledAt: new Date(Date.now() - 60_000) },
    });

    await publishChapters(author.id, { volumeId, chapterIds: [scheduled.id] });

    const row = await prisma.chapter.findUniqueOrThrow({
      where: { id: scheduled.id },
      select: { scheduledAt: true, status: true },
    });
    expect(row.status).toBe('published');
    expect(row.scheduledAt).toBeNull();

    const notificationsAfterBatch = await notificationCount();
    expect(notificationsAfterBatch).toBe(followerIds.length);

    const due = await publishDueScheduled(new Date());
    expect(due.chaptersPublished).toBe(0);
    expect(await notificationCount()).toBe(notificationsAfterBatch);
  }, 60_000);
});

// ─────────────────────────────────────────
// T023：通知失敗（**Action 端點** ＋ 結構化紀錄）
// ─────────────────────────────────────────

describe('T023：通知建立失敗不影響發佈結果（FR-010b）', () => {
  let volumeId: string;
  let chapters: { id: string; number: number }[];
  let responseText: string;

  /**
   * **注入方式**：暫時把 `Notification` 資料表改名，使 `createNotifications` 的
   * INSERT 在**伺服器行程內**失敗。兩軌皆支援 `ALTER TABLE ... RENAME TO`，
   * 且**完全不動產品程式**——為了測試在服務層開一個假失敗的旗標，
   * 測到的就不是要交付的那條路徑。改名於 `finally` 內還原。
   *
   * **MUST 打 Action 端點**：本案要斷言的 `result: 'notify_failed'` 由
   * `logBatchEvent` 寫在 Action 層，服務層直呼看不到那一行。
   */
  beforeAll(async () => {
    volumeId = await newVolume();
    chapters = await makeChapters(volumeId, [{}, {}]);
    const cookie = await loginAs(author.email, author.password, IP);

    await prisma.$executeRawUnsafe('ALTER TABLE "Notification" RENAME TO "Notification_t023"');
    try {
      const res = await callAction(
        'publishChaptersAction',
        [{ volumeId, chapterIds: chapters.map((c) => c.id) }],
        { ip: IP, cookie, route: `/author/novels/${novelId}` }
      );
      responseText = res.text;
    } finally {
      await prisma.$executeRawUnsafe('ALTER TABLE "Notification_t023" RENAME TO "Notification"');
    }
  }, 60_000);

  it('章節仍為已發佈（通知失敗 MUST NOT 讓整批失敗）', async () => {
    const rows = await prisma.chapter.findMany({
      where: { id: { in: chapters.map((c) => c.id) } },
      select: { status: true },
    });
    expect(rows.every((r) => r.status === 'published')).toBe(true);
  });

  it('回傳 notified 為 false（作者必須知道通知沒出去）', () => {
    expect(responseText).toContain('"notified"');
    expect(responseText).toMatch(/"notified"\s*:\s*false/);
  });

  it('紀錄的 result 為 notify_failed（不是 ok、也不是 internal_error）', async () => {
    const records = await waitForBatchLogs({ volumeId }, 1);
    expect(records).toHaveLength(1);
    expect(records[0].result).toBe('notify_failed');
    expect(records[0].operation).toBe('publish');
    expect(records[0].actorId).toBe(author.id);
    expect(records[0].novelId).toBe(novelId);
    expect(records[0].chapterCount).toBe(2);
  });
});

// ─────────────────────────────────────────
// T024a：發佈側的全有全無（FR-009／SC-003）
// ─────────────────────────────────────────

describe('T024a：交易內失敗 → 100% 回到操作前（FR-009）', () => {
  it('各章 status／publishedAt／scheduledAt 與作品計數皆未變，且零通知', async () => {
    await prisma.notification.deleteMany({ where: { userId: { in: followerIds } } });
    const volumeId = await newVolume();
    const chapters = await makeChapters(volumeId, [{}, {}, {}]);
    const ids = chapters.map((c) => c.id);

    const snapshot = JSON.stringify(
      await prisma.chapter.findMany({
        where: { id: { in: ids } },
        orderBy: { id: 'asc' },
        select: { id: true, status: true, publishedAt: true, scheduledAt: true },
      })
    );
    const countersBefore = await novelCounters();

    hooks.failTouch = true;
    try {
      await expect(publishChapters(author.id, { volumeId, chapterIds: ids })).rejects.toThrow();
    } finally {
      hooks.failTouch = false;
    }

    const after = JSON.stringify(
      await prisma.chapter.findMany({
        where: { id: { in: ids } },
        orderBy: { id: 'asc' },
        select: { id: true, status: true, publishedAt: true, scheduledAt: true },
      })
    );
    expect(after).toBe(snapshot);
    expect(await novelCounters()).toEqual(countersBefore);
    expect(await notificationCount()).toBe(0);
  }, 60_000);
});

// ─────────────────────────────────────────
// T024：效能與上界（SC-005；**MUST NOT 標為待外部條件**）
// ─────────────────────────────────────────

describe('T024：批量與效能（SC-005）', () => {
  it('100 章的批次發佈在 5 秒內完成', async () => {
    const volumeId = await newVolume();
    const chapters = await makeChapters(
      volumeId,
      Array.from({ length: 100 }, () => ({}))
    );

    const startedAt = Date.now();
    const result = await publishChapters(author.id, {
      volumeId,
      chapterIds: chapters.map((c) => c.id),
    });
    const elapsed = Date.now() - startedAt;

    expect(result.published).toBe(100);
    // 上界不逾時**不蘊含**常用量級夠快 —— SC-005 的門檻就是這一條
    expect(elapsed, `100 章耗時 ${elapsed}ms，超過 SC-005 的 5 秒門檻`).toBeLessThan(5000);
  }, 120_000);

  it('1000 章的上界在交易 timeout 內完成，且只產生一則通知', async () => {
    await prisma.notification.deleteMany({ where: { userId: { in: followerIds } } });
    const volumeId = await newVolume();
    const chapters = await makeChapters(
      volumeId,
      Array.from({ length: 1000 }, () => ({}))
    );

    const result = await publishChapters(author.id, {
      volumeId,
      chapterIds: chapters.map((c) => c.id),
    });

    expect(result.published).toBe(1000);
    expect(result.notified).toBe(true);
    expect(await notificationCount()).toBe(followerIds.length);
  }, 300_000);
});
