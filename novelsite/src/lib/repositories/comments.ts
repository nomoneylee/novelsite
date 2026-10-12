/**
 * 章節留言資料存取（Comments Repository，FEAT-4 4-B / T061）
 * ============================================================
 * 兩件事寫在型別與 where 條件裡，而不是寫在註解裡：
 *
 * 1. **被隱藏的留言在 where 條件就被排除**（`status='hidden'`）——
 *    不撈出來才不會外洩。撈出來再由上層決定要不要顯示，等於把保證交給每一個呼叫端，
 *    而只要有一個忘了，原文就從那裡漏出去（FR-030）。
 * 2. **作者向查詢一律強制帶入 `chapter.novel.authorId`** —— 即使服務層忘了檢查，
 *    資料層仍查不到他人作品下的留言（FR-032、US2 AC10）。
 */
import 'server-only';
import type { AuthorCommentPage, CommentNode, CommentThreadPage } from '@/lib/types';
import { db, type TxClient } from './tx';
import {
  INTERACTION_USER_SELECT,
  toAuthorCommentItem,
  toCommentNode,
  toCommentThread,
  type AuthorCommentRow,
  type CommentRow,
} from './mappers';
import { encodeCursor } from '@/lib/pagination/cursor';

/** 讀者端可見者：`visible` 與墓碑（`deleted`）。`hidden` MUST NOT 出現在任何讀取路徑 */
const READER_VISIBLE = { status: { not: 'hidden' } } as const;

const COMMENT_INCLUDE = { user: { select: INTERACTION_USER_SELECT } } as const;

/**
 * 章節留言的樓層查詢。
 *
 * 分頁的單位是**頂層留言**（`createdAt ASC, id ASC` 的樓層順序），回覆隨其父留言一併取回。
 * 以「全部留言」分頁的話，一則有 30 個回覆的樓會被切成兩頁，而讀者看到的是半個對話。
 * 本階段只有兩層（spec Assumptions），故回覆以一次 `in` 查詢補齊即可。
 */
export async function listChapterCommentThreads(
  chapterId: string,
  opts: { cursor?: { primary: string; id: string }; limit: number },
  viewerId?: string,
  tx?: TxClient
): Promise<CommentThreadPage> {
  const { cursor, limit } = opts;
  const client = db(tx);

  const tops = await client.comment.findMany({
    where: {
      chapterId,
      parentId: null,
      ...READER_VISIBLE,
      ...(cursor
        ? {
            OR: [
              { createdAt: { gt: new Date(cursor.primary) } },
              { createdAt: new Date(cursor.primary), id: { gt: cursor.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: limit + 1,
    include: COMMENT_INCLUDE,
  });

  const hasMore = tops.length > limit;
  const page = hasMore ? tops.slice(0, limit) : tops;
  const last = page[page.length - 1];

  const replies =
    page.length === 0
      ? []
      : await client.comment.findMany({
          where: { parentId: { in: page.map((row) => row.id) }, ...READER_VISIBLE },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          include: COMMENT_INCLUDE,
        });

  const byParent = new Map<string, CommentRow[]>();
  for (const reply of replies) {
    const bucket = byParent.get(reply.parentId ?? '');
    if (bucket) bucket.push(reply);
    else byParent.set(reply.parentId ?? '', [reply]);
  }

  return {
    items: page.map((row) => toCommentThread(row, byParent.get(row.id) ?? [], viewerId)),
    nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

/**
 * 擁有權判定所需的最小資訊（含所屬作品，供 `Novel.commentCount` 增減用）。
 * **不回內容**：呼叫端要問的是「存在嗎、是不是他的」，那正是 404 與 403 的分界（FR-004）。
 */
export async function findCommentOwner(
  commentId: string,
  tx?: TxClient
): Promise<{ id: string; userId: string; status: string; novelId: string } | null> {
  const row = await db(tx).comment.findUnique({
    where: { id: commentId },
    select: { id: true, userId: true, status: true, chapter: { select: { novelId: true } } },
  });
  return row
    ? { id: row.id, userId: row.userId, status: row.status, novelId: row.chapter.novelId }
    : null;
}

/**
 * 回覆對象的所屬章節、狀態與**它自己的父留言**。
 * 服務層據此拒絕跨章節與回覆墓碑（FR-025），並把「對回覆的回覆」收攏回同一串 ——
 * 本階段只有兩層，第三層要嘛被拒、要嘛悄悄變成看不見的巢狀，前者對讀者更難解釋。
 */
export async function findCommentParent(
  parentId: string,
  tx?: TxClient
): Promise<{ chapterId: string; status: string; parentId: string | null } | null> {
  return db(tx).comment.findUnique({
    where: { id: parentId },
    select: { chapterId: true, status: true, parentId: true },
  });
}

export async function createCommentRow(
  userId: string,
  chapterId: string,
  data: { content: string; parentId?: string },
  tx?: TxClient
): Promise<CommentNode> {
  const row = await db(tx).comment.create({
    data: { userId, chapterId, content: data.content, parentId: data.parentId ?? null },
    include: COMMENT_INCLUDE,
  });
  return toCommentNode(row, userId);
}

/**
 * 墓碑化。**MUST NOT 改用 `delete`** —— `Comment.parent` 為級聯刪除，
 * 硬刪除會連坐刪光他人掛在下面的回覆，等於用「刪除自己的內容」抹掉別人說過的話（FR-027）。
 */
export async function markCommentDeleted(commentId: string, tx?: TxClient): Promise<void> {
  await db(tx).comment.update({ where: { id: commentId }, data: { status: 'deleted' } });
}

/**
 * 作者的隱藏／取消隱藏。**簽章中不存在 `content`** —— 隱藏不是竄改（FR-031），
 * 這個約束寫在型別裡而非文件裡。
 */
export async function setCommentHidden(
  commentId: string,
  hidden: boolean,
  tx?: TxClient
): Promise<void> {
  await db(tx).comment.update({
    where: { id: commentId },
    data: { status: hidden ? 'hidden' : 'visible' },
  });
}

/** 該留言存在嗎（不帶擁有者條件）。404 與 403 的分界只需要這一個事實 */
export async function commentExists(commentId: string, tx?: TxClient): Promise<boolean> {
  const row = await db(tx).comment.findUnique({ where: { id: commentId }, select: { id: true } });
  return row !== null;
}

/** 該留言是否在此作者的作品之下。`authorId` **由資料層強制帶入**，非選填條件（FR-032） */
export async function authorOwnsComment(
  authorId: string,
  commentId: string,
  tx?: TxClient
): Promise<boolean> {
  const row = await db(tx).comment.findFirst({
    where: { id: commentId, chapter: { novel: { authorId } } },
    select: { id: true },
  });
  return row !== null;
}

/**
 * 作者的留言管理列表（`createdAt DESC, id ASC`）。
 *
 * 墓碑不列入：使用者已刪除的內容沒有可管理的對象，列出來只會讓作者對著一句
 * 「此留言已刪除」按隱藏。`hidden` 未指定時同時列出可見與已隱藏者，供切換用。
 */
export async function listAuthorCommentsPage(
  authorId: string,
  opts: {
    novelId?: string;
    hidden?: boolean;
    cursor?: { primary: string; id: string };
    limit: number;
  },
  tx?: TxClient
): Promise<AuthorCommentPage> {
  const { novelId, hidden, cursor, limit } = opts;

  const rows = await db(tx).comment.findMany({
    where: {
      chapter: { novel: { authorId }, ...(novelId ? { novelId } : {}) },
      status: hidden === undefined ? { not: 'deleted' } : hidden ? 'hidden' : 'visible',
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
    include: {
      ...COMMENT_INCLUDE,
      chapter: { select: { id: true, title: true, novel: { select: { id: true, title: true } } } },
    },
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  return {
    items: page.map((row) => toAuthorCommentItem(row as AuthorCommentRow)),
    nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}
