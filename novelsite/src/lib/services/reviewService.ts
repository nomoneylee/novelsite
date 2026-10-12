import 'server-only';
import {
  withTransaction,
  aggregateNovelRating,
  adjustNovelCommentCount,
  adjustReviewLikeCount,
  createReviewLikeRow,
  createReviewRow,
  deleteReviewLikeRow,
  deleteReviewRow,
  findReviewItem,
  findReviewOwner,
  listReviewsPage,
  publishedNovelExists,
  reviewLikeExists,
  setNovelRating,
  updateReviewRow,
  type ReviewSort,
} from '@/lib/repositories';
import type { ReviewItem, ReviewPage } from '@/lib/types';
import { decodeCursor } from '@/lib/pagination/cursor';
import { enforceInteractionQuota } from '@/lib/auth/rateLimit';
import { ServiceError, translateDbError } from './errors';

/**
 * 評論服務（FEAT-4 4-B / T064，contracts/internal-modules.md §1）
 * ================================================================
 * `create`／`update`／`remove` 三個寫入操作 MUST 於**同一交易**內把
 * `Novel.rating` 與 `ratingCount` 重算回真值，並增減 `commentCount`。
 * 分兩次寫的話，中間失敗就留下一個永遠對不上的評分，而評分沒有第二個來源可以對帳。
 *
 * 重算取的是**明細的聚合值**而非「原值 ± 這一筆」：後者只要遺漏或重試一次就永久偏掉。
 */

/** 一則評論存在嗎、是不是他的 —— 404 與 403 的分界（FR-004：公開資源用 403，不用 404） */
async function requireOwnReview(
  userId: string,
  reviewId: string
): Promise<{ id: string; novelId: string }> {
  const row = await findReviewOwner(reviewId);
  if (!row) {
    throw new ServiceError('NOT_FOUND', '找不到這則評論');
  }
  if (row.userId !== userId) {
    throw new ServiceError('FORBIDDEN', '只能修改自己的評論');
  }
  return { id: row.id, novelId: row.novelId };
}

/** 於交易內重算並寫回評分真值。三個寫入操作共用，少一處呼叫就少一次校正 */
async function recalcRating(
  novelId: string,
  tx: Parameters<Parameters<typeof withTransaction>[0]>[0]
): Promise<void> {
  const { average, count } = await aggregateNovelRating(novelId, tx);
  await setNovelRating(novelId, { rating: average, ratingCount: count }, tx);
}

export async function list(
  novelId: string,
  opts: { sort: ReviewSort; cursor?: string; limit: number },
  viewerId?: string
): Promise<ReviewPage> {
  if (!(await publishedNovelExists(novelId))) {
    throw new ServiceError('NOT_FOUND', '找不到這部作品');
  }

  const cursor = opts.cursor ? decodeCursor(opts.cursor) : undefined;
  if (opts.cursor && !cursor) {
    throw new ServiceError('VALIDATION_ERROR', '游標格式不正確', {
      fields: { cursor: '游標格式不正確' },
    });
  }

  return listReviewsPage(
    novelId,
    { sort: opts.sort, cursor: cursor ?? undefined, limit: opts.limit },
    viewerId
  );
}

/**
 * 發表評論。同一人對同一作品只能有一則（FR-021）——
 * 唯一鍵擋下第二次，訊息 MUST 引導改為編輯，否則使用者只會一直按同一個鍵。
 */
export async function create(
  userId: string,
  novelId: string,
  input: { rating: number; content: string }
): Promise<ReviewItem> {
  await enforceInteractionQuota(userId);

  if (!(await publishedNovelExists(novelId))) {
    throw new ServiceError('NOT_FOUND', '找不到這部作品');
  }

  let reviewId: string;
  try {
    reviewId = await withTransaction(async (tx) => {
      const id = await createReviewRow(userId, novelId, input, tx);
      await recalcRating(novelId, tx);
      await adjustNovelCommentCount(novelId, 1, tx);
      return id;
    });
  } catch (err) {
    throw translateDbError(err, '你已經評論過這部作品了，請改為編輯既有的評論');
  }

  const item = await findReviewItem(reviewId, userId);
  if (!item) {
    throw new ServiceError('INTERNAL_ERROR', '系統忙碌中，請稍後再試');
  }
  return item;
}

/** 編輯自己的評論。**編輯不是發表**，故 `commentCount` 不動（US2 AC1） */
export async function update(
  userId: string,
  reviewId: string,
  patch: { rating?: number; content?: string }
): Promise<ReviewItem> {
  const { novelId } = await requireOwnReview(userId, reviewId);

  await withTransaction(async (tx) => {
    await updateReviewRow(reviewId, patch, tx);
    await recalcRating(novelId, tx);
  });

  const item = await findReviewItem(reviewId, userId);
  if (!item) {
    throw new ServiceError('NOT_FOUND', '找不到這則評論');
  }
  return item;
}

/**
 * 刪除自己的評論 —— **硬刪除**（FR-023）。
 * 唯一鍵自然釋放，刪除後可對同一作品重新發表，且該操作不需要任何特例處理。
 */
export async function remove(userId: string, reviewId: string): Promise<void> {
  const { novelId } = await requireOwnReview(userId, reviewId);

  await withTransaction(async (tx) => {
    await deleteReviewRow(reviewId, tx);
    await recalcRating(novelId, tx);
    await adjustNovelCommentCount(novelId, -1, tx);
  });
}

/**
 * 按讚／取消按讚。
 *
 * 同一人重複按讚 MUST NOT 累加（唯一鍵擋下），故先問狀態再決定要不要動計數；
 * 回應一律是**當下的真實狀態**而非請求所宣稱的狀態 —— 冪等的回應才讓客戶端
 * 在重送之後仍看得到對的數字（FR-024）。
 */
export async function like(
  userId: string,
  reviewId: string,
  on: boolean
): Promise<{ likeCount: number; likedByMe: boolean }> {
  const row = await findReviewOwner(reviewId);
  if (!row) {
    throw new ServiceError('NOT_FOUND', '找不到這則評論');
  }

  await withTransaction(async (tx) => {
    if (on) {
      if (await reviewLikeExists(reviewId, userId, tx)) return;
      await createReviewLikeRow(reviewId, userId, tx);
      await adjustReviewLikeCount(reviewId, 1, tx);
      return;
    }
    const removed = await deleteReviewLikeRow(reviewId, userId, tx);
    if (removed === 0) return;
    await adjustReviewLikeCount(reviewId, -1, tx);
  });

  const item = await findReviewItem(reviewId, userId);
  if (!item) {
    throw new ServiceError('NOT_FOUND', '找不到這則評論');
  }
  return { likeCount: item.likeCount, likedByMe: item.likedByMe };
}
