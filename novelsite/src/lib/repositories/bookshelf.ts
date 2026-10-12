/**
 * 書架資料存取（Bookshelf Repository，FEAT-4 4-A / T019）
 * ========================================================
 * 「加入書架」在資料上是**三件事**：`Bookshelf` 關聯列、`Novel.favoriteCount`、
 * `BookshelfEvent`。三者 MUST 能在同一個交易內被呼叫（故每一支都收選填的 `tx`）——
 * 少了計數，使用者的動作不會立即可見（FR-038a）；少了事件，每日彙總的
 * 「當日淨增」在資料上不可計算（FR-036a、research R-3）。
 */
import 'server-only';
import type { Novel } from '@/lib/types';
import { db, type TxClient } from './tx';
import { toNovel, NOVEL_INCLUDE } from './mappers';
import { encodeCursor } from '@/lib/pagination/cursor';

/** 書架列表的一頁（`createdAt DESC, id ASC`，決勝鍵一律為 id） */
export interface BookshelfPage {
  items: Novel[];
  nextCursor: string | null;
}

export async function bookshelfRowExists(
  userId: string,
  novelId: string,
  tx?: TxClient
): Promise<boolean> {
  const row = await db(tx).bookshelf.findUnique({
    where: { userId_novelId: { userId, novelId } },
    select: { id: true },
  });
  return row !== null;
}

/** 建立關聯列。唯一鍵衝突（重複加入）由呼叫端轉譯為 CONFLICT */
export async function createBookshelfRow(
  userId: string,
  novelId: string,
  tx?: TxClient
): Promise<void> {
  await db(tx).bookshelf.create({ data: { userId, novelId } });
}

/** 刪除關聯列；回傳實際刪除筆數（0 表示原本就不在書架） */
export async function deleteBookshelfRow(
  userId: string,
  novelId: string,
  tx?: TxClient
): Promise<number> {
  const result = await db(tx).bookshelf.deleteMany({ where: { userId, novelId } });
  return result.count;
}

/** `Novel.favoriteCount` 增減，回傳異動後的值（供端點於**同一次回應**帶回，SC-019） */
export async function adjustFavoriteCount(
  novelId: string,
  delta: number,
  tx?: TxClient
): Promise<number> {
  const row = await db(tx).novel.update({
    where: { id: novelId },
    data: { favoriteCount: { increment: delta } },
    select: { favoriteCount: true },
  });
  return row.favoriteCount;
}

/** 收藏事件明細。`delta` 只有 ±1，值域由服務層保證 */
export async function createBookshelfEvent(
  userId: string,
  novelId: string,
  delta: 1 | -1,
  tx?: TxClient
): Promise<void> {
  await db(tx).bookshelfEvent.create({ data: { userId, novelId, delta } });
}

/**
 * 該使用者收藏的全部作品識別碼（`createdAt DESC`）。
 *
 * 客戶端的 `useBookshelf`／`useBookshelfIds` 要回答的是「這一部在不在書架裡」與
 * 「整份清單是哪些」，兩者都需要**完整**的 id 集合。用游標分頁去湊，
 * 收藏 500 部的人就要打 25 次請求才知道當前這一部有沒有被收藏。
 * 只 select 一個欄位，成本遠低於分頁列表。
 */
export async function listBookshelfNovelIds(userId: string, tx?: TxClient): Promise<string[]> {
  const rows = await db(tx).bookshelf.findMany({
    where: { userId },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    select: { novelId: true },
  });
  return rows.map((r) => r.novelId);
}

/**
 * 書架列表的游標分頁。
 *
 * 游標條件寫成 `OR: [{ createdAt: { lt } }, { createdAt: eq, id: { gt } }]`，
 * **MUST NOT 用 Prisma 的 `cursor`/`skip`** —— 它只支援單一唯一欄位，
 * 承載不了「時間 + id」的複合鍵，同一毫秒的兩筆會重複或遺漏（data-model.md §6）。
 */
export async function listBookshelfPage(
  userId: string,
  opts: { cursor?: { primary: string; id: string }; limit: number },
  tx?: TxClient
): Promise<BookshelfPage> {
  const { cursor, limit } = opts;
  const rows = await db(tx).bookshelf.findMany({
    where: {
      userId,
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: new Date(cursor.primary) } },
              { createdAt: new Date(cursor.primary), id: { gt: cursor.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    take: limit + 1,
    include: { novel: { include: NOVEL_INCLUDE } },
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  return {
    items: page.map((row) => toNovel(row.novel)),
    nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

/**
 * 某作品的**收藏者**識別碼（FEAT-4 4-D，T122／追更通知的收件人查詢）。
 *
 * 與 `listBookshelfNovelIds(userId)` 互為反向；`Bookshelf` 的 `@@index([novelId])`
 * 正是為此建的（arch.md §4.2 該索引註已載明）。
 *
 * **排除作者本人於服務層做**，不寫進本查詢的條件 —— 服務層本來就要為了通知的
 * `payload` 取得 `authorId`，在資料層再判一次等於同一條規則有兩個實作，
 * 而兩個實作遲早只會改到一個。
 */
export async function listBookshelfUserIds(novelId: string, tx?: TxClient): Promise<string[]> {
  const rows = await db(tx).bookshelf.findMany({
    where: { novelId },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}
