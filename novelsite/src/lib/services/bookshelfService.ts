import 'server-only';
import {
  withTransaction,
  adjustFavoriteCount,
  bookshelfRowExists,
  createBookshelfEvent,
  createBookshelfRow,
  deleteBookshelfRow,
  listBookshelfNovelIds,
  listBookshelfPage,
  publishedNovelExists,
  type BookshelfPage,
} from '@/lib/repositories';
import { decodeCursor } from '@/lib/pagination/cursor';
import { ServiceError, translateDbError } from './errors';

/**
 * 書架服務（FEAT-4 4-A / T024，contracts/internal-modules.md §1）
 * ================================================================
 * `add`／`remove` 於**同一交易**內完成三件事：`Bookshelf` 增刪 →
 * `Novel.favoriteCount` 增減 → `BookshelfEvent` 寫入。**缺任一項即失效**：
 * 少了計數，使用者的動作不會立即可見（FR-038a）；
 * 少了事件，每日彙總的「當日淨增」無從計算（FR-036a、research R-3）。
 */

export async function add(userId: string, novelId: string): Promise<{ favoriteCount: number }> {
  if (!(await publishedNovelExists(novelId))) {
    throw new ServiceError('NOT_FOUND', '找不到這部作品');
  }

  try {
    const favoriteCount = await withTransaction(async (tx) => {
      await createBookshelfRow(userId, novelId, tx);
      const count = await adjustFavoriteCount(novelId, 1, tx);
      await createBookshelfEvent(userId, novelId, 1, tx);
      return count;
    });
    return { favoriteCount };
  } catch (err) {
    // 唯一鍵衝突＝已在書架。訊息引導到「移出」而非重試，否則使用者會一直按同一個鍵
    throw translateDbError(err, '這部作品已在你的書架中');
  }
}

export async function remove(userId: string, novelId: string): Promise<{ favoriteCount: number }> {
  const favoriteCount = await withTransaction(async (tx) => {
    const deleted = await deleteBookshelfRow(userId, novelId, tx);
    // 不在書架就不寫負向事件 —— 寫了會讓當日淨增憑空少一，而那一天的 delta 沒有校正機制
    if (deleted === 0) return null;

    const count = await adjustFavoriteCount(novelId, -1, tx);
    await createBookshelfEvent(userId, novelId, -1, tx);
    return count;
  });

  if (favoriteCount === null) {
    throw new ServiceError('NOT_FOUND', '這部作品不在你的書架中');
  }
  return { favoriteCount };
}

export async function isInShelf(userId: string, novelId: string): Promise<boolean> {
  return bookshelfRowExists(userId, novelId);
}

/** 完整的收藏識別碼清單，供客戶端 Hook 一次取得（見 repository 的說明） */
export async function listIds(userId: string): Promise<string[]> {
  return listBookshelfNovelIds(userId);
}

export async function list(
  userId: string,
  opts: { cursor?: string; limit: number }
): Promise<BookshelfPage> {
  const cursor = opts.cursor ? decodeCursor(opts.cursor) : undefined;
  if (opts.cursor && !cursor) {
    throw new ServiceError('VALIDATION_ERROR', '游標格式不正確', {
      fields: { cursor: '游標格式不正確' },
    });
  }
  return listBookshelfPage(userId, { cursor: cursor ?? undefined, limit: opts.limit });
}
