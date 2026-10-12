import 'server-only';
import {
  createRankingEntries,
  deleteRankingEntries,
  getCategories,
  getRanking as getRankingEntries,
  listPreviousRanks,
  sumDailyStatsForRanking,
  withTransaction,
  RANKING_ALL_CATEGORIES,
  type RankingEntryRow,
} from '@/lib/repositories';
import { RANKING_PERIODS, type RankingEntryView, type RankingPeriod } from '@/lib/types';

/**
 * 排行服務（FEAT-4 4-D / T126，contracts/internal-modules.md §1、data-model.md §7.3）
 * =====================================================================================
 * 排行榜是本站唯一「由統計推導、讀者卻當成事實在看」的畫面。它出錯的方式不是報錯，
 * 而是**默默排錯順序** —— 故計分、名次指派與升降標記三者各自寫成一個可單獨檢查的步驟。
 *
 * **四項計分的取值一律來自 `sumDailyStatsForRanking`（T099）**，
 * 本檔 MUST NOT 直接查 `prisma`（憲章第 III 條）。
 */

/** FR-045 的權重。四項相加即 `score`，改權重只需改這一處 */
const WEIGHT = { views: 1.0, favorites: 8.0, comments: 4.0, rating: 0.5 } as const;

export interface RankingResult {
  periods: number;
  /** `(period, categoryId)` 的組合數 = 週期數 ×（全站榜 + 各分類榜） */
  combos: number;
  entriesWritten: number;
}

/**
 * 排行重算。
 *
 * 每個 `(period, categoryId)` 組合在**單一交易**內「讀前次名次 → `deleteMany` →
 * `createMany`」（research R-10）：讀者 MUST NOT 看到中間狀態，
 * 而中間狀態在這裡的長相是「整張榜是空的」——那比排錯順序更難解釋。
 *
 * **統計為空 → 該組合為空榜，且不保留前次結果**（FR-048）：
 * 「沒有資料就不動」會讓「顯示最近一次重算的結果」變成一句假話，
 * 而示範資料環境本來就是這個情境。
 */
export async function recompute(now: Date): Promise<RankingResult> {
  const categories = await getCategories();
  const categoryIds = [RANKING_ALL_CATEGORIES, ...categories.map((c) => c.id)];

  let entriesWritten = 0;
  for (const period of RANKING_PERIODS) {
    for (const categoryId of categoryIds) {
      entriesWritten += await recomputeCombo(period, categoryId, now);
    }
  }

  return {
    periods: RANKING_PERIODS.length,
    combos: RANKING_PERIODS.length * categoryIds.length,
    entriesWritten,
  };
}

/** 單一組合的重算；回傳本組合寫入的名次筆數 */
async function recomputeCombo(
  period: RankingPeriod,
  categoryId: string,
  now: Date
): Promise<number> {
  // 取數在交易外：它是唯讀的，且是整個重算裡最慢的一步 ——
  // 放進交易只會把鎖持有的時間拉長到與計分同級
  const sources = await sumDailyStatsForRanking(period, categoryId);

  const scored = sources
    .map((row) => ({
      novelId: row.novelId,
      score:
        row.views * WEIGHT.views +
        row.favorites * WEIGHT.favorites +
        row.comments * WEIGHT.comments +
        // 第四項：三個週期皆取 `Novel` 的當前值（評分無「當日新增量」語意）。
        // 漏了它時，一部有評分但零閱讀零收藏零留言的作品分數是 0、名次沉到底，
        // 而那與「這部作品本來就不紅」在畫面上一模一樣（FR-045）
        row.rating * row.ratingCount * WEIGHT.rating,
    }))
    // 名次由 `score DESC, novelId ASC` 排序後的索引 +1 指派 —— 天然連續、
    // 無缺號無重複（FR-048）。決勝鍵是必要的：分數相同時的順序若不固定，
    // 兩次重算會得出不同的榜，而資料完全沒變
    .sort((a, b) => b.score - a.score || a.novelId.localeCompare(b.novelId));

  return withTransaction(async (tx) => {
    // 前次名次 MUST 在刪除之前讀 —— 刪完再讀只剩空集合，每一列都會被標成 `new`
    const previous = new Map(
      (await listPreviousRanks(period, categoryId, tx)).map((r) => [r.novelId, r.rank])
    );

    await deleteRankingEntries(period, categoryId, tx);
    if (scored.length === 0) return 0;

    const rows: RankingEntryRow[] = scored.map((entry, index) => {
      const rank = index + 1;
      const prev = previous.get(entry.novelId);
      return {
        period,
        categoryId,
        rank,
        novelId: entry.novelId,
        score: entry.score,
        ...changeOf(prev, rank),
        computedAt: now,
      };
    });

    return createRankingEntries(rows, tx);
  });
}

/**
 * 升降標記（data-model.md §7.3）。前次不存在即 `new`；
 * `changeCount = |前次 rank − 本次 rank|`（`new` 與 `same` 皆為 0）。
 */
function changeOf(
  previousRank: number | undefined,
  rank: number
): { change: RankingEntryRow['change']; changeCount: number } {
  if (previousRank === undefined) return { change: 'new', changeCount: 0 };
  if (previousRank === rank) return { change: 'same', changeCount: 0 };
  return {
    change: previousRank > rank ? 'up' : 'down',
    changeCount: Math.abs(previousRank - rank),
  };
}

/**
 * 顯示用的取數（最近一次重算的結果）。
 *
 * 服務層對 UI 的單一入口 —— 頁面經此而非直接呼叫資料存取層，
 * 日後若要在顯示前補任何規則（例如隱藏下架作品），只有這一處要改。
 */
export async function getRanking(
  period: RankingPeriod,
  categoryId: string = RANKING_ALL_CATEGORIES
): Promise<RankingEntryView[]> {
  return getRankingEntries(period, categoryId);
}
