/**
 * 排行榜資料存取（Rankings Repository，FEAT-4 4-D / T121）
 * =========================================================
 * `RankingEntry` 的唯一存取點：讀（排行頁與首頁區塊）與寫（每次重算的整組覆寫）。
 *
 * **本檔 MUST NOT 混入計分取數**（contracts/internal-modules.md §2）——
 * 那一支是 `stats.ts` 的 `sumDailyStatsForRanking`。兩者的生命週期不同：
 * 本檔的查詢每一次請求都跑，計分取數只在重算時跑；混在一起會讓顯示路徑
 * 順手把整個統計期間的資料一起拉出來。
 *
 * **本檔 MUST NOT 再有任何寫死的名次**（FR-043a）：4-D 之前的 `getRanking`
 * 讀的是 seed 塞進去的 30 筆手寫示範名次，且分類榜是「取全站榜再依 label 過濾後
 * 重新編號」—— 那個編號與資料庫裡的名次不是同一件事，畫面上卻長得一模一樣。
 * 現在分類是 `RankingEntry.categoryId` 的一個維度，各分類榜由重算直接寫出。
 */
import 'server-only';
import { prisma } from '@/lib/db';
import type { RankingEntryView, RankingPeriod } from '@/lib/types';
import { toRankingEntryView, NOVEL_INCLUDE } from './mappers';
import { db, type TxClient } from './tx';

/** 「全部分類」的固定鍵。`null` 進唯一鍵在兩軌的比較語意都不可靠（research R-10） */
export const RANKING_ALL_CATEGORIES = 'all';

// ─────────────────────────────────────────────────────────────
// 讀（顯示用）
// ─────────────────────────────────────────────────────────────

/**
 * 指定週期與分類的排行榜（最近一次重算的結果）。
 *
 * `categoryId` 省略即全站榜；分類榜**直接查該組合**，MUST NOT 取全站榜再過濾 ——
 * 過濾後重新編號會與資料庫裡的名次分歧，而讀者看到的是後者的替身。
 * 該組合尚未重算過（或重算時統計為空）即回空陣列，由 UI 呈現空狀態（FR-043b）。
 */
export async function getRanking(
  period: RankingPeriod,
  categoryId: string = RANKING_ALL_CATEGORIES
): Promise<RankingEntryView[]> {
  const rows = await prisma.rankingEntry.findMany({
    where: { period, categoryId },
    orderBy: { rank: 'asc' },
    include: { novel: { include: NOVEL_INCLUDE } },
  });
  return rows.map(toRankingEntryView);
}

// 註（FEAT-4 4-D / T141）：原本的 `getAllRankings()`（一次回三種週期的全站榜）已刪除。
// 排行頁改以查詢字串決定週期與分類、每次只取**一個組合**之後，它就沒有任何消費端了 ——
// 而「一次把三榜全撈出來」正是舊版把分類榜做成客戶端過濾的原因。

// ─────────────────────────────────────────────────────────────
// 寫（每次重算的整組覆寫；呼叫端為 rankingService，每組合各一個交易）
// ─────────────────────────────────────────────────────────────

/**
 * 該組合的**前次**名次（`novelId → rank`），供升降標記比對。
 * MUST 在同一交易內、`deleteMany` 之前讀取 —— 刪完再讀就只剩空集合，
 * 每一列都會被標成 `new`。
 */
export async function listPreviousRanks(
  period: RankingPeriod,
  categoryId: string,
  tx?: TxClient
): Promise<{ novelId: string; rank: number }[]> {
  return db(tx).rankingEntry.findMany({
    where: { period, categoryId },
    select: { novelId: true, rank: true },
  });
}

/** 清空該組合的名次（統計為空時只做這一步，故空榜**不保留前次結果**，FR-048） */
export async function deleteRankingEntries(
  period: RankingPeriod,
  categoryId: string,
  tx?: TxClient
): Promise<number> {
  const result = await db(tx).rankingEntry.deleteMany({ where: { period, categoryId } });
  return result.count;
}

export interface RankingEntryRow {
  period: RankingPeriod;
  categoryId: string;
  rank: number;
  novelId: string;
  score: number;
  change: 'up' | 'down' | 'same' | 'new';
  changeCount: number;
  computedAt: Date;
}

/** 整組寫入。一次 `createMany` 而非逐列 `create`：一個組合就是一整張榜 */
export async function createRankingEntries(
  rows: RankingEntryRow[],
  tx?: TxClient
): Promise<number> {
  if (rows.length === 0) return 0;
  const result = await db(tx).rankingEntry.createMany({ data: rows });
  return result.count;
}
