/**
 * 通知資料存取（Notifications Repository，FEAT-4 4-D / T122）
 * ============================================================
 * `Notification` 的唯一存取點：批次建立、游標列表、未讀計數、標記已讀與保留期清理。
 *
 * **一律以 `userId` 為查詢條件的第一格**：通知是使用者名下的資料，
 * 「先查出來再比對是不是自己的」那條路徑遲早會漏掉一次比對，
 * 而漏掉的那一次不會有症狀 —— 直到有人把別人的通知標成已讀。
 */
import 'server-only';
import { prisma } from '@/lib/db';
import type { NotificationItem } from '@/lib/types';
import { toNotificationItem } from './mappers';
import { db, type TxClient } from './tx';

/** 列表每頁筆數的上限（FR-053；驗證層另以 1–20 擋住查詢字串） */
export const NOTIFICATION_PAGE_MAX = 20;

export interface NotificationRowInput {
  userId: string;
  type: string;
  /**
   * **MUST 為 JSON 字串**（data-model.md §2.8）。型別寫死成 `string` 是刻意的：
   * 傳物件進來時，SQLite 軌要到寫入當下才失敗，而那時的錯誤訊息只會說型別不符。
   */
  payload: string;
}

/**
 * 批次建立通知，回傳實際寫入筆數。
 *
 * **一次 `createMany`**：逐位收藏者各發一次 `create`，一部有 500 位收藏者的作品
 * 在發佈時就是 500 次往返 —— 而發佈是每次更新都要跑的路徑。
 */
export async function createNotifications(
  rows: NotificationRowInput[],
  tx?: TxClient
): Promise<number> {
  if (rows.length === 0) return 0;
  const result = await db(tx).notification.createMany({ data: rows });
  return result.count;
}

export interface NotificationPage {
  items: NotificationItem[];
  nextCursor: string | null;
}

/**
 * 通知列表的游標分頁（`createdAt DESC, id ASC`）。
 *
 * 游標條件寫成 `OR: [{ createdAt: { lt } }, { createdAt: eq, id: { gt } }]`，
 * **MUST NOT 用 Prisma 的 `cursor`/`skip`** —— 同一毫秒建立的兩則（追更通知正是
 * 一次批次寫入 N 則，時間戳大量重複）會重複出現或整批消失。
 */
export async function listNotificationsPage(
  userId: string,
  opts: { unreadOnly?: boolean; cursor?: { primary: string; id: string }; limit: number },
  tx?: TxClient
): Promise<{ rows: NotificationItem[]; hasMore: boolean; last?: { createdAt: Date; id: string } }> {
  const { cursor, limit, unreadOnly } = opts;
  const rows = await db(tx).notification.findMany({
    where: {
      userId,
      ...(unreadOnly ? { readAt: null } : {}),
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
    select: { id: true, type: true, payload: true, readAt: true, createdAt: true },
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  return {
    rows: page.map(toNotificationItem),
    hasMore,
    last: last ? { createdAt: last.createdAt, id: last.id } : undefined,
  };
}

/** 未讀數。導覽列**不走這一支**（那條路徑經 `usersRepo.findByIdWithUnread` 同一次往返取回） */
export async function countUnread(userId: string, tx?: TxClient): Promise<number> {
  return db(tx).notification.count({ where: { userId, readAt: null } });
}

/**
 * 單筆標記已讀。**條件同時帶 `id` 與 `userId`**，回傳是否真的動到一列 ——
 * 他人的通知因而寫不進去，且呼叫端拿到 `false` 後回 404
 * （不以狀態碼區分「不存在」與「他人的」，contracts §3）。
 *
 * 已讀者再次標記不覆寫 `readAt`（`readAt: null` 在條件裡）：時間戳是「第一次讀到」，
 * 重複點擊不該把它往後推。
 */
export async function markNotificationRead(
  userId: string,
  notificationId: string,
  at: Date,
  tx?: TxClient
): Promise<boolean> {
  const result = await db(tx).notification.updateMany({
    where: { id: notificationId, userId, readAt: null },
    data: { readAt: at },
  });
  if (result.count > 0) return true;

  // 已經是已讀的自己的通知：不是錯誤，但也沒有新的寫入
  const own = await db(tx).notification.findFirst({
    where: { id: notificationId, userId },
    select: { id: true },
  });
  return own !== null;
}

/** 全部標記已讀（範圍是**自己名下**，不是整張表） */
export async function markAllNotificationsRead(
  userId: string,
  at: Date,
  tx?: TxClient
): Promise<number> {
  const result = await db(tx).notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: at },
  });
  return result.count;
}

/**
 * 保留期清理（FR-053，預設 90 天）。呼叫端為 `statsService.rollupDaily` 的清理段 ——
 * 三個保留期的清理集中在同一個作業內，接漏一個時只需看一個地方（arch.md §10.3）。
 */
export async function purgeNotificationsOlderThan(cutoff: Date): Promise<number> {
  const result = await prisma.notification.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return result.count;
}
