import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { testFetch } from '../helpers/client';
import { resetAuthTables } from '../helpers/resetAuthTables';
import { createAccount, createPublishedNovel } from '../helpers/fixtures';
import { deleteNovelOwned } from '@/lib/repositories';

/**
 * T088：每日彙總的冪等、當日不建列與逐日回補（FR-036b、SC-008）
 * ==============================================================
 * 「每日統計」只有在**寫下去就不再變動**時才是統計；否則它只是一份會漂的快取。
 * 三件事一起成立，這句話才為真：
 *
 *  1. **當日不建列**：今天的數字還在增加，把它彙總進去，兩次執行之間只要有人閱讀就不同 ——
 *     冪等會變成只在凍結資料的測試裡成立的空話。
 *  2. **冪等**：同一日期重複執行，逐欄差異為 0。排程重試、手動補跑都靠這條才敢按下去。
 *  3. **回補無空洞**：作業連續數日沒被觸發是常態（機器重開、排程器掛掉），
 *     下次執行 MUST 把期間內每個已結束日期都補上，而不是只算最近一日 ——
 *     少掉的那幾天不會有第二次機會被算到。
 *
 * **日界線在本檔自行以純算術計算**，不引用 `@/lib/time/taipeiDay`：
 * 那個模組正是彙總範圍的決定者，拿它算期望值等於拿被測物驗被測物
 * （它自己的邊界由 tests/unit/taipeiDay.test.ts 獨立驗證）。
 */

const DAY_MS = 24 * 3_600_000;
const TAIPEI_OFFSET_MS = 8 * 3_600_000;

/** 與 taipeiDay.ts 相同的固定偏移算術，於本檔獨立實作（見檔首說明） */
function taipeiDayStartOf(at: Date): Date {
  return new Date(
    Math.floor((at.getTime() + TAIPEI_OFFSET_MS) / DAY_MS) * DAY_MS - TAIPEI_OFFSET_MS
  );
}

/** 台北日起點往前 n 日 */
function dayStartAgo(n: number): Date {
  return new Date(taipeiDayStartOf(new Date()).getTime() - n * DAY_MS);
}

/** 該台北日的正午（穩穩落在日界之內，不受執行時刻影響） */
function noonOfDayAgo(n: number): Date {
  return new Date(dayStartAgo(n).getTime() + 12 * 3_600_000);
}

const CRON_IP = '10.88.1.1';

interface DailyRow {
  date: number;
  views: number;
  favorites: number;
  comments: number;
  id: string;
}

let author: { id: string };
let reader: { id: string };
let novelId: string;
let chapterIds: string[];

function runRollup(): Promise<Response> {
  return testFetch('/api/cron/rollup-stats', {
    method: 'POST',
    ip: CRON_IP,
    headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
  });
}

async function dailyRowsOfNovel(): Promise<DailyRow[]> {
  const rows = await prisma.novelDailyStat.findMany({
    where: { novelId },
    orderBy: { date: 'asc' },
  });
  return rows.map((r) => ({
    date: r.date.getTime(),
    views: r.views,
    favorites: r.favorites,
    comments: r.comments,
    id: r.id,
  }));
}

/** 直接寫入明細：本檔驗的是彙總，上報端點的行為由 T086／T087 負責 */
async function seedViews(daysAgo: number, count: number): Promise<void> {
  const viewedAt = noonOfDayAgo(daysAgo);
  await prisma.chapterView.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      chapterId: chapterIds[i % chapterIds.length],
      novelId,
      viewerHash: `hash-d${daysAgo}-${i}`.padEnd(64, '0'),
      viewedAt,
    })),
  });
}

async function seedBookshelfEvents(daysAgo: number, deltas: number[]): Promise<void> {
  const createdAt = noonOfDayAgo(daysAgo);
  await prisma.bookshelfEvent.createMany({
    data: deltas.map((delta) => ({ userId: reader.id, novelId, delta, createdAt })),
  });
}

beforeAll(async () => {
  await resetAuthTables();
  await prisma.novelDailyStat.deleteMany();
  await prisma.chapterView.deleteMany();
  await prisma.bookshelfEvent.deleteMany();

  author = await createAccount('rollup-author', 'author');
  reader = await createAccount('rollup-reader');
  const novel = await createPublishedNovel({ authorId: author.id, chapterCount: 2 });
  novelId = novel.novelId;
  chapterIds = novel.chapterIds;

  // 三個**已結束**的日期各有活動 —— 期間內每一日都有真實資料，
  // 「無空洞」因而是可被逐日查核的事實，而非對零值列的推測
  await seedViews(3, 2);
  await seedViews(2, 1);
  await seedViews(1, 3);
  // 今日也有閱讀：當日不建列若成立，這 4 筆 MUST NOT 出現在任何統計列裡
  await seedViews(0, 4);

  await seedBookshelfEvents(3, [1, 1]);
  await seedBookshelfEvents(2, [-1]);
  await seedBookshelfEvents(1, [1]);

  // 留言與評論各一則，落在不同日期，驗證 comments 欄同時涵蓋兩者
  await prisma.comment.create({
    data: {
      chapterId: chapterIds[0],
      userId: reader.id,
      content: 'T088 的留言，落在兩日前',
      status: 'visible',
      createdAt: noonOfDayAgo(2),
    },
  });
  await prisma.review.create({
    data: {
      novelId,
      userId: reader.id,
      rating: 4,
      content: 'T088 的評論，落在昨日',
      status: 'visible',
      createdAt: noonOfDayAgo(1),
    },
  });
});

afterAll(async () => {
  await prisma.novelDailyStat.deleteMany();
  await prisma.chapterView.deleteMany();
  await prisma.bookshelfEvent.deleteMany();
  await prisma.review.deleteMany({ where: { novelId } });
  await prisma.comment.deleteMany({ where: { chapterId: { in: chapterIds } } });
  await deleteNovelOwned(author.id, novelId);
  await resetAuthTables();
});

describe('T088-1：首次執行的回補範圍', () => {
  let firstRun: DailyRow[];

  beforeAll(async () => {
    const res = await runRollup();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.processed).toBe('number');
    expect(typeof body.durationMs).toBe('number');
    // 清理是無聲的破壞性動作，MUST 逐一回報刪除筆數（FR-057、contracts §4）
    expect(body.detail).toMatchObject({
      daysProcessed: expect.any(Number),
      novelsTouched: expect.any(Number),
      viewsPurged: expect.any(Number),
      bookshelfEventsPurged: expect.any(Number),
    });
    firstRun = await dailyRowsOfNovel();
  }, 60_000);

  it('期間內每個已結束日期皆有列、無空洞（連續三日未執行後一次補齊）', () => {
    expect(firstRun.map((r) => r.date)).toEqual([
      dayStartAgo(3).getTime(),
      dayStartAgo(2).getTime(),
      dayStartAgo(1).getTime(),
    ]);
  });

  it('尚未結束的當日 MUST NOT 產生統計列（今日有 4 筆閱讀明細仍不建列）', async () => {
    const todayStart = taipeiDayStartOf(new Date());
    expect(firstRun.some((r) => r.date >= todayStart.getTime())).toBe(false);
    // 今日的明細確實存在 —— 「沒有列」因而是刻意排除，不是沒有資料
    expect(
      await prisma.chapterView.count({ where: { novelId, viewedAt: { gte: todayStart } } })
    ).toBe(4);
  });

  it('每一日的閱讀、收藏淨增與留言數皆與明細相符', () => {
    const byDay = new Map(firstRun.map((r) => [r.date, r]));

    expect(byDay.get(dayStartAgo(3).getTime())).toMatchObject({
      views: 2,
      favorites: 2, // +1 +1
      comments: 0,
    });
    expect(byDay.get(dayStartAgo(2).getTime())).toMatchObject({
      views: 1,
      favorites: -1, // 淨增可為負：移出書架亦計入（BookshelfEvent 存在的理由）
      comments: 1, // 章節留言
    });
    expect(byDay.get(dayStartAgo(1).getTime())).toMatchObject({
      views: 3,
      favorites: 1,
      comments: 1, // 作品評論同樣計入 comments
    });
  });

  it('Novel.totalViews／weeklyViews 由每日統計回填，且不含今日（統計截止日為昨日）', async () => {
    const novel = await prisma.novel.findUniqueOrThrow({
      where: { id: novelId },
      select: { totalViews: true, weeklyViews: true },
    });
    const sum = firstRun.reduce((acc, r) => acc + r.views, 0);
    expect(sum).toBe(6);
    expect(novel.totalViews).toBe(sum);
    expect(novel.weeklyViews).toBe(sum); // 三日皆落在近 7 日內
  });
});

describe('T088-2：同一日期連續執行兩次，逐欄差異為 0（SC-008）', () => {
  let before: DailyRow[];
  let after: DailyRow[];
  let novelBefore: { totalViews: number; weeklyViews: number };
  let novelAfter: { totalViews: number; weeklyViews: number };

  beforeAll(async () => {
    before = await dailyRowsOfNovel();
    novelBefore = await prisma.novel.findUniqueOrThrow({
      where: { id: novelId },
      select: { totalViews: true, weeklyViews: true },
    });

    const res = await runRollup();
    expect(res.status).toBe(200);

    after = await dailyRowsOfNovel();
    novelAfter = await prisma.novel.findUniqueOrThrow({
      where: { id: novelId },
      select: { totalViews: true, weeklyViews: true },
    });
  }, 60_000);

  it('列數、日期與三個計數欄逐一相同', () => {
    expect(after).toEqual(before);
  });

  it('列的識別碼不變（以 upsert 覆寫，MUST NOT 刪掉重建）', () => {
    // 刪掉重建會讓外部引用（例如圖表的快取鍵）在每次彙總後全部失效，
    // 且中間的空窗期讀者會看到殘缺的統計
    expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id));
  });

  it('回填到 Novel 的兩個累計欄同樣不變（回填本身亦為冪等，非累加）', () => {
    expect(novelAfter).toEqual(novelBefore);
  });

  it('第二次執行後當日仍無統計列', async () => {
    const todayStart = taipeiDayStartOf(new Date()).getTime();
    expect(after.some((r) => r.date >= todayStart)).toBe(false);
  });
});
