import 'server-only';
import {
  countUnread,
  createNotifications,
  getNovelNotifyRef,
  listBookshelfUserIds,
  listNotificationsPage,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/lib/repositories';
import { decodeCursor, encodeCursor } from '@/lib/pagination/cursor';
import type { NotificationItem } from '@/lib/types';
import { ServiceError } from './errors';

/**
 * 通知服務（FEAT-4 4-D / T127，contracts/internal-modules.md §1）
 * ================================================================
 * 追更通知的產生、列表與標記已讀。
 *
 * **本階段只產生 `chapter_published`**（FR-054）：其餘型別的欄位值域保留於 schema，
 * 但它們的通知對象與去重規則從未被定義過，產生了就得猜。
 */

/** 本階段唯一會被產生的通知型別 */
const CHAPTER_PUBLISHED = 'chapter_published';

/** 通知合併所需的章節最小欄位（呼叫端已完成發佈，故這裡只是要組 payload） */
export interface PublishedChapter {
  id: string;
  number: number;
  title: string;
}

/**
 * 一組章節 → **一則**通知（FR-052a）。
 *
 * 合併與否的差異完全來自呼叫端：立即發佈給 1 章、排程作業 group by `novelId` 後給 N 章。
 * 本服務**無狀態**，故「M 章仍只發 N 則」這件事的實作落點就在這裡，
 * 而不是在任何一個呼叫端 —— 呼叫端只保證「這一組是同一次發佈的」。
 *
 * 收件人為該作品的收藏者，**排除作者本人**：作者把自己的作品加進書架是常見行為，
 * 不排除的話每次更新都會通知自己「你的作品更新了」。
 *
 * 回傳實際寫入筆數（收藏者只有作者本人、或無人收藏時為 0，且**不發出空的寫入**）。
 */
export async function notifyNewChapters(
  novelId: string,
  chapters: PublishedChapter[]
): Promise<number> {
  // 排程作業重跑時的空集合：連收件人都不必查
  if (chapters.length === 0) return 0;

  const novel = await getNovelNotifyRef(novelId);
  if (!novel) return 0;

  const recipients = (await listBookshelfUserIds(novelId)).filter((id) => id !== novel.authorId);
  if (recipients.length === 0) return 0;

  // 「最新章」取**編號最大**者，而非陣列的最後一個：呼叫端給的順序不保證，
  // 而補發舊章時照順序取會把通知標題指到舊章節（與 `getLatestPublishedChapterId` 同一判準）
  const latest = chapters.reduce((max, ch) => (ch.number > max.number ? ch : max), chapters[0]);

  // payload MUST 為 JSON **字串**（data-model.md §2.8，雙軌相容）
  const payload = JSON.stringify({
    novelId: novel.id,
    novelSlug: novel.slug,
    novelTitle: novel.title,
    chapterCount: chapters.length,
    latestChapterId: latest.id,
    latestChapterTitle: latest.title,
  });

  return createNotifications(
    recipients.map((userId) => ({ userId, type: CHAPTER_PUBLISHED, payload }))
  );
}

export interface NotificationListPage {
  items: NotificationItem[];
  nextCursor: string | null;
}

/** 通知列表（`createdAt DESC, id ASC`，每頁至多 20 筆） */
export async function list(
  userId: string,
  opts: { unreadOnly?: boolean; cursor?: string; limit: number }
): Promise<NotificationListPage> {
  const cursor = decodeCursorOrThrow(opts.cursor);
  const page = await listNotificationsPage(userId, {
    unreadOnly: opts.unreadOnly,
    cursor,
    limit: opts.limit,
  });

  return {
    items: page.rows,
    nextCursor: page.hasMore && page.last ? encodeCursor(page.last.createdAt, page.last.id) : null,
  };
}

/**
 * 標記已讀。`notificationId` 省略即**自己名下的全部**。
 *
 * 他人的通知與不存在的通知一律 `NOT_FOUND`（Route Handler 轉 404）——
 * 403 等於告訴呼叫者「這個識別碼是有效的，只是不是你的」，
 * 而通知識別碼可枚舉，那就成了一條確認「某人有幾則通知」的旁通道。
 *
 * 回傳的是**標記之後**的未讀數：導覽列 MUST 即時反映且 MUST NOT 快取（FR-053a），
 * 不回這個數字的話，前端只能猜或另外發一次請求。
 */
export async function markRead(
  userId: string,
  notificationId?: string
): Promise<{ unreadCount: number }> {
  const now = new Date();

  if (notificationId) {
    const owned = await markNotificationRead(userId, notificationId, now);
    if (!owned) throw new ServiceError('NOT_FOUND', '找不到這則通知');
  } else {
    await markAllNotificationsRead(userId, now);
  }

  return { unreadCount: await countUnread(userId) };
}

/** 游標解不開即 400（`decodeCursor` 對無效輸入回 `null` 而不擲出） */
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
