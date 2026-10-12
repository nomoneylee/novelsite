import 'server-only';
import { prisma } from '@/lib/db';
import { taipeiDayStart, taipeiDaysBetween, taipeiDateString } from '@/lib/time/taipeiDay';
import type { TxClient } from './tx';
import type {
  AdminUserRow,
  AdminNovelRow,
  AdminChapterRow,
  AdminTagRow,
  AdminDailyTrendPoint,
  AdminCategoryDistribution,
  NovelStatus,
  ChapterStatus,
} from '@/lib/types';

/**
 * 管理後台資料存取模組（FEAT-9 / 009-admin-dashboard）
 * =======================================================
 * 所有操作依憲章第 III 條標註 import 'server-only'，且經 repositories barrel 匯出。
 */

// ─────────────────────────────────────────────
// §1 使用者管理資料存取
// ─────────────────────────────────────────────

export interface ListUsersFilter {
  search?: string;
  role?: 'reader' | 'author' | 'admin';
  isSuspended?: boolean;
}

export async function listUsers(
  filter: ListUsersFilter = {},
  cursor?: string,
  limit = 20
): Promise<{ items: AdminUserRow[]; nextCursor: string | null; totalCount: number }> {
  const where: Record<string, unknown> = {};

  if (filter.role) {
    where.role = filter.role;
  }
  if (filter.isSuspended !== undefined) {
    where.isSuspended = filter.isSuspended;
  }
  if (filter.search) {
    const term = filter.search.trim();
    where.OR = [
      { name: { contains: term } },
      { email: { contains: term } },
      { penName: { contains: term } },
    ];
  }

  const [totalCount, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      take: limit + 1,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: {
            novels: true,
            comments: true,
          },
        },
      },
    }),
  ]);

  const hasNext = users.length > limit;
  const itemsSlice = hasNext ? users.slice(0, limit) : users;
  const nextCursor = hasNext ? itemsSlice[itemsSlice.length - 1].id : null;

  const items: AdminUserRow[] = itemsSlice.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role as 'reader' | 'author' | 'admin',
    isSuspended: u.isSuspended,
    suspendedAt: u.suspendedAt ? u.suspendedAt.toISOString() : null,
    penName: u.penName,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
    novelCount: u._count.novels,
    commentCount: u._count.comments,
  }));

  return { items, nextCursor, totalCount };
}

export async function getUserById(id: string) {
  return prisma.user.findUnique({
    where: { id },
    include: {
      _count: {
        select: {
          novels: true,
          comments: true,
          reviews: true,
        },
      },
    },
  });
}

/** 停權 / 復權使用者：同一交易更新狀態並撤銷所有 Session */
export async function setUserSuspension(
  id: string,
  isSuspended: boolean,
  tx?: TxClient
): Promise<void> {
  const client = tx ?? prisma;
  await client.user.update({
    where: { id },
    data: {
      isSuspended,
      suspendedAt: isSuspended ? new Date() : null,
    },
  });

  if (isSuspended) {
    // 立即撤銷該使用者所有 Session（強制登出）
    await client.session.deleteMany({
      where: { userId: id },
    });
  }
}

/** 變更使用者角色並撤銷所有 Session */
export async function setUserRole(
  id: string,
  role: 'reader' | 'author' | 'admin',
  tx?: TxClient
): Promise<void> {
  const client = tx ?? prisma;
  await client.user.update({
    where: { id },
    data: { role },
  });

  // 撤銷全部 Session，迫使客戶端重新登入以反映新角色
  await client.session.deleteMany({
    where: { userId: id },
  });
}

/** 統計啟用中的管理員數量（用於最後一位管理員防呆） */
export async function countActiveAdmins(tx?: TxClient): Promise<number> {
  const client = tx ?? prisma;
  return client.user.count({
    where: {
      role: 'admin',
      isSuspended: false,
    },
  });
}

// ─────────────────────────────────────────────
// §2 內容管理資料存取
// ─────────────────────────────────────────────

export interface ListNovelsFilter {
  search?: string;
  categoryId?: string;
  status?: string;
}

export async function listNovelsForAdmin(
  filter: ListNovelsFilter = {},
  cursor?: string,
  limit = 20
): Promise<{ items: AdminNovelRow[]; nextCursor: string | null; totalCount: number }> {
  const where: Record<string, unknown> = {};

  if (filter.categoryId) {
    where.categoryId = filter.categoryId;
  }
  if (filter.status) {
    where.status = filter.status;
  }
  if (filter.search) {
    const term = filter.search.trim();
    where.OR = [
      { title: { contains: term } },
      { author: { name: { contains: term } } },
      { author: { penName: { contains: term } } },
    ];
  }

  const [totalCount, novels] = await Promise.all([
    prisma.novel.count({ where }),
    prisma.novel.findMany({
      where,
      take: limit + 1,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: { updatedAt: 'desc' },
      include: {
        author: { select: { name: true, penName: true } },
        categoryRel: { select: { label: true } },
      },
    }),
  ]);

  const hasNext = novels.length > limit;
  const itemsSlice = hasNext ? novels.slice(0, limit) : novels;
  const nextCursor = hasNext ? itemsSlice[itemsSlice.length - 1].id : null;

  const items: AdminNovelRow[] = itemsSlice.map((n) => ({
    id: n.id,
    title: n.title,
    authorId: n.authorId,
    authorName: n.author.penName ?? n.author.name,
    category: n.categoryRel.label,
    categoryId: n.categoryId,
    status: n.status as NovelStatus,
    serialStatus: n.serialStatus as 'ongoing' | 'completed' | 'hiatus',
    chapterCount: n.chapterCount,
    wordCount: n.wordCount,
    totalViews: n.totalViews,
    favoriteCount: n.favoriteCount,
    commentCount: n.commentCount,
    updatedAt: n.updatedAt.toISOString(),
    publishedAt: n.publishedAt.toISOString(),
  }));

  return { items, nextCursor, totalCount };
}

export async function getNovelById(novelId: string, tx?: TxClient) {
  const client = tx ?? prisma;
  return client.novel.findUnique({
    where: { id: novelId },
  });
}

export async function setNovelStatus(
  novelId: string,
  status: 'draft' | 'published' | 'admin_suspended',
  tx?: TxClient
): Promise<void> {
  const client = tx ?? prisma;
  await client.novel.update({
    where: { id: novelId },
    data: { status, updatedAt: new Date() },
  });
}

export async function deleteNovelCascade(novelId: string, tx?: TxClient): Promise<void> {
  const client = tx ?? prisma;
  await client.novel.delete({
    where: { id: novelId },
  });
}

export async function getChapterById(chapterId: string, tx?: TxClient) {
  const client = tx ?? prisma;
  return client.chapter.findUnique({
    where: { id: chapterId },
    select: { id: true, novelId: true, number: true, title: true, status: true, wordCount: true },
  });
}

export async function listChaptersForAdmin(novelId: string): Promise<AdminChapterRow[]> {
  const chapters = await prisma.chapter.findMany({
    where: { novelId },
    orderBy: { number: 'asc' },
    include: {
      _count: { select: { comments: true } },
      novel: { select: { title: true } },
    },
  });

  return chapters.map((c) => ({
    id: c.id,
    novelId: c.novelId,
    novelTitle: c.novel.title,
    number: c.number,
    title: c.title,
    wordCount: c.wordCount,
    status: c.status as ChapterStatus,
    publishedAt: c.publishedAt ? c.publishedAt.toISOString() : null,
    scheduledAt: c.scheduledAt ? c.scheduledAt.toISOString() : null,
    commentCount: c._count.comments,
  }));
}

export async function setChapterStatus(
  chapterId: string,
  status: 'draft' | 'published' | 'admin_suspended',
  tx?: TxClient
): Promise<void> {
  const client = tx ?? prisma;
  await client.chapter.update({
    where: { id: chapterId },
    data: { status },
  });
}

export async function deleteChapterAndRecount(
  chapterId: string,
  novelId: string,
  tx?: TxClient
): Promise<{ wordCount: number; chapterCount: number }> {
  const client = tx ?? prisma;

  // 刪除章節（正文與留言隨外鍵級聯刪除）
  await client.chapter.delete({
    where: { id: chapterId },
  });

  // 聚合重算作品總字數與章節數
  const agg = await client.chapter.aggregate({
    where: { novelId },
    _sum: { wordCount: true },
    _count: { id: true },
  });

  const wordCount = agg._sum.wordCount ?? 0;
  const chapterCount = agg._count.id;

  await client.novel.update({
    where: { id: novelId },
    data: {
      wordCount,
      chapterCount,
      updatedAt: new Date(),
    },
  });

  return { wordCount, chapterCount };
}

export async function hideComment(commentId: string, tx?: TxClient): Promise<void> {
  const client = tx ?? prisma;
  await client.comment.update({
    where: { id: commentId },
    data: { status: 'hidden' },
  });
}

export async function deleteComment(commentId: string, tx?: TxClient): Promise<void> {
  const client = tx ?? prisma;
  // 章節留言依架構規範採墓碑刪除（status='deleted'），保留樓層階層
  await client.comment.update({
    where: { id: commentId },
    data: { status: 'deleted' },
  });
}

// ─────────────────────────────────────────────
// §3 標籤治理資料存取
// ─────────────────────────────────────────────

export async function listTagsWithCount(
  search?: string,
  sortBy: 'name' | 'count' = 'name',
  sortOrder: 'asc' | 'desc' = 'asc'
): Promise<AdminTagRow[]> {
  const where: Record<string, unknown> = {};
  if (search) {
    const term = search.trim();
    where.OR = [{ name: { contains: term } }, { slug: { contains: term } }];
  }

  const tags = await prisma.tag.findMany({
    where,
    include: {
      _count: { select: { novels: true } },
    },
    orderBy: sortBy === 'count' ? undefined : { name: sortOrder },
  });

  const rows: AdminTagRow[] = tags.map((t) => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    novelCount: t._count.novels,
  }));

  if (sortBy === 'count') {
    rows.sort((a, b) =>
      sortOrder === 'asc' ? a.novelCount - b.novelCount : b.novelCount - a.novelCount
    );
  }

  return rows;
}

export async function getTagWithCount(id: string): Promise<AdminTagRow | null> {
  const tag = await prisma.tag.findUnique({
    where: { id },
    include: { _count: { select: { novels: true } } },
  });
  if (!tag) return null;
  return {
    id: tag.id,
    name: tag.name,
    slug: tag.slug,
    novelCount: tag._count.novels,
  };
}

export async function createTag(
  name: string,
  slug: string,
  tx?: TxClient
): Promise<{ id: string }> {
  const client = tx ?? prisma;
  const created = await client.tag.create({
    data: { name, slug },
    select: { id: true },
  });
  return created;
}

export async function updateTagRow(
  id: string,
  data: { name?: string; slug?: string },
  tx?: TxClient
): Promise<void> {
  const client = tx ?? prisma;
  await client.tag.update({
    where: { id },
    data,
  });
}

/**
 * 合併標籤（R-11）：
 * 1. 查詢所有關聯 sourceTagId 的作品 ID
 * 2. 批次建立 targetTagId 關聯並跳過重複（skipDuplicates: true）
 * 3. 刪除 sourceTagId 關聯
 * 4. 刪除 sourceTag
 * 5. 回傳受影響作品 ID 清單
 */
export async function mergeTags(
  sourceTagId: string,
  targetTagId: string,
  tx?: TxClient
): Promise<{ affectedCount: number; affectedNovelIds: string[] }> {
  const client = tx ?? prisma;

  // 取得關聯的作品 IDs
  const sourceRelations = await client.novelTag.findMany({
    where: { tagId: sourceTagId },
    select: { novelId: true },
  });

  const novelIds = sourceRelations.map((r) => r.novelId);

  if (novelIds.length > 0) {
    const existingTargetRelations = await client.novelTag.findMany({
      where: {
        novelId: { in: novelIds },
        tagId: targetTagId,
      },
      select: { novelId: true },
    });
    const existingSet = new Set(existingTargetRelations.map((r) => r.novelId));
    const novelsToLink = novelIds.filter((id) => !existingSet.has(id));

    if (novelsToLink.length > 0) {
      await client.novelTag.createMany({
        data: novelsToLink.map((id) => ({ novelId: id, tagId: targetTagId })),
      });
    }

    await client.novelTag.deleteMany({
      where: { tagId: sourceTagId },
    });
  }

  await client.tag.delete({
    where: { id: sourceTagId },
  });

  return { affectedCount: novelIds.length, affectedNovelIds: novelIds };
}

export async function listNovelIdsByTagId(tagId: string, tx?: TxClient): Promise<string[]> {
  const client = tx ?? prisma;
  const rows = await client.novelTag.findMany({
    where: { tagId },
    select: { novelId: true },
  });
  return rows.map((r) => r.novelId);
}

export async function deleteTag(id: string, tx?: TxClient): Promise<void> {
  const client = tx ?? prisma;
  await client.novelTag.deleteMany({
    where: { tagId: id },
  });
  await client.tag.delete({
    where: { id },
  });
}

// ─────────────────────────────────────────────
// §4 營運統計與儀表板資料存取
// ─────────────────────────────────────────────

export interface AdminSiteOverviewStats {
  users: {
    total: number;
    readers: number;
    authors: number;
    admins: number;
    suspended: number;
  };
  novels: {
    total: number;
    published: number;
    draft: number;
    adminSuspended: number;
  };
  chapters: {
    total: number;
    totalWords: number;
  };
  views: {
    total: number;
  };
}

export async function getSiteStats(): Promise<AdminSiteOverviewStats> {
  const [
    totalUsers,
    readers,
    authors,
    admins,
    suspendedUsers,
    totalNovels,
    publishedNovels,
    draftNovels,
    suspendedNovels,
    totalChapters,
    novelAggregates,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { role: 'reader' } }),
    prisma.user.count({ where: { role: 'author' } }),
    prisma.user.count({ where: { role: 'admin' } }),
    prisma.user.count({ where: { isSuspended: true } }),
    prisma.novel.count(),
    prisma.novel.count({ where: { status: 'published' } }),
    prisma.novel.count({ where: { status: 'draft' } }),
    prisma.novel.count({ where: { status: 'admin_suspended' } }),
    prisma.chapter.count(),
    prisma.novel.aggregate({
      _sum: {
        wordCount: true,
        totalViews: true,
      },
    }),
  ]);

  return {
    users: {
      total: totalUsers,
      readers,
      authors,
      admins,
      suspended: suspendedUsers,
    },
    novels: {
      total: totalNovels,
      published: publishedNovels,
      draft: draftNovels,
      adminSuspended: suspendedNovels,
    },
    chapters: {
      total: totalChapters,
      totalWords: novelAggregates._sum.wordCount ?? 0,
    },
    views: {
      total: novelAggregates._sum.totalViews ?? 0,
    },
  };
}

export async function getDailyTrends(
  days: 7 | 30 = 7,
  now: Date = new Date()
): Promise<AdminDailyTrendPoint[]> {
  const DAY_MS = 24 * 3_600_000;
  const todayStart = taipeiDayStart(now);
  const startDay = new Date(todayStart.getTime() - (days - 1) * DAY_MS);
  const dayList = taipeiDaysBetween(startDay, todayStart);

  // 1. 查詢 NovelDailyStat 在此區間內的數據
  const statsRows = await prisma.novelDailyStat.findMany({
    where: {
      date: {
        gte: startDay,
        lte: todayStart,
      },
    },
    select: {
      date: true,
      views: true,
    },
  });

  const viewsByDay = new Map<string, number>();
  for (const row of statsRows) {
    const key = taipeiDateString(row.date);
    viewsByDay.set(key, (viewsByDay.get(key) ?? 0) + row.views);
  }

  // 2. 查詢 User 在此區間內註冊的數據
  const userRows = await prisma.user.findMany({
    where: {
      createdAt: {
        gte: startDay,
      },
    },
    select: {
      createdAt: true,
    },
  });

  const usersByDay = new Map<string, number>();
  for (const row of userRows) {
    const key = taipeiDateString(row.createdAt);
    usersByDay.set(key, (usersByDay.get(key) ?? 0) + 1);
  }

  // 3. 依據 dayList 建立完整時間序列，無資料處補 0
  return dayList.map((d) => {
    const key = taipeiDateString(d);
    return {
      date: key,
      views: viewsByDay.get(key) ?? 0,
      newUsers: usersByDay.get(key) ?? 0,
    };
  });
}

export async function getCategoryDistribution(): Promise<AdminCategoryDistribution[]> {
  const categories = await prisma.category.findMany({
    include: {
      novels: {
        select: {
          serialStatus: true,
        },
      },
    },
    orderBy: { sortOrder: 'asc' },
  });

  return categories.map((c) => ({
    id: c.id,
    name: c.label,
    totalNovels: c.novels.length,
    ongoingNovels: c.novels.filter((n) => n.serialStatus === 'ongoing').length,
    completedNovels: c.novels.filter((n) => n.serialStatus === 'completed').length,
  }));
}
