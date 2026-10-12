/**
 * Prisma record → 領域型別 對應（Mapper）
 * ==========================================
 * 把資料庫回傳的 row 轉換成 `src/lib/types.ts` 的領域型別，
 * 集中處理關聯遞補（作者筆名、分類 label、標籤、相關作品）與日期格式還原。
 * 唯有 repository 層會用到本檔，上層不需感知。
 */
import type {
  Novel as PNovel,
  Volume as PVolume,
  Chapter as PChapter,
  Review as PReview,
  Comment as PComment,
  Category as PCategory,
  User as PUser,
  Tag as PTag,
  NovelRelation as PNovelRelation,
  Notification as PNotification,
} from '@/generated/prisma/client';
import type {
  Novel,
  NovelDetail,
  Volume,
  Chapter,
  ReviewItem,
  CommentNode,
  CommentThread,
  AuthorCommentItem,
  Category,
  ReadingHistoryEntry,
  RankingEntryView,
  NotificationItem,
  NotificationPayload,
} from '@/lib/types';

/** 「新書」的推導窗（FR-007）：`publishedAt` 落在近 N 天者即為新書，不另存欄位 */
export const NEW_NOVEL_WINDOW_DAYS = 30;

/** 新書判定的時間下界；repository 的 where 條件與 mapper 的推導 MUST 共用本函式 */
export function newNovelThreshold(now: Date = new Date()): Date {
  return new Date(now.getTime() - NEW_NOVEL_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * 日期 → `YYYY-MM-DD`。
 *
 * MUST NOT 改用裸 `.toISOString()` —— `ChapterList.tsx` 的 `{ch.publishedAt}` 為裸渲染，
 * 輸出完整 ISO 8601 會直接改變顯示（FR-005、US1 AC 6）。
 * （原文另舉的 `ReviewSection.tsx` 已隨 4-B 改為 `ReviewItem.createdAt` 的完整 ISO，
 * 由元件自行格式化，不再經本函式。）
 */
function toDateOnly(value: Date | null | undefined): string {
  return value ? value.toISOString().slice(0, 10) : '';
}

/** 取作品清單／卡片所需的關聯，供 repository 的 findMany include 共用 */
export const NOVEL_INCLUDE = {
  author: { select: { name: true, penName: true } },
  categoryRel: { select: { label: true } },
  tags: { select: { tag: { select: { name: true } } } },
} as const;

/**
 * `NOVEL_INCLUDE` 之上再加詳情頁所需的關聯。
 * 章節 MUST 只取已發佈者（草稿不得出現在公開目錄，FR-014），且 MUST NOT include `content`
 * ——目錄查詢不載入正文大欄位（FR-010）。
 */
export const NOVEL_DETAIL_INCLUDE = {
  ...NOVEL_INCLUDE,
  // 詳情頁才需要作者簡介（FEAT-3 FR-025：來源由 Novel.authorBio 改為 User.bio）。
  // 刻意覆寫而非併入 NOVEL_INCLUDE —— 列表與卡片查詢不該為了一個不顯示的欄位多撈文字。
  author: { select: { name: true, penName: true, bio: true } },
  volumes: {
    orderBy: { number: 'asc' },
    include: { chapters: { where: { status: 'published' }, orderBy: { number: 'asc' } } },
  },
  // 註（FEAT-4 4-B）：原 `reviews` 關聯已自本 include 移除。詳情頁改由
  // `reviewService.list` 取**第一頁**（FR-023a）；留在這裡等於每次開詳情頁
  // 都把該作品的全部評論撈進來，而作品越受歡迎撈得越多。
  relations: { orderBy: { sortOrder: 'asc' } },
} as const;

export type NovelRow = PNovel & {
  author: Pick<PUser, 'name' | 'penName'>;
  categoryRel: Pick<PCategory, 'label'>;
  tags: { tag: Pick<PTag, 'name'> }[];
};

export type NovelDetailRow = NovelRow & {
  author: Pick<PUser, 'name' | 'penName' | 'bio'>;
  volumes: (PVolume & { chapters: PChapter[] })[];
  relations: Pick<PNovelRelation, 'relatedNovelId' | 'sortOrder'>[];
};

export function toNovel(row: NovelRow, now: Date = new Date()): Novel {
  const tags = row.tags.map((t) => t.tag.name);
  return {
    id: row.id,
    title: row.title,
    author: row.author.penName ?? row.author.name,
    cover: row.cover ?? undefined,
    coverColor: row.coverColor,
    category: row.categoryRel.label,
    wordCount: row.wordCount,
    chapterCount: row.chapterCount,
    rating: row.rating,
    excerpt: row.excerpt,
    tags: tags.length > 0 ? tags : undefined,
    isNew: row.publishedAt >= newNovelThreshold(now) || undefined,
    isFeatured: row.isFeatured || undefined,
    weeklyViews: row.weeklyViews || undefined,
    updateFreq: row.updateFreq ?? undefined,
  };
}

/** `isLatest` 已不是 DB 欄位，改由呼叫端判定（該作品 number 最大的章節）後傳入 */
export function toChapter(row: PChapter, isLatest = false): Chapter {
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    wordCount: row.wordCount,
    publishedAt: toDateOnly(row.publishedAt),
    isLatest: isLatest || undefined,
  };
}

export function toVolume(
  row: PVolume & { chapters: PChapter[] },
  latestChapterId?: string
): Volume {
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    chapters: row.chapters.map((ch) => toChapter(ch, ch.id === latestChapterId)),
  };
}

export function toCategory(row: PCategory): Category {
  return {
    id: row.id,
    label: row.label,
    emoji: row.emoji,
    description: row.description,
    color: row.color,
    bgColor: row.bgColor,
  };
}

/** 完整詳情（含分捲、評論、相關作品 id）；首章／最新章由章節集合推導 */
export function toNovelDetail(row: NovelDetailRow, now: Date = new Date()): NovelDetail {
  const chapters = row.volumes.flatMap((v) => v.chapters);
  const firstChapter = chapters.reduce<PChapter | null>(
    (acc, ch) => (acc === null || ch.number < acc.number ? ch : acc),
    null
  );
  const latestChapter = chapters.reduce<PChapter | null>(
    (acc, ch) => (acc === null || ch.number > acc.number ? ch : acc),
    null
  );

  return {
    ...toNovel(row, now),
    description: row.description,
    // 領域 status 為「連載狀態」，取自 serialStatus；row.status 是發佈狀態（作者側用）
    status: row.serialStatus as NovelDetail['status'],
    // 領域型別的欄位名不變（UI 零 diff），來源改為 User.bio（FEAT-3 FR-025）
    authorBio: row.author.bio,
    totalViews: row.totalViews,
    favoriteCount: row.favoriteCount,
    commentCount: row.commentCount,
    ratingCount: row.ratingCount,
    latestChapterId: latestChapter?.id ?? '',
    firstChapterId: firstChapter?.id ?? '',
    volumes: row.volumes.map((v) => toVolume(v, latestChapter?.id)),
    relatedIds: row.relations.map((r) => r.relatedNovelId),
  };
}

// ─────────────────────────────────────────────────────────────
// FEAT-4 4-A 讀者狀態（T021）
// ─────────────────────────────────────────────────────────────

/**
 * 閱讀歷史列表所需的關聯。
 *
 * **只有 `novel`，沒有 `chapter`** —— `ReadingHistory.chapterId` 刻意不設關聯
 * （章節下架不該連坐刪掉整筆歷史，data-model.md §2.4），故章節標題由 repository
 * 以一次 `in` 查詢補上並傳進本 mapper。
 */
export const READING_HISTORY_INCLUDE = {
  novel: { select: { title: true, coverColor: true } },
} as const;

export type ReadingHistoryRow = {
  novelId: string;
  chapterId: string;
  readAt: Date;
  novel: { title: string; coverColor: string };
};

/**
 * 領域 `ReadingHistoryEntry` 的形狀與未登入時的本機版本**完全相同** ——
 * `ReadingHistoryView` 因此一行都不必為「登入與否」分支（spec Assumptions）。
 *
 * 章節標題查不到時（章節已被刪除）退回一句可理解的文字，而非空字串：
 * 空字串會在列表上留下一列看不出是什麼的空白。
 */
export function toReadingHistoryEntry(
  row: ReadingHistoryRow,
  chapterTitle: string | undefined
): ReadingHistoryEntry {
  return {
    novelId: row.novelId,
    novelTitle: row.novel.title,
    coverColor: row.novel.coverColor,
    chapterId: row.chapterId,
    chapterTitle: chapterTitle ?? '章節已不存在',
    readAt: row.readAt.toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────
// FEAT-4 4-B 互動（T062）
// ─────────────────────────────────────────────────────────────

/** 使用者的顯示欄位。評論與留言只需要這兩格，MUST NOT 順手把整個 User 撈進來 */
export const INTERACTION_USER_SELECT = { name: true, avatarColor: true } as const;

/**
 * 評論列的關聯。
 *
 * `likes` 是**過濾式關聯**：登入時以 `where: { userId: viewerId }` 只取自己的那一筆，
 * 於同一次查詢得出 `likedByMe`；未登入時整個關聯不 include，故不多發任何查詢（契約 §1）。
 */
export type ReviewItemRow = PReview & {
  user: Pick<PUser, 'name' | 'avatarColor'>;
  likes?: { userId: string }[];
};

/**
 * `ReviewItem` 的組裝。
 *
 * `mine` 與 `likedByMe` 皆由**伺服器**判定：客戶端自行比對使用者識別碼的話，
 * 那個識別碼就得先送到客戶端，而它在未登入的公開頁面上沒有任何理由出現。
 */
export function toReviewItem(row: ReviewItemRow, viewerId?: string): ReviewItem {
  return {
    id: row.id,
    rating: row.rating,
    content: row.content,
    likeCount: row.likeCount,
    likedByMe: (row.likes?.length ?? 0) > 0,
    mine: viewerId !== undefined && row.userId === viewerId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    user: { name: row.user.name, avatarColor: row.user.avatarColor },
  };
}

/** 墓碑的固定文案。UI 與 API 共用同一份字串，兩邊各寫一份會在改文案時只改到一邊 */
export const COMMENT_TOMBSTONE_TEXT = '此留言已刪除';

export type CommentRow = PComment & {
  user: Pick<PUser, 'name' | 'avatarColor'>;
};

/**
 * 留言列 → 對外節點。
 *
 * **墓碑的置換在此完成**（`status='deleted'`）：`content` 換成固定文案、
 * `user` 移除、不可按讚、不可回覆。放在 mapper 而非各呼叫端，是因為它是
 * 「資料庫的列」與「回應主體」之間唯一的關口 —— 少置換一處，原文就外洩一次（FR-027）。
 *
 * `status='hidden'` **不會走到這裡**：被隱藏的留言在 repository 的 where 條件就被排除，
 * 不撈出來才不會外洩（FR-030）。
 */
export function toCommentNode(row: CommentRow, viewerId?: string): CommentNode {
  const isTombstone = row.status === 'deleted';
  return {
    id: row.id,
    content: isTombstone ? COMMENT_TOMBSTONE_TEXT : row.content,
    createdAt: row.createdAt.toISOString(),
    user: isTombstone ? null : { name: row.user.name, avatarColor: row.user.avatarColor },
    // 本階段留言按讚無後端，恆為 false（spec Out of Scope）；墓碑另外也不可回覆
    canLike: false,
    canReply: !isTombstone,
    canDelete: !isTombstone && viewerId !== undefined && row.userId === viewerId,
  };
}

/** 一個樓層：頂層留言 + 其回覆（依 `createdAt ASC, id ASC`，由 repository 排序） */
export function toCommentThread(
  row: CommentRow,
  replies: CommentRow[],
  viewerId?: string
): CommentThread {
  return {
    ...toCommentNode(row, viewerId),
    replies: replies.map((reply) => toCommentNode(reply, viewerId)),
  };
}

export type AuthorCommentRow = PComment & {
  user: Pick<PUser, 'name' | 'avatarColor'>;
  chapter: Pick<PChapter, 'id' | 'title'> & { novel: Pick<PNovel, 'id' | 'title'> };
};

/**
 * 作者向的留言列。**`content` 為原文**：作者管理的是自己作品下的真實留言，
 * 看不到原文就無從判斷該不該隱藏。隱藏與否以 `hidden` 布林表達，
 * 而 `status` 的三個值裡只有 `hidden` 對作者有意義（墓碑不列入管理清單）。
 */
export function toAuthorCommentItem(row: AuthorCommentRow): AuthorCommentItem {
  return {
    id: row.id,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
    hidden: row.status === 'hidden',
    user: { name: row.user.name, avatarColor: row.user.avatarColor },
    novelId: row.chapter.novel.id,
    novelTitle: row.chapter.novel.title,
    chapterId: row.chapter.id,
    chapterTitle: row.chapter.title,
  };
}

// ─────────────────────────────────────────────────────────────
// FEAT-4 4-D 排行與通知（T125）
// ─────────────────────────────────────────────────────────────

export type RankingEntryRow = {
  rank: number;
  score: number;
  change: string | null;
  changeCount: number | null;
  computedAt: Date;
  novel: NovelRow;
};

/**
 * 排行榜的一列。
 *
 * `change`／`changeCount` 在資料庫是可為 null 的欄位（4-D 之前的示範名次可能沒填），
 * 對外一律轉為 `undefined` —— 領域型別以「沒有這一格」表達「沒有升降資訊」，
 * 而 `null` 會讓消費端多寫一條它不需要知道的分支。
 */
export function toRankingEntryView(row: RankingEntryRow): RankingEntryView {
  return {
    rank: row.rank,
    novel: toNovel(row.novel),
    score: row.score,
    change: (row.change as RankingEntryView['change']) ?? undefined,
    changeCount: row.changeCount ?? undefined,
    computedAt: row.computedAt.toISOString(),
  };
}

export type NotificationRow = Pick<
  PNotification,
  'id' | 'type' | 'payload' | 'readAt' | 'createdAt'
>;

/**
 * 通知的一列。**`payload` 的解析只發生在這裡**：它在資料庫是 JSON 字串
 * （雙軌相容，data-model.md §2.8），讓每個消費端各自 `JSON.parse` 的話，
 * 一筆壞掉的酬載就會在畫面上變成未捕捉的例外。
 *
 * 解析失敗回空物件而非擲出 —— 通知列表少一格文字，好過整頁白掉。
 */
export function toNotificationItem(row: NotificationRow): NotificationItem {
  let payload: NotificationPayload = {};
  try {
    const parsed: unknown = JSON.parse(row.payload);
    if (parsed && typeof parsed === 'object') payload = parsed as NotificationPayload;
  } catch {
    payload = {};
  }

  return {
    id: row.id,
    type: row.type,
    payload,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}
