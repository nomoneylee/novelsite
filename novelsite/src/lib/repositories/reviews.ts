/**
 * 評論資料存取（Reviews Repository，FEAT-4 4-B / T060）
 * =======================================================
 * 「發表一則評論」在資料上是**三件事**：`Review` 列、`Novel` 的評分重算、
 * `Novel.commentCount`。三者 MUST 能在同一個交易內被呼叫（故每一支都收選填的 `tx`）——
 * 少了重算，作品頁的平均分與實際評論對不上（US2 AC1）。
 *
 * 兩種排序共用同一支查詢，差別只在排序鍵與游標條件。**MUST NOT 用 Prisma 的
 * `cursor`/`skip`**：它只支援單一唯一欄位，承載不了「排序鍵 + id」的複合鍵，
 * 而同讚數的兩筆在跨頁時會重複或遺漏（data-model.md §6、FR-023b）。
 */
import 'server-only';
import type { ReviewItem, ReviewPage } from '@/lib/types';
import { db, type TxClient } from './tx';
import { INTERACTION_USER_SELECT, toReviewItem, type ReviewItemRow } from './mappers';
import { encodeCursor } from '@/lib/pagination/cursor';

export type ReviewSort = 'hot' | 'latest';

/** 已隱藏的評論不出現在任何讀取路徑；列表與評分重算 MUST 用同一個條件（否則兩個數字對不上） */
const VISIBLE = { status: 'visible' } as const;

/**
 * 讀取自己那一筆讚。**過濾式關聯**，於同一次查詢得出 `likedByMe`；
 * 未登入時整個關聯不 include，故公開讀取不因此多發查詢（契約 §1）。
 */
function likeInclude(viewerId?: string) {
  return viewerId ? { likes: { where: { userId: viewerId }, select: { userId: true } } } : {};
}

function reviewInclude(viewerId?: string) {
  return { user: { select: INTERACTION_USER_SELECT }, ...likeInclude(viewerId) };
}

/** 依排序鍵組出「這一頁之後」的條件。決勝鍵一律 `id ASC`（FR-023b） */
function cursorWhere(sort: ReviewSort, cursor?: { primary: string; id: string }) {
  if (!cursor) return {};
  if (sort === 'hot') {
    const likeCount = Number.parseInt(cursor.primary, 10);
    return {
      OR: [{ likeCount: { lt: likeCount } }, { likeCount, id: { gt: cursor.id } }],
    };
  }
  const createdAt = new Date(cursor.primary);
  return {
    OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { gt: cursor.id } }],
  };
}

function orderBy(sort: ReviewSort) {
  return sort === 'hot'
    ? ([{ likeCount: 'desc' }, { id: 'asc' }] as const)
    : ([{ createdAt: 'desc' }, { id: 'asc' }] as const);
}

export async function listReviewsPage(
  novelId: string,
  opts: { sort: ReviewSort; cursor?: { primary: string; id: string }; limit: number },
  viewerId?: string,
  tx?: TxClient
): Promise<ReviewPage> {
  const { sort, cursor, limit } = opts;

  const rows = await db(tx).review.findMany({
    where: { novelId, ...VISIBLE, ...cursorWhere(sort, cursor) },
    orderBy: [...orderBy(sort)],
    take: limit + 1,
    include: reviewInclude(viewerId),
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  return {
    items: page.map((row) => toReviewItem(row as ReviewItemRow, viewerId)),
    nextCursor:
      hasMore && last
        ? encodeCursor(sort === 'hot' ? last.likeCount : last.createdAt, last.id)
        : null,
  };
}

/**
 * 擁有權判定所需的最小資訊。
 *
 * **只回 id 與擁有者**，不回內容：呼叫端要問的是「這則存在嗎、是不是他的」，
 * 而 404 與 403 的差別正建立在「存在」這一件事上（FR-004）。
 */
export async function findReviewOwner(
  reviewId: string,
  tx?: TxClient
): Promise<{ id: string; userId: string; novelId: string } | null> {
  return db(tx).review.findUnique({
    where: { id: reviewId },
    select: { id: true, userId: true, novelId: true },
  });
}

/** 單則評論的對外形狀（寫入後回傳當下狀態，客戶端不必為此再打一次列表） */
export async function findReviewItem(
  reviewId: string,
  viewerId?: string,
  tx?: TxClient
): Promise<ReviewItem | null> {
  const row = await db(tx).review.findUnique({
    where: { id: reviewId },
    include: reviewInclude(viewerId),
  });
  return row ? toReviewItem(row as ReviewItemRow, viewerId) : null;
}

/** 建立評論。唯一鍵衝突（同一人第二次評論）由呼叫端轉譯為 CONFLICT（FR-021） */
export async function createReviewRow(
  userId: string,
  novelId: string,
  data: { rating: number; content: string },
  tx?: TxClient
): Promise<string> {
  const row = await db(tx).review.create({
    data: { userId, novelId, rating: data.rating, content: data.content },
    select: { id: true },
  });
  return row.id;
}

export async function updateReviewRow(
  reviewId: string,
  patch: { rating?: number; content?: string },
  tx?: TxClient
): Promise<void> {
  await db(tx).review.update({ where: { id: reviewId }, data: patch });
}

/**
 * **硬刪除**（FR-023）：唯一鍵自然釋放，使用者刪除後可對同一作品重新發表，
 * 且該操作不需要任何特例處理。其 `ReviewLike` 由級聯一併移除。
 */
export async function deleteReviewRow(reviewId: string, tx?: TxClient): Promise<void> {
  await db(tx).review.delete({ where: { id: reviewId } });
}

/**
 * 自評論明細重算作品評分。
 *
 * 回傳的是**真值**而非增量：以「原值 ± 這一筆」推算，任何一次遺漏或重試都會永久偏掉，
 * 而評分沒有第二個來源可以對帳。無評論時 MUST 回 `{ average: 0, count: 0 }` ——
 * 0 位評分者卻留著平均分，畫面上就是一個沒有來源的數字（FR-043a 的同一條理由）。
 */
export async function aggregateNovelRating(
  novelId: string,
  tx?: TxClient
): Promise<{ average: number; count: number }> {
  const agg = await db(tx).review.aggregate({
    where: { novelId, ...VISIBLE },
    _avg: { rating: true },
    _count: { _all: true },
  });
  const count = agg._count._all;
  return { average: count === 0 ? 0 : (agg._avg.rating ?? 0), count };
}

/** 該使用者對該評論按過讚沒有（回應為冪等的目前狀態，故先問再寫） */
export async function reviewLikeExists(
  reviewId: string,
  userId: string,
  tx?: TxClient
): Promise<boolean> {
  const row = await db(tx).reviewLike.findUnique({
    where: { reviewId_userId: { reviewId, userId } },
    select: { userId: true },
  });
  return row !== null;
}

export async function createReviewLikeRow(
  reviewId: string,
  userId: string,
  tx?: TxClient
): Promise<void> {
  await db(tx).reviewLike.create({ data: { reviewId, userId } });
}

/** 回傳實際刪除筆數（0 表示原本就沒按過） */
export async function deleteReviewLikeRow(
  reviewId: string,
  userId: string,
  tx?: TxClient
): Promise<number> {
  const result = await db(tx).reviewLike.deleteMany({ where: { reviewId, userId } });
  return result.count;
}

/** `Review.likeCount` 增減，回傳異動後的值（供端點於**同一次回應**帶回當下讚數） */
export async function adjustReviewLikeCount(
  reviewId: string,
  delta: number,
  tx?: TxClient
): Promise<number> {
  const row = await db(tx).review.update({
    where: { id: reviewId },
    data: { likeCount: { increment: delta } },
    select: { likeCount: true },
  });
  return row.likeCount;
}
