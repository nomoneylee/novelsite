import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { testFetch } from '../helpers/client';
import { resetAuthTables } from '../helpers/resetAuthTables';
import { createAccount, createPublishedNovel, cleanupNovels } from '../helpers/fixtures';

/**
 * T114：排行重算的名次、計分與升降標記（SC-009、FR-045、FR-048）
 * ================================================================
 * 排行榜是本站唯一「由統計推導、讀者卻當成事實在看」的畫面。它出錯的方式不會是報錯，
 * 而是**默默排錯順序**，故四件事必須各自有斷言，缺一個就有一整類錯誤沒有防線：
 *
 *  1. **名次順序 = 分數排序**：名次由 `score DESC, novelId ASC` 的索引 +1 指派，
 *     兩者不一致就代表指派用的不是排序後的集合。
 *  2. **名次連續、無缺號無重複**：`@@unique([period, categoryId, rank])` 只擋得住重複，
 *     擋不住缺號（少寫一列即缺一號，且不會有任何錯誤）。
 *  3. **升降標記逐筆相符**：`change` 與 `changeCount` 是與前次名次比對的結果，
 *     只斷言「有值」等於沒斷言 —— 全部寫 `same` 也會綠。
 *  4. **計分第四項真的被算進去**：`rating × ratingCount × 0.5`。
 *     前三項只要有任一部作品有閱讀就看得出來，**第四項不會**——
 *     一部有評分但零閱讀零收藏零留言的作品，漏算時分數是 0、名次沉到底，
 *     和「這部作品本來就不紅」在畫面上一模一樣。故資料集 MUST 含這樣一部作品
 *     （N4），且 MUST 斷言其 `score` 等於 20 而非 0（FR-045、T099）。
 *
 * **每個週期同時產生「全部分類」與各分類榜**：唯一鍵含 `categoryId`（research R-10），
 * 少了它不同分類的同名次會互相排斥；而只寫 `all` 的實作在分類榜上會拿到空白畫面。
 *
 * **統計為空 → 空榜且不保留前次結果**：保留會讓「顯示最近一次重算的結果」變成假的。
 * 這一條以「一個沒有任何已發佈作品的分類」驗證，並先於該組合塞一列舊名次 ——
 * 只驗「重算後是空的」時，一個從不寫入該組合的實作也會綠。
 *
 * 示範資料的 13 部作品分數皆為 0，會一併入榜並排在本檔四部之後；
 * 期望值因而**一律相對計算**，MUST NOT 寫死總筆數（示範資料筆數變動不該弄紅本檔）。
 */

const DAY_MS = 24 * 3_600_000;
const TAIPEI_OFFSET_MS = 8 * 3_600_000;
const CRON_IP = '10.89.1.1';

/** 台北昨日的日界起點（與 `NovelDailyStat.date` 同一取值），本檔自行以純算術計算 */
function yesterdayTaipeiStart(): Date {
  const now = Date.now();
  const todayStart = Math.floor((now + TAIPEI_OFFSET_MS) / DAY_MS) * DAY_MS - TAIPEI_OFFSET_MS;
  return new Date(todayStart - DAY_MS);
}

interface Entry {
  rank: number;
  novelId: string;
  score: number;
  change: string | null;
  changeCount: number | null;
  computedAt: Date;
}

let author: { id: string };
let categoryId: string;
const EMPTY_CATEGORY_ID = 't114-empty-category';
/** N1～N5 的作品識別碼 */
const novelIds: Record<string, string> = {};
const created: { authorId: string; novelId: string }[] = [];

function runRecompute(): Promise<Response> {
  return testFetch('/api/cron/rankings', {
    method: 'POST',
    ip: CRON_IP,
    headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
  });
}

async function entriesOf(period: string, cat: string): Promise<Entry[]> {
  const rows = await prisma.rankingEntry.findMany({
    where: { period, categoryId: cat },
    orderBy: { rank: 'asc' },
  });
  return rows.map((r) => ({
    rank: r.rank,
    novelId: r.novelId,
    score: r.score,
    change: r.change,
    changeCount: r.changeCount,
    computedAt: r.computedAt,
  }));
}

/** 於台北昨日寫入一列每日統計（重跑覆寫同一列） */
async function setDailyStat(
  novelId: string,
  data: { views?: number; favorites?: number; comments?: number }
): Promise<void> {
  const date = yesterdayTaipeiStart();
  const values = { views: 0, favorites: 0, comments: 0, ...data };
  await prisma.novelDailyStat.upsert({
    where: { novelId_date: { novelId, date } },
    create: { novelId, date, ...values },
    update: values,
  });
}

/** 建立一部本檔專用作品，指定分類與評分（評分為 `Novel` 的當前值，三個週期共用） */
async function makeNovel(
  key: string,
  opts: { rating?: number; ratingCount?: number } = {}
): Promise<string> {
  const novel = await createPublishedNovel({ authorId: author.id, chapterCount: 1 });
  created.push({ authorId: author.id, novelId: novel.novelId });
  await prisma.novel.update({
    where: { id: novel.novelId },
    data: { categoryId, rating: opts.rating ?? 0, ratingCount: opts.ratingCount ?? 0 },
  });
  novelIds[key] = novel.novelId;
  return novel.novelId;
}

beforeAll(async () => {
  await resetAuthTables();
  await prisma.rankingEntry.deleteMany();
  await prisma.novelDailyStat.deleteMany();

  author = await createAccount('ranking-author', 'author');

  const category = await prisma.category.findFirstOrThrow({ orderBy: { sortOrder: 'asc' } });
  categoryId = category.id;

  // 沒有任何已發佈作品的分類：組合存在、取數為空 —— 空榜的唯一可構造情境
  await prisma.category.upsert({
    where: { id: EMPTY_CATEGORY_ID },
    create: {
      id: EMPTY_CATEGORY_ID,
      slug: EMPTY_CATEGORY_ID,
      label: 'T114 空分類',
      emoji: '🫙',
      description: '整合測試專用：不掛任何作品',
      color: '#000000',
      bgColor: '#ffffff',
      sortOrder: 999,
    },
    update: {},
  });

  // 固定資料集：四部作品，四項計分各由一部作品「單獨」貢獻 ——
  // 混在一起時，某一項的係數寫錯仍可能湊出相同的總排序
  await makeNovel('n1'); // views 100 × 1.0 = 100
  await makeNovel('n2'); // favorites 5 × 8.0 = 40
  await makeNovel('n3'); // comments 3 × 4.0 = 12
  await makeNovel('n4', { rating: 4, ratingCount: 10 }); // 4 × 10 × 0.5 = 20（三類計數皆 0）

  await setDailyStat(novelIds.n1, { views: 100 });
  await setDailyStat(novelIds.n2, { favorites: 5 });
  await setDailyStat(novelIds.n3, { comments: 3 });
  await setDailyStat(novelIds.n4, {}); // 明確寫一列全 0：N4 的分數只可能來自評分項
}, 120_000);

afterAll(async () => {
  await prisma.rankingEntry.deleteMany();
  await prisma.novelDailyStat.deleteMany();
  await cleanupNovels(created);
  await prisma.category.deleteMany({ where: { id: EMPTY_CATEGORY_ID } });
  await resetAuthTables();
});

describe('T114-1：首次重算的名次、分數與計分四項', () => {
  let weekly: Entry[];
  let body: {
    ok: boolean;
    processed: number;
    durationMs: number;
    detail: { periods: number; combos: number; entriesWritten: number };
  };

  beforeAll(async () => {
    const res = await runRecompute();
    expect(res.status).toBe(200);
    body = await res.json();
    weekly = await entriesOf('weekly', 'all');
  }, 60_000);

  it('回應形狀符合契約（三個週期、組合數與寫入筆數）', () => {
    expect(body.ok).toBe(true);
    expect(typeof body.durationMs).toBe('number');
    expect(body.detail.periods).toBe(3);
    expect(body.detail.combos).toBeGreaterThan(3); // 3 週期 ×（all + 各分類）
    expect(body.detail.entriesWritten).toBeGreaterThan(0);
  });

  it('名次由 1 起連續、無缺號無重複', () => {
    expect(weekly.map((e) => e.rank)).toEqual(weekly.map((_, i) => i + 1));
  });

  it('名次順序與分數排序完全一致（分數相同時以 novelId ASC 決勝）', () => {
    const resorted = [...weekly].sort(
      (a, b) => b.score - a.score || a.novelId.localeCompare(b.novelId)
    );
    expect(weekly.map((e) => e.novelId)).toEqual(resorted.map((e) => e.novelId));
  });

  it('四部作品的分數逐一等於計分公式的值', () => {
    const byNovel = new Map(weekly.map((e) => [e.novelId, e]));
    expect(byNovel.get(novelIds.n1)?.score).toBe(100); // 100 × 1.0
    expect(byNovel.get(novelIds.n2)?.score).toBe(40); //    5 × 8.0
    expect(byNovel.get(novelIds.n3)?.score).toBe(12); //    3 × 4.0
  });

  it('零閱讀零收藏零留言但有評分的作品，分數為 rating × ratingCount × 0.5 而非 0（FR-045）', () => {
    const n4 = weekly.find((e) => e.novelId === novelIds.n4);
    expect(n4).toBeDefined();
    expect(n4!.score).toBe(20);
    expect(n4!.score).not.toBe(0);
  });

  it('四部依分數排在最前（示範資料分數皆為 0）', () => {
    expect(weekly.slice(0, 4).map((e) => e.novelId)).toEqual([
      novelIds.n1, // 100
      novelIds.n2, // 40
      novelIds.n4, // 20
      novelIds.n3, // 12
    ]);
  });

  it('首次重算的每一列皆為 new、changeCount 為 0（先前無同組合的名次）', () => {
    expect([...new Set(weekly.map((e) => e.change))]).toEqual(['new']);
    expect(weekly.every((e) => e.changeCount === 0)).toBe(true);
  });
});

describe('T114-2：每個週期同時產生「全部分類」與各分類榜', () => {
  it('三種週期皆有 all 榜且非空', async () => {
    for (const period of ['weekly', 'monthly', 'alltime']) {
      expect((await entriesOf(period, 'all')).length).toBeGreaterThan(0);
    }
  });

  it('本檔四部所屬的分類榜同樣產生，且名次於該榜內重新編為 1 起連續', async () => {
    const board = await entriesOf('weekly', categoryId);
    expect(board.length).toBeGreaterThanOrEqual(4);
    expect(board.map((e) => e.rank)).toEqual(board.map((_, i) => i + 1));
    expect(board.slice(0, 4).map((e) => e.novelId)).toEqual([
      novelIds.n1,
      novelIds.n2,
      novelIds.n4,
      novelIds.n3,
    ]);
  });

  it('每個已存在分類在三種週期下皆有對應組合（唯一鍵含 categoryId，research R-10）', async () => {
    const categories = await prisma.category.findMany({ select: { id: true } });
    const withNovels = new Set(
      (
        await prisma.novel.findMany({
          where: { status: 'published' },
          select: { categoryId: true },
        })
      ).map((n) => n.categoryId)
    );

    for (const period of ['weekly', 'monthly', 'alltime']) {
      for (const c of categories) {
        const board = await entriesOf(period, c.id);
        // 有已發佈作品的分類 MUST 有名次；沒有的分類 MUST 為空榜（下一組驗）
        expect(board.length > 0).toBe(withNovels.has(c.id));
      }
    }
  }, 60_000);

  it('不同分類可各有第 1 名（唯一鍵若少了 categoryId，第二個組合會寫不進去）', async () => {
    const firsts = await prisma.rankingEntry.findMany({ where: { period: 'weekly', rank: 1 } });
    expect(firsts.length).toBeGreaterThan(1);
    expect(new Set(firsts.map((f) => f.categoryId)).size).toBe(firsts.length);
  });
});

describe('T114-3：統計為空的組合為空榜，且不保留前次結果（FR-048）', () => {
  beforeAll(async () => {
    // 於空分類的組合塞一列舊名次：重算若「沒有資料就不動」，這一列會留下來
    await prisma.rankingEntry.create({
      data: {
        period: 'weekly',
        categoryId: EMPTY_CATEGORY_ID,
        rank: 1,
        novelId: novelIds.n1,
        score: 999,
        change: 'same',
        changeCount: 0,
      },
    });
    const res = await runRecompute();
    expect(res.status).toBe(200);
  }, 60_000);

  it('無已發佈作品的分類重算後為空榜，前次的名次不留存', async () => {
    expect(await entriesOf('weekly', EMPTY_CATEGORY_ID)).toEqual([]);
  });
});

describe('T114-4：第二次重算的升降標記與 changeCount 逐筆相符（SC-009）', () => {
  let before: Entry[];
  let after: Entry[];

  beforeAll(async () => {
    before = await entriesOf('weekly', 'all');

    // N3 由第 4 升至第 2；N1 的分數不動故名次不動（`same` 的唯一來源）；
    // 新增的 N5 插在四部之後 —— 四種標記因而在同一次重算中全部出現。
    // **MUST NOT 讓新作品插到 N1 之上**：那會把每一列都往下推，`same` 就再也不會發生，
    // 而「全部標成 down」的實作仍會通過逐筆比對。
    await setDailyStat(novelIds.n3, { comments: 3, views: 38 }); // 12 + 38 = 50
    await makeNovel('n5');
    await setDailyStat(novelIds.n5, { views: 5 });

    const res = await runRecompute();
    expect(res.status).toBe(200);
    after = await entriesOf('weekly', 'all');
  }, 120_000);

  it('新的名次順序反映新的分數', () => {
    expect(after.slice(0, 5).map((e) => e.novelId)).toEqual([
      novelIds.n1, // 100（不動）
      novelIds.n3, // 50
      novelIds.n2, // 40
      novelIds.n4, // 20
      novelIds.n5, // 5
    ]);
  });

  it('每一列的 change 與 changeCount 皆等於「與前次名次比對」的結果', () => {
    const prevRank = new Map(before.map((e) => [e.novelId, e.rank]));

    for (const entry of after) {
      const prev = prevRank.get(entry.novelId);
      if (prev === undefined) {
        expect({ id: entry.novelId, change: entry.change, count: entry.changeCount }).toEqual({
          id: entry.novelId,
          change: 'new',
          count: 0,
        });
        continue;
      }
      const expected = prev === entry.rank ? 'same' : prev > entry.rank ? 'up' : 'down';
      expect({ id: entry.novelId, change: entry.change, count: entry.changeCount }).toEqual({
        id: entry.novelId,
        change: expected,
        count: Math.abs(prev - entry.rank),
      });
    }
  });

  it('四種標記在本次重算中皆實際出現（否則上一則案例可能只驗到其中一種）', () => {
    const kinds = new Set(after.map((e) => e.change));
    expect(kinds).toEqual(new Set(['new', 'up', 'down', 'same']));
  });

  it('新入榜的 N5 為 new、躍升的 N3 為 up（4→2）、分數未動的 N1 為 same', () => {
    const byNovel = new Map(after.map((e) => [e.novelId, e]));
    expect(byNovel.get(novelIds.n5)?.change).toBe('new');
    expect(byNovel.get(novelIds.n3)).toMatchObject({ rank: 2, change: 'up', changeCount: 2 });
    expect(byNovel.get(novelIds.n1)).toMatchObject({ rank: 1, change: 'same', changeCount: 0 });
  });

  it('名次仍連續無缺號無重複（新增一部作品後亦然）', () => {
    expect(after.map((e) => e.rank)).toEqual(after.map((_, i) => i + 1));
    expect(new Set(after.map((e) => e.rank)).size).toBe(after.length);
  });

  it('computedAt 於本次重算被更新（讀者看到的是最近一次重算的結果）', () => {
    const earliestAfter = Math.min(...after.map((e) => e.computedAt.getTime()));
    const latestBefore = Math.max(...before.map((e) => e.computedAt.getTime()));
    expect(earliestAfter).toBeGreaterThanOrEqual(latestBefore);
  });
});
