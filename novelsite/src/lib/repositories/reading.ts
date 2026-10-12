/**
 * 閱讀狀態資料存取（Reading Repository，FEAT-4 4-A / T020）
 * ==========================================================
 * 續讀位置、閱讀歷史（含上限淘汰）、閱讀偏好三組。
 *
 * 閱讀歷史**不是事件序列**：`@@unique([userId, novelId])` 使「再次閱讀」成為 upsert，
 * 故列表天然每部作品一筆（FR-013）。上限淘汰只在寫入**新作品**時發生。
 */
import 'server-only';
import type { ProgressPoint, ReadingHistoryEntry } from '@/lib/types';
import { db, type TxClient } from './tx';
import { toReadingHistoryEntry, READING_HISTORY_INCLUDE } from './mappers';
import { encodeCursor } from '@/lib/pagination/cursor';

export interface HistoryPage {
  items: ReadingHistoryEntry[];
  nextCursor: string | null;
}

// ── 續讀位置 ──────────────────────────────────────────────────────────────

/** 章節是否屬於該作品（服務層核對歸屬用；不存在與不屬於是同一個回答：false） */
export async function chapterBelongsToNovel(
  novelId: string,
  chapterId: string,
  tx?: TxClient
): Promise<boolean> {
  const row = await db(tx).chapter.findFirst({
    where: { id: chapterId, novelId },
    select: { id: true },
  });
  return row !== null;
}

export async function upsertReadingProgress(
  userId: string,
  input: { novelId: string; chapterId: string; percent: number },
  tx?: TxClient
): Promise<void> {
  const { novelId, chapterId, percent } = input;
  await db(tx).readingProgress.upsert({
    where: { userId_novelId: { userId, novelId } },
    create: { userId, novelId, chapterId, percent },
    update: { chapterId, percent },
  });
}

/**
 * 續讀點。**join `Chapter` 取回 `chapterNumber`** —— 續讀入口要顯示「讀到第幾章」，
 * 少了它作品詳情頁得為了一個數字再打一次資料庫。
 * 章節已下架或被刪除時回 null：指向看不到的章節的續讀入口比沒有入口更糟。
 */
export async function findReadingProgress(
  userId: string,
  novelId: string,
  tx?: TxClient
): Promise<ProgressPoint | null> {
  const row = await db(tx).readingProgress.findUnique({
    where: { userId_novelId: { userId, novelId } },
  });
  if (!row) return null;

  const chapter = await db(tx).chapter.findFirst({
    where: { id: row.chapterId, novelId, status: 'published' },
    select: { number: true },
  });
  if (!chapter) return null;

  return { chapterId: row.chapterId, chapterNumber: chapter.number, percent: row.percent };
}

// ── 閱讀歷史 ──────────────────────────────────────────────────────────────

export async function findHistoryRow(
  userId: string,
  novelId: string,
  tx?: TxClient
): Promise<{ id: string; readAt: Date } | null> {
  return db(tx).readingHistory.findUnique({
    where: { userId_novelId: { userId, novelId } },
    select: { id: true, readAt: true },
  });
}

export async function upsertReadingHistory(
  userId: string,
  input: { novelId: string; chapterId: string; readAt?: Date },
  tx?: TxClient
): Promise<void> {
  const { novelId, chapterId, readAt } = input;
  const at = readAt ?? new Date();
  await db(tx).readingHistory.upsert({
    where: { userId_novelId: { userId, novelId } },
    create: { userId, novelId, chapterId, readAt: at },
    update: { chapterId, readAt: at },
  });
}

export async function countHistory(userId: string, tx?: TxClient): Promise<number> {
  return db(tx).readingHistory.count({ where: { userId } });
}

/**
 * 淘汰 `readAt` 最舊的 N 筆（達上限且寫入新作品時使用）。
 * 以 id 清單再刪，而非 `deleteMany` 加 orderBy —— Prisma 的 `deleteMany` 不支援排序。
 */
export async function deleteOldestHistory(
  userId: string,
  count: number,
  tx?: TxClient
): Promise<number> {
  if (count <= 0) return 0;
  const victims = await db(tx).readingHistory.findMany({
    where: { userId },
    orderBy: [{ readAt: 'asc' }, { id: 'asc' }],
    take: count,
    select: { id: true },
  });
  if (victims.length === 0) return 0;

  const result = await db(tx).readingHistory.deleteMany({
    where: { id: { in: victims.map((v) => v.id) } },
  });
  return result.count;
}

export async function deleteHistory(
  userId: string,
  novelId?: string,
  tx?: TxClient
): Promise<number> {
  const result = await db(tx).readingHistory.deleteMany({
    where: { userId, ...(novelId ? { novelId } : {}) },
  });
  return result.count;
}

/** 歷史列表的游標分頁（`readAt DESC, id ASC`，決勝鍵一律為 id） */
export async function listHistoryPage(
  userId: string,
  opts: { cursor?: { primary: string; id: string }; limit: number },
  tx?: TxClient
): Promise<HistoryPage> {
  const { cursor, limit } = opts;
  const rows = await db(tx).readingHistory.findMany({
    where: {
      userId,
      ...(cursor
        ? {
            OR: [
              { readAt: { lt: new Date(cursor.primary) } },
              { readAt: new Date(cursor.primary), id: { gt: cursor.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ readAt: 'desc' }, { id: 'asc' }],
    take: limit + 1,
    include: READING_HISTORY_INCLUDE,
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  // 章節標題另取：`ReadingHistory.chapterId` **刻意不設關聯**（章節下架不該連坐刪掉歷史），
  // 故無法 include。一次 `in` 查詢換掉每列一次往返。
  const chapters = await db(tx).chapter.findMany({
    where: { id: { in: page.map((row) => row.chapterId) } },
    select: { id: true, title: true },
  });
  const titleById = new Map(chapters.map((c) => [c.id, c.title]));

  return {
    items: page.map((row) => toReadingHistoryEntry(row, titleById.get(row.chapterId))),
    nextCursor: hasMore && last ? encodeCursor(last.readAt, last.id) : null,
  };
}

// ── 閱讀偏好 ──────────────────────────────────────────────────────────────

export interface ReaderPreferenceValue {
  fontSize: string;
  theme: string;
}

export async function findReaderPreference(
  userId: string,
  tx?: TxClient
): Promise<ReaderPreferenceValue | null> {
  const row = await db(tx).readerPreference.findUnique({ where: { userId } });
  return row ? { fontSize: row.fontSize, theme: row.theme } : null;
}

/** 局部更新：未指定的欄位保持原值（PUT 的酬載兩項皆為可選） */
export async function upsertReaderPreference(
  userId: string,
  patch: { fontSize?: string; theme?: string },
  tx?: TxClient
): Promise<ReaderPreferenceValue> {
  const row = await db(tx).readerPreference.upsert({
    where: { userId },
    create: { userId, ...patch },
    update: patch,
  });
  return { fontSize: row.fontSize, theme: row.theme };
}

/** 只在尚無紀錄時建立（合併路徑，FR-015a：已有則 MUST NOT 覆寫）；回傳是否實際建立 */
export async function createReaderPreferenceIfAbsent(
  userId: string,
  value: { fontSize?: string; theme?: string },
  tx?: TxClient
): Promise<boolean> {
  const existing = await db(tx).readerPreference.findUnique({
    where: { userId },
    select: { userId: true },
  });
  if (existing) return false;

  await db(tx).readerPreference.create({ data: { userId, ...value } });
  return true;
}
