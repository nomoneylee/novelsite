import 'server-only';
import { env } from '@/lib/env';
import {
  withTransaction,
  adjustFavoriteCount,
  bookshelfRowExists,
  chapterBelongsToNovel,
  countHistory,
  createBookshelfEvent,
  createBookshelfRow,
  createReaderPreferenceIfAbsent,
  deleteHistory,
  deleteOldestHistory,
  filterPublishedNovelIds,
  findHistoryRow,
  findReadingProgress,
  listHistoryPage,
  upsertReadingHistory,
  upsertReadingProgress,
  type HistoryPage,
  type TxClient,
} from '@/lib/repositories';
import { decodeCursor } from '@/lib/pagination/cursor';
import { makeMergePayloadSchema, type ProgressReportInput } from '@/lib/validation/reader';
import type { ProgressPoint } from '@/lib/types';
import { ServiceError, parseOrThrow } from './errors';

/**
 * 閱讀狀態服務（FEAT-4 4-A / T025，contracts/internal-modules.md §1）
 * ====================================================================
 * 進度、歷史（含上限淘汰）、本機合併三組。
 *
 * `ReadingHistory` **沒有獨立的寫入端點**（contracts/reader-state-api.md §3）——
 * 它的唯一落點是 `PUT /api/reading-progress` 的處理程序在寫入進度後呼叫
 * `touchHistory`。歷史寫入整體為「盡力而為」：失敗 MUST 被呼叫端吞掉，不中斷閱讀。
 */

export interface MergeResult {
  merged: { bookshelf: number; history: number; preference: number };
  skipped: { bookshelf: number; history: number };
  truncated: { bookshelf: boolean; history: boolean };
}

// ── 續讀位置 ──────────────────────────────────────────────────────────────

/**
 * 上報進度。**MUST 核對章節屬於所報作品**——不核對的話，任何人都能把
 * 「A 作品的進度」指到 B 作品的章節，續讀入口就會把讀者送到別本書裡去。
 * 章節不存在與不屬於該作品是同一個回答（404）。
 */
export async function reportProgress(userId: string, input: ProgressReportInput): Promise<void> {
  const { novelId, chapterId, percent } = input;

  if (!(await chapterBelongsToNovel(novelId, chapterId))) {
    throw new ServiceError('NOT_FOUND', '找不到這個章節');
  }
  await upsertReadingProgress(userId, { novelId, chapterId, percent });
}

export async function getProgress(userId: string, novelId: string): Promise<ProgressPoint | null> {
  return findReadingProgress(userId, novelId);
}

// ── 閱讀歷史 ──────────────────────────────────────────────────────────────

/**
 * 歷史 upsert ＋ 上限淘汰，兩者於**同一交易**內。
 *
 * 淘汰只在寫入**新作品**時發生：重讀已在歷史中者只更新該筆
 * （否則每重讀一次就淘汰一部，歷史會被自己吃光）。
 */
async function touchHistoryIn(
  tx: TxClient,
  userId: string,
  novelId: string,
  chapterId: string,
  readAt?: Date
): Promise<void> {
  const existing = await findHistoryRow(userId, novelId, tx);
  if (!existing) {
    const overflow = (await countHistory(userId, tx)) + 1 - env.READING_HISTORY_MAX;
    if (overflow > 0) await deleteOldestHistory(userId, overflow, tx);
  }
  await upsertReadingHistory(userId, { novelId, chapterId, readAt }, tx);
}

export async function touchHistory(
  userId: string,
  novelId: string,
  chapterId: string
): Promise<void> {
  await withTransaction((tx) => touchHistoryIn(tx, userId, novelId, chapterId));
}

export async function listHistory(
  userId: string,
  opts: { cursor?: string; limit: number }
): Promise<HistoryPage> {
  const cursor = decodeCursorOrThrow(opts.cursor);
  return listHistoryPage(userId, { cursor, limit: opts.limit });
}

export async function clearHistory(userId: string, novelId?: string): Promise<number> {
  return deleteHistory(userId, novelId);
}

function decodeCursorOrThrow(raw: string | undefined) {
  if (!raw) return undefined;
  const parsed = decodeCursor(raw);
  if (!parsed) {
    throw new ServiceError('VALIDATION_ERROR', '游標格式不正確', {
      fields: { cursor: '游標格式不正確' },
    });
  }
  return parsed;
}

// ── 本機資料合併 ──────────────────────────────────────────────────────────

/**
 * 合併未登入期間累積的本機資料（FR-015／FR-015a／FR-015b／FR-016）。
 *
 * **冪等**：書架已有者略過、歷史「較新才覆寫」、偏好「無列才建立」。
 * 重複執行不產生重複項目，也不重複累計 `favoriteCount`。
 *
 * 書架分支走與 `bookshelfService.add` **相同的三件事**：每一筆實際新增者於同一交易內
 * 「建立關聯列 → `favoriteCount` +1 → 寫 `BookshelfEvent(+1)`」。只寫關聯列的話，
 * 「訪客累積數十本後登入」這條**最常見的入庫途徑**收藏不進當日淨增，
 * 而 `BookshelfEvent` 沒有校正機制——該日的 delta 永久遺失（contracts §5、FR-036a）。
 */
export async function mergeLocalState(userId: string, input: unknown): Promise<MergeResult> {
  const payload = parseOrThrow(makeMergePayloadSchema(env.MERGE_BATCH_MAX), input);

  const bookshelfIds = [...new Set(payload.bookshelf)];
  // 同一部作品在本機可能有多筆歷史殘留，只留最新的那一筆再合併
  const historyByNovel = new Map<string, { chapterId: string; readAt: Date }>();
  for (const entry of payload.history) {
    const readAt = new Date(entry.readAt);
    const kept = historyByNovel.get(entry.novelId);
    if (!kept || readAt > kept.readAt) {
      historyByNovel.set(entry.novelId, { chapterId: entry.chapterId, readAt });
    }
  }
  const published = await filterPublishedNovelIds([
    ...new Set([...bookshelfIds, ...historyByNovel.keys()]),
  ]);

  const merged = { bookshelf: 0, history: 0, preference: 0 };
  const skipped = { bookshelf: 0, history: 0 };

  for (const novelId of bookshelfIds) {
    // 指向已不存在或已下架的作品 → 計入 skipped，不讓整批失敗（FR-016）
    if (!published.has(novelId) || (await bookshelfRowExists(userId, novelId))) {
      skipped.bookshelf += 1;
      continue;
    }
    await withTransaction(async (tx) => {
      await createBookshelfRow(userId, novelId, tx);
      await adjustFavoriteCount(novelId, 1, tx);
      await createBookshelfEvent(userId, novelId, 1, tx);
    });
    merged.bookshelf += 1;
  }

  for (const [novelId, entry] of historyByNovel) {
    if (!published.has(novelId)) {
      skipped.history += 1;
      continue;
    }
    // 「時間較新者為準」（FR-015）：本機較舊即略過，MUST NOT 用本機值蓋掉雲端的新紀錄
    const existing = await findHistoryRow(userId, novelId);
    if (existing && existing.readAt >= entry.readAt) {
      skipped.history += 1;
      continue;
    }
    await withTransaction((tx) =>
      touchHistoryIn(tx, userId, novelId, entry.chapterId, entry.readAt)
    );
    merged.history += 1;
  }

  if (payload.preference) {
    const created = await createReaderPreferenceIfAbsent(userId, payload.preference);
    merged.preference = created ? 1 : 0;
  }

  return {
    merged,
    skipped,
    truncated: {
      bookshelf: payload.truncated?.bookshelf ?? false,
      history: payload.truncated?.history ?? false,
    },
  };
}
