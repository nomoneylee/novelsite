import 'server-only';
import {
  withTransaction,
  adjustNovelCommentCount,
  authorOwnsComment,
  commentExists,
  createCommentRow,
  findCommentOwner,
  findCommentParent,
  getChapterVisibility,
  listAuthorCommentsPage,
  listChapterCommentThreads,
  markCommentDeleted,
  setCommentHidden,
} from '@/lib/repositories';
import type { AuthorCommentPage, CommentNode, CommentThreadPage } from '@/lib/types';
import { decodeCursor } from '@/lib/pagination/cursor';
import { enforceInteractionQuota } from '@/lib/auth/rateLimit';
import { ServiceError } from './errors';

/**
 * 章節留言服務（FEAT-4 4-B / T065，contracts/internal-modules.md §1）
 * ====================================================================
 * 三個約束在本檔各佔一支函式，且都不是慣例而是硬規則：
 *
 * - `softDelete` **MUST NOT 呼叫 `delete`** —— `Comment.parent` 為級聯，
 *   硬刪除會連坐刪光他人掛在下面的回覆（FR-027、US2 AC11）。
 * - `setHidden` 的**簽章中不存在 `content`** —— 作者可以隱藏，不可以改寫（FR-031）。
 * - `create` 與 `softDelete` MUST 於**同一交易**內維護 `Novel.commentCount`（+1／−1）。
 *   兩者 MUST 成對：只減不加會讓計數走負，而「使用者的動作立即反映」（FR-038a）
 *   在留言路徑上就恆假，且要等到隔日彙總的校正才被蓋回去。
 *
 * **本檔 MUST NOT 提供任何留言按讚的方法**（spec Out of Scope）——
 * `Comment.likeCount` 本階段無寫入路徑，值恆為 0。
 */

function parseCursor(raw?: string): { primary: string; id: string } | undefined {
  if (!raw) return undefined;
  const cursor = decodeCursor(raw);
  if (!cursor) {
    throw new ServiceError('VALIDATION_ERROR', '游標格式不正確', {
      fields: { cursor: '游標格式不正確' },
    });
  }
  return cursor;
}

/** 讀者可見的章節：已發佈者對所有人公開（FR-026），未發佈者只有作品的作者看得到 */
async function requireReadableChapter(
  chapterId: string,
  viewerId?: string
): Promise<{ novelId: string }> {
  const chapter = await getChapterVisibility(chapterId);
  if (!chapter || (chapter.status !== 'published' && chapter.authorId !== viewerId)) {
    throw new ServiceError('NOT_FOUND', '找不到這個章節');
  }
  return { novelId: chapter.novelId };
}

export async function listByChapter(
  chapterId: string,
  opts: { cursor?: string; limit: number },
  viewerId?: string
): Promise<CommentThreadPage> {
  await requireReadableChapter(chapterId, viewerId);
  return listChapterCommentThreads(
    chapterId,
    { cursor: parseCursor(opts.cursor), limit: opts.limit },
    viewerId
  );
}

/**
 * 發表留言。
 *
 * `parentId` 的父留言 MUST 屬於**同一章節**且非墓碑（FR-025）——
 * 前者擋掉「把回覆掛到別章去」，後者是伺服器端的規則而非畫面上的旗標：
 * `canReply: false` 只給前端看的話，直接送 HTTP 就能繞過。
 *
 * 對回覆的回覆收攏回同一串（本階段只有兩層，spec Assumptions）：
 * 掛到祖父之下，而不是靜靜長出第三層讓畫面呈現不出來。
 */
export async function create(
  userId: string,
  chapterId: string,
  input: { content: string; parentId?: string }
): Promise<CommentNode> {
  await enforceInteractionQuota(userId);

  const chapter = await getChapterVisibility(chapterId);
  if (!chapter || chapter.status !== 'published') {
    throw new ServiceError('NOT_FOUND', '找不到這個章節');
  }

  let parentId = input.parentId;
  if (parentId) {
    const parent = await findCommentParent(parentId);
    if (!parent || parent.chapterId !== chapterId) {
      throw new ServiceError('VALIDATION_ERROR', '找不到要回覆的留言', {
        fields: { parentId: '找不到要回覆的留言' },
      });
    }
    if (parent.status !== 'visible') {
      throw new ServiceError('VALIDATION_ERROR', '這則留言已無法回覆', {
        fields: { parentId: '這則留言已無法回覆' },
      });
    }
    parentId = parent.parentId ?? parentId;
  }

  return withTransaction(async (tx) => {
    const comment = await createCommentRow(userId, chapterId, { ...input, parentId }, tx);
    await adjustNovelCommentCount(chapter.novelId, 1, tx);
    return comment;
  });
}

/**
 * 刪除自己的留言 → **墓碑**（`status='deleted'`，保留該列）。
 *
 * 已是墓碑時直接返回：重送同一個刪除請求 MUST NOT 讓 `commentCount` 再扣一次，
 * 而網路重試本來就會產生第二次請求。
 */
export async function softDelete(userId: string, commentId: string): Promise<void> {
  const row = await findCommentOwner(commentId);
  if (!row) {
    throw new ServiceError('NOT_FOUND', '找不到這則留言');
  }
  if (row.userId !== userId) {
    throw new ServiceError('FORBIDDEN', '只能刪除自己的留言');
  }
  if (row.status === 'deleted') return;

  await withTransaction(async (tx) => {
    await markCommentDeleted(commentId, tx);
    await adjustNovelCommentCount(row.novelId, -1, tx);
  });
}

/** 作者的留言管理列表。`authorId` 由資料層強制帶入，服務層不另拼條件（FR-032） */
export async function listForAuthor(
  authorId: string,
  opts: { novelId?: string; hidden?: boolean; cursor?: string; limit: number }
): Promise<AuthorCommentPage> {
  return listAuthorCommentsPage(authorId, {
    novelId: opts.novelId,
    hidden: opts.hidden,
    cursor: parseCursor(opts.cursor),
    limit: opts.limit,
  });
}

/**
 * 隱藏／取消隱藏。**只寫 `status`**（FR-031）。
 *
 * 「這則留言不存在」與「這則留言不在你的作品下」是兩個不同的答案：前者 404、後者 403。
 * 對他人作品下的留言執行管理操作 MUST 被拒絕且資料未變更（FR-032、US2 AC10）。
 */
export async function setHidden(
  authorId: string,
  commentId: string,
  hidden: boolean
): Promise<void> {
  if (!(await commentExists(commentId))) {
    throw new ServiceError('NOT_FOUND', '找不到這則留言');
  }
  if (!(await authorOwnsComment(authorId, commentId))) {
    throw new ServiceError('FORBIDDEN', '只能管理自己作品下的留言');
  }
  await setCommentHidden(commentId, hidden);
}
