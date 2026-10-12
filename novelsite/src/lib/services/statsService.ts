import 'server-only';
import {
  aggregateDay,
  backfillNovelViewCounts,
  createChapterView,
  earliestActivityAt,
  getChapterVisibility,
  getLatestPublishedChapterId,
  getNovelPerformanceRaw,
  hasViewSince,
  novelBelongsToAuthor,
  purgeBookshelfEventsBefore,
  purgeChapterViewsBefore,
  purgeNotificationsOlderThan,
  recomputeNovelCounters,
  sumDailyStatsByDateForAuthor,
  upsertDailyStat,
  getAuthorSummary,
  auditLogRepo,
} from '@/lib/repositories';
import { env } from '@/lib/env';
import { rateLimitStore } from '@/lib/auth/rateLimit';
import { viewerHashForAnonymous, viewerHashForUser } from '@/lib/stats/viewerHash';
import {
  taipeiDateString,
  taipeiDayRange,
  taipeiDayStart,
  taipeiDaysBetween,
  yesterdayTaipei,
} from '@/lib/time/taipeiDay';
import type { AuthorSummary, DailyStat } from '@/lib/types';
import { ServiceError } from './errors';

/**
 * 統計服務（FEAT-4 4-C / T101，contracts/internal-modules.md §1）
 * ===============================================================
 * 三件事：閱讀上報（六步順序）、每日彙總（彙總 → 回填 → 校正 → 清理）、
 * 以及作者向的兩份取數（儀表板讀每日統計、成效總覽**直接查明細**）。
 */

const DAY_MS = 24 * 3_600_000;
const MINUTE_MS = 60_000;

/** 成效總覽的期間固定為近 7 日（contracts/analytics-scheduling-api.md §2） */
const PERFORMANCE_PERIOD_DAYS = 7;

// ─────────────────────────────────────────────────────────────
// 1. 閱讀上報
// ─────────────────────────────────────────────────────────────

export interface ViewContext {
  /** 已登入者的帳號；匿名為 undefined */
  userId?: string;
  clientIp: string;
  userAgent: string;
}

/**
 * 記錄一次章節閱讀（contracts/analytics-scheduling-api.md §1 的六步，**順序有意義**）。
 *
 * ```
 * 1. 章節存在且已發佈？        否 → NOT_FOUND（Route Handler 轉 404）
 * 2. 來源位址限流              超額 → 直接返回，不寫入      ← 靜默捨棄
 * 3. 閱讀者為作品擁有者？      是   → 直接返回，不寫入
 * 4. 計算 viewerHash
 * 5. 去重窗口內已有同鍵紀錄？  是   → 直接返回，不寫入
 * 6. 寫入 ChapterView
 * ```
 *
 * **步驟 2～5 的略過一律回 `void`，呼叫端無從區分**（FR-035a）：回 429 等於把門檻
 * 直接告訴對方，之後每分鐘打 N−1 次即可長期灌水；而上報是閱讀頁背景送出的請求，
 * 回錯誤只會在正常讀者的主控台留下一排紅字。
 *
 * **限流的計數是每一次請求都算**（含後來被去重或被作者排除擋下的那些）——
 * 它防的是灌爆明細表的手法，而那個手法本來就會撞上去重。
 */
export async function recordChapterView(chapterId: string, ctx: ViewContext): Promise<void> {
  // 1. 章節必須存在且已發佈；未發佈與不存在對讀者是同一個回答
  const chapter = await getChapterVisibility(chapterId);
  if (!chapter || chapter.status !== 'published') {
    throw new ServiceError('NOT_FOUND', '找不到這個章節');
  }

  // 2. 來源位址限流（靜默捨棄）
  const quota = await rateLimitStore.hit(
    `chapter-view:${ctx.clientIp}`,
    MINUTE_MS,
    env.CHAPTER_VIEW_RATE_MAX
  );
  if (!quota.allowed) return;

  // 3. 作者本人的閱讀不計曝光（FR-033a）——否則寫作當下反覆預覽就能把自己送上排行榜
  if (ctx.userId && ctx.userId === chapter.authorId) return;

  // 4. 讀者識別雜湊（登入者只取 userId，故換裝置換網路仍是同一位讀者）
  const viewerHash = ctx.userId
    ? viewerHashForUser(ctx.userId)
    : viewerHashForAnonymous(ctx.clientIp, ctx.userAgent);

  // 5. 去重窗口
  const since = new Date(Date.now() - env.VIEW_DEDUPE_WINDOW_MINUTES * MINUTE_MS);
  if (await hasViewSince(viewerHash, chapterId, since)) return;

  // 6. 寫入
  await createChapterView({
    chapterId,
    novelId: chapter.novelId,
    userId: ctx.userId,
    viewerHash,
  });
}

// ─────────────────────────────────────────────────────────────
// 2. 每日彙總
// ─────────────────────────────────────────────────────────────

export interface RollupResult {
  daysProcessed: number;
  novelsTouched: number;
  viewsPurged: number;
  bookshelfEventsPurged: number;
  /**
   * 逾期通知的刪除筆數（FEAT-4 4-D / T127a）。三個清理對象**逐一回報**，
   * MUST NOT 併成一個總數 —— 保留期設錯（90 寫成 9）時，總數看起來只是「今天刪得多」。
   */
  notificationsPurged: number;
  /** 90 天前稽核紀錄 IP 雜湊化處理筆數（R-5） */
  auditIpsHashed: number;
}

/**
 * 每日統計彙總（FR-036a／FR-036b、SC-008、SC-019）。
 *
 * 範圍 `[起點, 台北昨日]`，**當日 MUST NOT 建列** —— 今天的數字還在增加，
 * 把它彙總進去，兩次執行之間只要有人閱讀結果就不同，冪等會變成一句空話。
 * 起點取現存明細中最早的活動日，故連續數日未執行時一次補齊、期間無空洞。
 *
 * 四步的**順序有意義**：清理 MUST 在彙總與校正之後。反過來寫，同一次執行會先刪掉
 * 尚未彙總的明細，那幾天的數字就永遠是 0 —— 而且不會有任何錯誤訊息，
 * 因為每一步單獨看都成功了。
 */
export async function rollupDaily(now: Date): Promise<RollupResult> {
  const lastDay = yesterdayTaipei(now);
  const earliest = await earliestActivityAt();

  // 1. 逐日 upsert（同一日期重跑覆寫同一列，識別碼不變）
  const days = earliest ? taipeiDaysBetween(earliest, lastDay) : [];
  const touched = new Set<string>();
  for (const day of days) {
    const { start, end } = taipeiDayRange(day);
    for (const row of await aggregateDay(start, end)) {
      await upsertDailyStat(row.novelId, day, {
        views: row.views,
        favorites: row.favorites,
        comments: row.comments,
      });
      touched.add(row.novelId);
    }
  }

  // 2. 回填累計曝光（近 7 日的起點與成效總覽同一算法）
  await backfillNovelViewCounts(taipeiDayStart(new Date(now.getTime() - 6 * DAY_MS)));

  // 3. 以原始表全量重算校正四個計數
  await recomputeNovelCounters();

  // 4. 清理（MUST 最後；逐一指名對象並回報刪除筆數 —— 清理是無聲的破壞性動作，
  //    只回一個總數或完全不回，保留期設錯時沒有任何人看得出來）
  const cutoff = new Date(now.getTime() - env.VIEW_RETENTION_DAYS * DAY_MS);
  const viewsPurged = await purgeChapterViewsBefore(cutoff);
  const bookshelfEventsPurged = await purgeBookshelfEventsBefore(cutoff);
  // 通知的保留期**與明細不同**（90 天 vs 7 天），故各自算各自的界線。
  // 清理接在這裡而非另開一個排程作業：三個保留期集中在同一個作業內，
  // 接漏一個時只需看一個地方（arch.md §10.3、FR-053）
  const notificationsPurged = await purgeNotificationsOlderThan(
    new Date(now.getTime() - env.NOTIFICATION_RETENTION_DAYS * DAY_MS)
  );

  // 5. 稽核紀錄 90 天前 IP 雜湊化（R-5）
  const auditIpCutoff = new Date(now.getTime() - 90 * DAY_MS);
  const auditIpsHashed = await auditLogRepo.hashOldAuditIps(auditIpCutoff);

  return {
    daysProcessed: days.length,
    novelsTouched: touched.size,
    viewsPurged,
    bookshelfEventsPurged,
    notificationsPurged,
    auditIpsHashed,
  };
}

// ─────────────────────────────────────────────────────────────
// 3. 作者儀表板（讀每日統計）
// ─────────────────────────────────────────────────────────────

export interface DashboardData {
  summary: AuthorSummary;
  daily: DailyStat[];
  /** 統計截止日（台北昨日，`YYYY-MM-DD`）。UI MUST 明確標示 */
  statsThroughDate: string;
}

/**
 * 儀表板取數。**最新資料點為台北昨日**（FR-036b：當日不建列），故一併回傳
 * `statsThroughDate` —— 少了它，作者會把「今天沒有數字」誤判為故障。
 *
 * 期間內沒有統計列的日期補零值，圖表因而是連續的 N 天，
 * 而不是把「那天沒人看」畫成一條時間軸被壓縮的曲線。
 */
export async function getAuthorDashboard(
  authorId: string,
  opts: { days: number }
): Promise<DashboardData> {
  const lastDay = yesterdayTaipei(new Date());
  const firstDay = new Date(lastDay.getTime() - (opts.days - 1) * DAY_MS);

  const [summary, rows] = await Promise.all([
    getAuthorSummary(authorId),
    sumDailyStatsByDateForAuthor(authorId, firstDay, lastDay),
  ]);

  const byDate = new Map(rows.map((row) => [taipeiDateString(row.date), row]));
  const daily: DailyStat[] = taipeiDaysBetween(firstDay, lastDay).map((day) => {
    const date = taipeiDateString(day);
    const row = byDate.get(date);
    return {
      date,
      views: row?.views ?? 0,
      favorites: row?.favorites ?? 0,
      comments: row?.comments ?? 0,
    };
  });

  return { summary, daily, statsThroughDate: taipeiDateString(lastDay) };
}

// ─────────────────────────────────────────────────────────────
// 4. 作品成效總覽（直接查明細）
// ─────────────────────────────────────────────────────────────

export interface PerformanceMetrics {
  impressions: number;
  /** 不重複讀者數（兩項比率的分母） */
  distinctViewers: number;
  /** 分母為 0 時為 `null`（**不是 0**）——見下方說明 */
  completionRate: number | null;
  favoriteConversion: number | null;
  commentHeat: number;
  periodDays: number;
  periodStart: Date;
  periodEnd: Date;
}

/**
 * 四項成效指標（FR-042、FR-042a、data-model.md §7.2）。
 *
 * **MUST 直接查 `ChapterView` 明細，MUST NOT 讀 `NovelDailyStat`**：兩項比率的分母是
 * 不重複讀者數，而每日統計沒有讀者身分維度，跨日相加會使分母的語意從「人」滑成
 * 「人日」—— 同一位每天都來的讀者被算成七位，完讀率因而被壓到七分之一。
 * 數字仍會顯示、頁面仍不會報錯，只是全都是錯的。
 *
 * **分母為 0 時兩項比率回 `null` 而非 0**：`0%` 是一個斷言（「來的人都沒讀完」），
 * 而事實是「沒有人來過」，兩者對作者的意義完全相反；型別上做成 `null`，
 * UI 才分得出來要顯示「尚無資料」。
 *
 * 非擁有者與不存在的作品**一律回 `null`**（歸屬判定在資料層，FR-019）。
 */
export async function getNovelPerformance(
  authorId: string,
  novelId: string
): Promise<PerformanceMetrics | null> {
  if (!(await novelBelongsToAuthor(authorId, novelId))) return null;

  const periodEnd = new Date();
  const periodStart = taipeiDayStart(
    new Date(periodEnd.getTime() - (PERFORMANCE_PERIOD_DAYS - 1) * DAY_MS)
  );

  const latestChapterId = await getLatestPublishedChapterId(novelId);
  const raw = await getNovelPerformanceRaw(novelId, latestChapterId, periodStart, periodEnd);

  const ratio = (numerator: number): number | null =>
    raw.distinctViewers === 0 ? null : numerator / raw.distinctViewers;

  return {
    impressions: raw.impressions,
    distinctViewers: raw.distinctViewers,
    completionRate: ratio(raw.completedViewers),
    favoriteConversion: ratio(raw.favoriteAdds),
    commentHeat: raw.commentHeat,
    periodDays: PERFORMANCE_PERIOD_DAYS,
    periodStart,
    periodEnd,
  };
}
