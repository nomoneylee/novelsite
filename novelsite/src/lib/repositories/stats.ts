/**
 * 統計資料存取（Stats Repository，FEAT-4 4-C / T099）
 * ====================================================
 * 章節閱讀明細（`ChapterView`）與每日新增量（`NovelDailyStat`）的唯一存取點，
 * 另含排行計分的取數（`sumDailyStatsForRanking`）與兩張表的保留期清理。
 *
 * **本檔是全站唯一允許 `$queryRaw` 之處**（憲章第 III 條附條件、research R-17）：
 * `COUNT(DISTINCT "viewerHash")` 是完讀率與收藏轉換的分母，而 Prisma 的 `groupBy`
 * 不支援 distinct 聚合。用 `findMany({ distinct })` 取回全部雜湊再於服務層計數，
 * 會把整個期間的明細列拉進記憶體。
 * raw 的兩條規矩：SQL MUST 為**兩軌通用的標準語法**（不依 provider 分支，故本階段
 * 不新增雙軌分歧點）、MUST **只回純量**（領域型別仍由 `mappers.ts` 產生）。
 */
import 'server-only';
import { prisma } from '@/lib/db';
import { taipeiDayStart } from '@/lib/time/taipeiDay';
// 週期的值域沿用領域型別，MUST NOT 在本檔另立一份同名同值的定義 ——
// 兩份一旦分歧，排行頁與計分取數就會對「有哪些週期」有兩種說法
import type { RankingPeriod } from '@/lib/types';
import { db, type TxClient } from './tx';

const DAY_MS = 24 * 3_600_000;

/** `COUNT(...)` 在 PostgreSQL 回 bigint、在 SQLite 回 number，兩軌統一收斂為 number */
function toCount(value: number | bigint | null | undefined): number {
  return value == null ? 0 : Number(value);
}

// ─────────────────────────────────────────────────────────────
// 明細寫入與去重
// ─────────────────────────────────────────────────────────────

export interface ChapterViewRow {
  chapterId: string;
  novelId: string;
  /** 已登入者的帳號；匿名為 undefined */
  userId?: string;
  viewerHash: string;
}

/**
 * 去重窗口內是否已有同 `(viewerHash, chapterId)` 的紀錄（FR-035）。
 *
 * **窗口的鍵含瀏覽器識別字串，換一個即可繞過** —— 故它 MUST NOT 被當作唯一防線，
 * 擋灌水的是以來源位址為鍵的限流（contracts/analytics-scheduling-api.md §1）。
 */
export async function hasViewSince(
  viewerHash: string,
  chapterId: string,
  since: Date,
  tx?: TxClient
): Promise<boolean> {
  const row = await db(tx).chapterView.findFirst({
    where: { viewerHash, chapterId, viewedAt: { gte: since } },
    select: { id: true },
  });
  return row !== null;
}

export async function createChapterView(row: ChapterViewRow, tx?: TxClient): Promise<void> {
  await db(tx).chapterView.create({
    data: {
      chapterId: row.chapterId,
      novelId: row.novelId,
      userId: row.userId ?? null,
      viewerHash: row.viewerHash,
    },
  });
}

// ─────────────────────────────────────────────────────────────
// 每日彙總
// ─────────────────────────────────────────────────────────────

/**
 * 彙總範圍的起點來源：現存明細中最早的活動時刻（`min(ChapterView.viewedAt)` 與
 * `min(BookshelfEvent.createdAt)` 取較早者）；兩者皆空回 `null`。
 *
 * **取「現存」而非「歷來」是刻意的**：清理過的日期其統計列早已寫好，
 * 再次納入範圍只會拿空的明細把它覆寫成 0（data-model.md §7.1）。
 */
export async function earliestActivityAt(): Promise<Date | null> {
  const [view, event] = await Promise.all([
    prisma.chapterView.aggregate({ _min: { viewedAt: true } }),
    prisma.bookshelfEvent.aggregate({ _min: { createdAt: true } }),
  ]);

  const candidates = [view._min.viewedAt, event._min.createdAt].filter(
    (d): d is Date => d instanceof Date
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((min, d) => (d < min ? d : min));
}

export interface DailyAggregateRow {
  novelId: string;
  views: number;
  favorites: number;
  comments: number;
}

/**
 * 單一台北日的三類新增量（data-model.md §7.1）。
 * 區間為 `[start, end)` —— 上界開區間，否則邊界那一毫秒會同時落在兩天。
 *
 * 只回**當日有活動**的作品；沒有活動就不建列（全站每日對每一部作品建零值列，
 * 資料量會等於「作品數 × 天數」，而那些列不帶任何資訊）。
 */
export async function aggregateDay(start: Date, end: Date): Promise<DailyAggregateRow[]> {
  const range = { gte: start, lt: end };

  const [viewRows, favoriteRows, commentRows, reviewRows] = await Promise.all([
    prisma.chapterView.groupBy({
      by: ['novelId'],
      where: { viewedAt: range },
      _count: { _all: true },
    }),
    prisma.bookshelfEvent.groupBy({
      by: ['novelId'],
      where: { createdAt: range },
      _sum: { delta: true },
    }),
    // `Comment` 沒有 `novelId`，故先按章節分組再換算 —— 分組後的列數是「當日有留言的章節數」，
    // 遠小於留言本身的筆數
    prisma.comment.groupBy({
      by: ['chapterId'],
      where: { createdAt: range, status: 'visible' },
      _count: { _all: true },
    }),
    prisma.review.groupBy({
      by: ['novelId'],
      where: { createdAt: range, status: 'visible' },
      _count: { _all: true },
    }),
  ]);

  const merged = new Map<string, DailyAggregateRow>();
  const bucket = (novelId: string): DailyAggregateRow => {
    let row = merged.get(novelId);
    if (!row) {
      row = { novelId, views: 0, favorites: 0, comments: 0 };
      merged.set(novelId, row);
    }
    return row;
  };

  for (const row of viewRows) bucket(row.novelId).views += toCount(row._count._all);
  for (const row of favoriteRows) bucket(row.novelId).favorites += toCount(row._sum.delta);
  for (const row of reviewRows) bucket(row.novelId).comments += toCount(row._count._all);

  if (commentRows.length > 0) {
    const chapters = await prisma.chapter.findMany({
      where: { id: { in: commentRows.map((r) => r.chapterId) } },
      select: { id: true, novelId: true },
    });
    const novelIdByChapter = new Map(chapters.map((c) => [c.id, c.novelId]));
    for (const row of commentRows) {
      const novelId = novelIdByChapter.get(row.chapterId);
      if (novelId) bucket(novelId).comments += toCount(row._count._all);
    }
  }

  return [...merged.values()];
}

/** 以 `@@unique([novelId, date])` 為落點的 upsert —— 重跑覆寫同一列，識別碼不變（SC-008） */
export async function upsertDailyStat(
  novelId: string,
  date: Date,
  values: { views: number; favorites: number; comments: number },
  tx?: TxClient
): Promise<void> {
  await db(tx).novelDailyStat.upsert({
    where: { novelId_date: { novelId, date } },
    create: { novelId, date, ...values },
    update: values,
  });
}

// ─────────────────────────────────────────────────────────────
// 保留期清理（MUST 發生在彙總與校正之後，先清後算會少掉剛被刪的明細）
// ─────────────────────────────────────────────────────────────

export async function purgeChapterViewsBefore(cutoff: Date): Promise<number> {
  const result = await prisma.chapterView.deleteMany({ where: { viewedAt: { lt: cutoff } } });
  return result.count;
}

export async function purgeBookshelfEventsBefore(cutoff: Date): Promise<number> {
  const result = await prisma.bookshelfEvent.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return result.count;
}

// ─────────────────────────────────────────────────────────────
// 作者儀表板（讀每日統計；最新資料點為台北昨日，FR-036b）
// ─────────────────────────────────────────────────────────────

export interface AuthorDailyRow {
  date: Date;
  views: number;
  favorites: number;
  comments: number;
}

/** 該作者名下全部作品的每日統計，按日期加總（資料層強制帶入 `authorId`，FR-019） */
export async function sumDailyStatsByDateForAuthor(
  authorId: string,
  from: Date,
  to: Date
): Promise<AuthorDailyRow[]> {
  const rows = await prisma.novelDailyStat.groupBy({
    by: ['date'],
    where: { novel: { authorId }, date: { gte: from, lte: to } },
    _sum: { views: true, favorites: true, comments: true },
    orderBy: { date: 'asc' },
  });

  return rows.map((row) => ({
    date: row.date,
    views: toCount(row._sum.views),
    favorites: toCount(row._sum.favorites),
    comments: toCount(row._sum.comments),
  }));
}

// ─────────────────────────────────────────────────────────────
// 作品成效總覽（**直接查明細**，MUST NOT 讀 NovelDailyStat，FR-042a）
// ─────────────────────────────────────────────────────────────

export interface NovelPerformanceRaw {
  impressions: number;
  /** 不重複讀者數；兩項比率的分母 */
  distinctViewers: number;
  /** 讀過最新已發佈章節的不重複讀者數 */
  completedViewers: number;
  /** 期間內的加入收藏事件數（移出不折抵） */
  favoriteAdds: number;
  commentHeat: number;
}

export async function getNovelPerformanceRaw(
  novelId: string,
  latestChapterId: string | null,
  from: Date,
  to: Date
): Promise<NovelPerformanceRaw> {
  const range = { gte: from, lte: to };

  const [impressions, distinctRows, completedRows, favoriteAdds, comments, reviews] =
    await Promise.all([
      prisma.chapterView.count({ where: { novelId, viewedAt: range } }),
      prisma.$queryRaw<{ c: number | bigint }[]>`
        SELECT COUNT(DISTINCT "viewerHash") AS c
        FROM "ChapterView"
        WHERE "novelId" = ${novelId} AND "viewedAt" >= ${from} AND "viewedAt" <= ${to}
      `,
      latestChapterId
        ? prisma.$queryRaw<{ c: number | bigint }[]>`
            SELECT COUNT(DISTINCT "viewerHash") AS c
            FROM "ChapterView"
            WHERE "chapterId" = ${latestChapterId}
              AND "viewedAt" >= ${from} AND "viewedAt" <= ${to}
          `
        : Promise.resolve([]),
      prisma.bookshelfEvent.count({ where: { novelId, delta: 1, createdAt: range } }),
      prisma.comment.count({
        where: { chapter: { novelId }, status: 'visible', createdAt: range },
      }),
      prisma.review.count({ where: { novelId, status: 'visible', createdAt: range } }),
    ]);

  return {
    impressions,
    distinctViewers: toCount(distinctRows[0]?.c),
    completedViewers: toCount(completedRows[0]?.c),
    favoriteAdds,
    commentHeat: comments + reviews,
  };
}

// ─────────────────────────────────────────────────────────────
// 排行計分的取數（data-model.md §7.3；呼叫端為 4-D 的 rankingService）
// ─────────────────────────────────────────────────────────────

export interface RankingSourceRow {
  novelId: string;
  views: number;
  favorites: number;
  comments: number;
  /** 三個週期皆取 `Novel` 的**當前值**（評分無「當日新增量」語意） */
  rating: number;
  ratingCount: number;
}

/**
 * 計分的四項來源一次回齊（FR-045 的**唯一取數落點**）。
 *
 * 少了 `rating`／`ratingCount`，`rankingService` 為了補上 `rating × ratingCount × 0.5`
 * 這一項就只剩「自行查 `prisma`」一條路 —— 那違反憲章第 III 條，
 * 而且要到 layering 測試才會被抓到（contracts/internal-modules.md §2）。
 *
 * `categoryId` 為 `'all'` 時不篩分類。
 */
export async function sumDailyStatsForRanking(
  period: RankingPeriod,
  categoryId: string
): Promise<RankingSourceRow[]> {
  const novels = await prisma.novel.findMany({
    where: { status: 'published', ...(categoryId === 'all' ? {} : { categoryId }) },
    select: {
      id: true,
      rating: true,
      ratingCount: true,
      totalViews: true,
      favoriteCount: true,
      commentCount: true,
    },
  });
  if (novels.length === 0) return [];

  // 總榜取 `Novel` 的累計值；週榜／月榜取每日新增量的加總
  if (period === 'alltime') {
    return novels.map((n) => ({
      novelId: n.id,
      views: n.totalViews,
      favorites: n.favoriteCount,
      comments: n.commentCount,
      rating: n.rating,
      ratingCount: n.ratingCount,
    }));
  }

  const since = periodStart(period, new Date());
  const grouped = await prisma.novelDailyStat.groupBy({
    by: ['novelId'],
    where: { novelId: { in: novels.map((n) => n.id) }, date: { gte: since } },
    _sum: { views: true, favorites: true, comments: true },
  });
  const sums = new Map(grouped.map((g) => [g.novelId, g._sum]));

  return novels.map((n) => {
    const sum = sums.get(n.id);
    return {
      novelId: n.id,
      views: toCount(sum?.views),
      favorites: toCount(sum?.favorites),
      comments: toCount(sum?.comments),
      rating: n.rating,
      ratingCount: n.ratingCount,
    };
  });
}

/** 週榜近 7 日、月榜近 30 日；起點對齊台北日界（與 `weeklyViews` 的回填同一算法） */
function periodStart(period: Exclude<RankingPeriod, 'alltime'>, now: Date): Date {
  const days = period === 'weekly' ? 7 : 30;
  return taipeiDayStart(new Date(now.getTime() - (days - 1) * DAY_MS));
}
