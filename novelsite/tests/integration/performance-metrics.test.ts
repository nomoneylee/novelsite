import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { getNovelPerformance } from '@/lib/services/statsService';
import { resetAuthTables } from '../helpers/resetAuthTables';
import { createAccount, createPublishedNovel } from '../helpers/fixtures';
import { deleteNovelOwned } from '@/lib/repositories';

/**
 * T090：作品成效總覽的四項指標（FR-042a、data-model.md §7.2）
 * ==========================================================
 * 四項指標裡有兩項是**比率**，而比率的分母是「近 7 日不重複讀者數」。
 * 這一句話決定了整個實作：分母有讀者身分維度，`NovelDailyStat` 沒有 ——
 * 它只有計數。改讀每日統計、把七天的數字相加，分母的語意會從「人」滑成「人日」，
 * 同一位每天都來的讀者被算成七位，完讀率因而被壓到七分之一。
 * 數字仍然會顯示、頁面仍然不會報錯，只是全都是錯的。
 *
 * 因此本檔的核心不是「算得對不對」，而是**「有沒有走對取數路徑」**：
 * 期間內明細被清空、每日統計卻留著非零數字時，指標 MUST 為「尚無資料」而非那個非零值。
 * 那是唯一能把「直接查明細」與「回退讀每日統計」區分開來的情境，
 * 也正是作品長期無人閱讀時的真實樣貌。
 *
 * **分母為 0 時回 `null` 而非 0**：0% 是一個斷言（「來的人都沒讀完」），
 * 而事實是「沒有人來過」，兩者對作者的意義完全相反。型別上把它做成 `null`，
 * UI 才有辦法分辨（FR-043 的「尚無資料」）。
 */

const DAY_MS = 24 * 3_600_000;
const TAIPEI_OFFSET_MS = 8 * 3_600_000;

/** 與 taipeiDay.ts 相同的固定偏移算術，於本檔獨立實作（理由見 rollup-idempotent.test.ts 檔首） */
function taipeiDayStartOf(at: Date): Date {
  return new Date(
    Math.floor((at.getTime() + TAIPEI_OFFSET_MS) / DAY_MS) * DAY_MS - TAIPEI_OFFSET_MS
  );
}

/** 契約規定的期間：`[taipeiDayStart(now − 6 日), now]`（近 7 日） */
function periodStart(): Date {
  return taipeiDayStartOf(new Date(Date.now() - 6 * DAY_MS));
}

/** 期間內一個安全的時刻（起點之後一小時） */
function insidePeriod(): Date {
  return new Date(periodStart().getTime() + 3_600_000);
}

/** 期間之外的時刻（8 日前的正午，明確早於起點） */
function outsidePeriod(): Date {
  return new Date(taipeiDayStartOf(new Date(Date.now() - 8 * DAY_MS)).getTime() + 12 * 3_600_000);
}

function hash(label: string): string {
  return label.padEnd(64, '0');
}

let author: { id: string };
let outsider: { id: string };
let reader: { id: string };
let reader2: { id: string };

/** 主案例作品：有完整的四項資料 */
let mainNovelId: string;
let mainChapterIds: string[];
/** 零分母作品：完全沒有閱讀明細 */
let emptyNovelId: string;
/** 已清理作品：期間內無明細，但每日統計留著非零數字 */
let purgedNovelId: string;
let purgedChapterIds: string[];

async function addView(
  novelId: string,
  chapterId: string,
  viewerHash: string,
  viewedAt: Date
): Promise<void> {
  await prisma.chapterView.create({ data: { novelId, chapterId, viewerHash, viewedAt } });
}

beforeAll(async () => {
  await resetAuthTables();
  await prisma.novelDailyStat.deleteMany();
  await prisma.chapterView.deleteMany();
  await prisma.bookshelfEvent.deleteMany();

  author = await createAccount('perf-author', 'author');
  outsider = await createAccount('perf-outsider', 'author');
  reader = await createAccount('perf-reader');
  reader2 = await createAccount('perf-reader-2');

  const main = await createPublishedNovel({ authorId: author.id, chapterCount: 3 });
  mainNovelId = main.novelId;
  mainChapterIds = main.chapterIds;

  emptyNovelId = (await createPublishedNovel({ authorId: author.id, chapterCount: 1 })).novelId;

  const purged = await createPublishedNovel({ authorId: author.id, chapterCount: 2 });
  purgedNovelId = purged.novelId;
  purgedChapterIds = purged.chapterIds;

  const last = mainChapterIds[mainChapterIds.length - 1]; // 最新已發佈章節＝完讀的判準
  const at = insidePeriod();

  // ── 期間內：三位不重複讀者、共 6 筆曝光，其中 2 位讀到最新章節 ──
  await addView(mainNovelId, mainChapterIds[0], hash('viewer-1'), at);
  await addView(mainNovelId, mainChapterIds[1], hash('viewer-1'), at);
  await addView(mainNovelId, last, hash('viewer-1'), at);
  await addView(mainNovelId, mainChapterIds[0], hash('viewer-2'), at);
  await addView(mainNovelId, last, hash('viewer-2'), at);
  await addView(mainNovelId, mainChapterIds[0], hash('viewer-3'), at);

  // ── 期間外：一位只在 8 日前來過的讀者，四項皆 MUST NOT 計入 ──
  await addView(mainNovelId, last, hash('viewer-old'), outsidePeriod());

  // ── 收藏事件：期間內 +1、+1、−1；期間外 +1 ──
  await prisma.bookshelfEvent.createMany({
    data: [
      { userId: reader.id, novelId: mainNovelId, delta: 1, createdAt: at },
      { userId: reader2.id, novelId: mainNovelId, delta: 1, createdAt: at },
      { userId: reader.id, novelId: mainNovelId, delta: -1, createdAt: at },
      { userId: reader.id, novelId: mainNovelId, delta: 1, createdAt: outsidePeriod() },
    ],
  });

  // ── 留言熱度：期間內可見留言 1 ＋ 可見評論 1；隱藏與期間外者不計 ──
  await prisma.comment.create({
    data: {
      chapterId: mainChapterIds[0],
      userId: reader.id,
      content: 'T090 期間內的可見留言',
      status: 'visible',
      createdAt: at,
    },
  });
  await prisma.comment.create({
    data: {
      chapterId: mainChapterIds[0],
      userId: reader2.id,
      content: 'T090 期間內的隱藏留言',
      status: 'hidden',
      createdAt: at,
    },
  });
  await prisma.comment.create({
    data: {
      chapterId: mainChapterIds[0],
      userId: reader.id,
      content: 'T090 期間外的可見留言',
      status: 'visible',
      createdAt: outsidePeriod(),
    },
  });
  await prisma.review.create({
    data: {
      novelId: mainNovelId,
      userId: reader.id,
      rating: 5,
      content: 'T090 期間內的可見評論',
      status: 'visible',
      createdAt: at,
    },
  });

  // ── 已清理作品：期間內無任何明細，但每日統計留著非零 views ──
  //    回退讀每日統計的實作會在這裡回報 50 次曝光，而正確答案是 0
  await prisma.novelDailyStat.createMany({
    data: [
      {
        novelId: purgedNovelId,
        date: taipeiDayStartOf(new Date(Date.now() - 2 * DAY_MS)),
        views: 30,
        favorites: 5,
        comments: 2,
      },
      {
        novelId: purgedNovelId,
        date: taipeiDayStartOf(new Date(Date.now() - 3 * DAY_MS)),
        views: 20,
        favorites: 3,
        comments: 1,
      },
    ],
  });
});

afterAll(async () => {
  await prisma.novelDailyStat.deleteMany();
  await prisma.chapterView.deleteMany();
  await prisma.bookshelfEvent.deleteMany();
  await prisma.review.deleteMany({ where: { novelId: mainNovelId } });
  await prisma.comment.deleteMany({
    where: { chapterId: { in: [...mainChapterIds, ...purgedChapterIds] } },
  });
  for (const id of [mainNovelId, emptyNovelId, purgedNovelId]) {
    await deleteNovelOwned(author.id, id);
  }
  await resetAuthTables();
});

describe('T090-1：四項指標由 ChapterView 明細直接算出', () => {
  it('曝光為期間內明細筆數、分母為不重複 viewerHash 數', async () => {
    const m = await getNovelPerformance(author.id, mainNovelId);
    expect(m).not.toBeNull();
    expect(m!.impressions).toBe(6);
    expect(m!.distinctViewers).toBe(3);
  });

  it('完讀率＝讀過最新已發佈章節的不重複讀者 ÷ 分母', async () => {
    const m = await getNovelPerformance(author.id, mainNovelId);
    expect(m!.completionRate).toBeCloseTo(2 / 3, 5);
  });

  it('收藏轉換只計 +1 的事件（移出不折抵）÷ 分母', async () => {
    const m = await getNovelPerformance(author.id, mainNovelId);
    // 期間內事件為 +1、+1、−1；只計加入 → 2 ÷ 3
    expect(m!.favoriteConversion).toBeCloseTo(2 / 3, 5);
  });

  it('留言熱度＝期間內可見留言 ＋ 可見評論，隱藏者不計', async () => {
    const m = await getNovelPerformance(author.id, mainNovelId);
    expect(m!.commentHeat).toBe(2);
  });
});

describe('T090-2：期間固定為近 7 日', () => {
  it('回傳的期間為 7 日，起點對齊台北日界線', async () => {
    const m = await getNovelPerformance(author.id, mainNovelId);
    expect(m!.periodDays).toBe(7);
    expect(m!.periodStart.getTime()).toBe(periodStart().getTime());
    expect(m!.periodEnd.getTime()).toBeGreaterThanOrEqual(periodStart().getTime());
  });

  it('期間外的明細、收藏事件與留言一律不計入（8 日前的那一位讀者不出現在任何一項）', async () => {
    const m = await getNovelPerformance(author.id, mainNovelId);
    // 期間外另有 1 筆曝光、1 筆 +1 收藏、1 則可見留言；全部計入的話會是 7 / 4 / 3
    expect(m!.impressions).toBe(6);
    expect(m!.distinctViewers).toBe(3);
    expect(m!.commentHeat).toBe(2);
  });

  it('恰落在期間起點的明細計入，起點前一毫秒者不計入', async () => {
    const novel = await createPublishedNovel({ authorId: author.id, chapterCount: 1 });
    try {
      await addView(novel.novelId, novel.chapterIds[0], hash('edge-in'), periodStart());
      await addView(
        novel.novelId,
        novel.chapterIds[0],
        hash('edge-out'),
        new Date(periodStart().getTime() - 1)
      );

      const m = await getNovelPerformance(author.id, novel.novelId);
      expect(m!.impressions).toBe(1);
      expect(m!.distinctViewers).toBe(1);
    } finally {
      await prisma.chapterView.deleteMany({ where: { novelId: novel.novelId } });
      await deleteNovelOwned(author.id, novel.novelId);
    }
  });
});

describe('T090-3：分母為 0 時回 null 而非 0，且不擲除以零', () => {
  it('完全沒有閱讀明細的作品：兩項比率為 null，計數項為 0', async () => {
    const m = await getNovelPerformance(author.id, emptyNovelId);
    expect(m).not.toBeNull();
    expect(m!.impressions).toBe(0);
    expect(m!.distinctViewers).toBe(0);
    expect(m!.completionRate).toBeNull();
    expect(m!.favoriteConversion).toBeNull();
    expect(m!.commentHeat).toBe(0);
  });

  it('兩項比率 MUST NOT 為 0、NaN 或 Infinity（三者都會被 UI 當成真實數字顯示）', async () => {
    const m = await getNovelPerformance(author.id, emptyNovelId);
    for (const value of [m!.completionRate, m!.favoriteConversion]) {
      expect(value).toBeNull();
      expect(Number.isNaN(value as unknown as number)).toBe(false);
    }
  });
});

describe('T090-4：期間內明細已清理時 MUST NOT 回退讀 NovelDailyStat（FR-042a）', () => {
  it('每日統計有 50 次曝光、明細已空 → 曝光為 0 而非 50', async () => {
    // 前提確認：每日統計確實留著非零數字，否則本案等同上一組的零值案例
    const stats = await prisma.novelDailyStat.findMany({ where: { novelId: purgedNovelId } });
    expect(stats.reduce((acc, s) => acc + s.views, 0)).toBe(50);
    expect(await prisma.chapterView.count({ where: { novelId: purgedNovelId } })).toBe(0);

    const m = await getNovelPerformance(author.id, purgedNovelId);
    expect(m).not.toBeNull();
    expect(m!.impressions).toBe(0);
    expect(m!.distinctViewers).toBe(0);
  });

  it('四項指標皆為「尚無資料」語意：兩項比率為 null、兩項計數為 0', async () => {
    const m = await getNovelPerformance(author.id, purgedNovelId);
    expect(m!.completionRate).toBeNull();
    expect(m!.favoriteConversion).toBeNull();
    expect(m!.impressions).toBe(0);
    expect(m!.commentHeat).toBe(0);
  });
});

describe('T090-5：歸屬', () => {
  it('查詢他人的作品回 null（資料層強制帶入 authorId）', async () => {
    expect(await getNovelPerformance(outsider.id, mainNovelId)).toBeNull();
  });

  it('查詢不存在的作品回 null，MUST NOT 擲出', async () => {
    expect(await getNovelPerformance(author.id, 'no-such-novel')).toBeNull();
  });
});
