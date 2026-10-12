/**
 * 作者後台資料存取（Authors Repository）
 * ==========================================
 * 資料來源為公開內容表本身：`Novel`（`authorId` + `status`）與 `Chapter` + `ChapterContent`
 * （`status='draft'`）。作者專用的重複資料表已於 FEAT-2 2-C 刪除（FR-017）。
 *
 * **每個函式的 `authorId` 一律必填**（FR-019）：忘記帶擁有者條件會在編譯期就被擋下，
 * 而不是等到執行期才發現越權。本檔 MUST NOT 匯出任何無擁有者條件的作者查詢。
 */
import 'server-only';
import { prisma } from '@/lib/db';
import type {
  AuthorWorkSummary,
  AuthorChapterSummary,
  AuthorSummary,
  AuthorNovelManage,
  AuthorManageChapter,
  NovelStatus,
} from '@/lib/types';

/**
 * 作者側的作品狀態由兩個 DB 欄位遞補（data-model §3.1）：
 * 發佈狀態 `Novel.status`（draft｜published）優先，已發佈者再看連載狀態 `serialStatus`。
 */
function toWorkStatus(status: string, serialStatus: string): NovelStatus {
  if (status === 'draft') return 'draft';
  return serialStatus === 'hiatus' ? 'hiatus' : 'published';
}

/** 日期 → `YYYY-MM-DD`（作者後台的日期欄位對外格式，與公開頁一致） */
function toDateOnly(value: Date | null): string {
  return value ? value.toISOString().slice(0, 10) : '';
}

/** 作者作品列表（依上架時間新→舊）；只回該作者擁有的作品 */
export async function getAuthorWorks(authorId: string): Promise<AuthorWorkSummary[]> {
  const rows = await prisma.novel.findMany({
    where: { authorId },
    orderBy: { publishedAt: 'desc' },
    include: { categoryRel: { select: { label: true } } },
  });

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    coverColor: row.coverColor,
    category: row.categoryRel.label,
    status: toWorkStatus(row.status, row.serialStatus),
    chapterCount: row.chapterCount,
    wordCount: row.wordCount,
    totalViews: row.totalViews,
    favoriteCount: row.favoriteCount,
    commentCount: row.commentCount,
    // Novel 無「最後編輯時間」欄位（寫入流屬 FEAT-3），本階段以上架日期呈現
    updatedAt: toDateOnly(row.publishedAt),
  }));
}

/** Chapter + ChapterContent → 作者側章節摘要 */
function toChapterSummary(row: {
  id: string;
  novelId: string;
  number: number;
  title: string;
  status: string;
  scheduledAt: Date | null;
  novel: { title: string };
  content: { bodyMarkdown: string; updatedAt: Date } | null;
}): AuthorChapterSummary {
  return {
    id: row.id,
    novelId: row.novelId,
    novelTitle: row.novel.title,
    number: row.number,
    title: row.title,
    contentMarkdown: row.content?.bodyMarkdown ?? '',
    status: row.status as AuthorChapterSummary['status'],
    updatedAt: toDateOnly(row.content?.updatedAt ?? null),
    // 完整 ISO 而非 `YYYY-MM-DD`：排程的意義在「幾點」，只給日期時作者無從確認
    scheduledAt: row.scheduledAt ? row.scheduledAt.toISOString() : null,
  };
}

const CHAPTER_SUMMARY_INCLUDE = {
  novel: { select: { title: true } },
  content: { select: { bodyMarkdown: true, updatedAt: true } },
} as const;

// 註（FEAT-3 T093）：原本的 `getAuthorDraftChapters()`／`getAuthorDraftChapter()`
// （FEAT-2 的草稿列表與草稿單筆查詢）已刪除。T052 把編輯器改用不限狀態的
// `getAuthorChapterForEdit` 之後，`src/` 內就再也沒有呼叫端，只剩型別契約測試在引用 ——
// 而「只為了讓一個測試有東西可 import 而留著的資料存取函式」，看起來與服役中的 API
// 毫無差別。FR-019 的型別強制改由 `getAuthorChapterForEdit` 承接（同樣是 authorId 必填）。

/**
 * 編輯器用的單一章節（**不限狀態**），擁有者條件經 `novel.authorId` 過濾。
 *
 * **不限狀態是刻意的**：FR-013 要求已發佈章節也能回編輯器修改
 * （控制項改為「儲存／下架此章」），只查草稿的話作者一發佈就再也編不到自己的稿。
 *
 * 另回傳 `novelId`／`novelTitle`，供編輯器的「返回作品管理」指向
 * `/author/novels/{novelId}`（FR-012b）。
 */
export async function getAuthorChapterForEdit(
  authorId: string,
  chapterId: string
): Promise<AuthorChapterSummary | null> {
  const row = await prisma.chapter.findFirst({
    where: { id: chapterId, novel: { authorId } },
    include: CHAPTER_SUMMARY_INCLUDE,
  });
  return row ? toChapterSummary(row) : null;
}

/**
 * 擁有權判定（FR-004 的資料層依據）：該作品是否存在**且**屬於該作者。
 *
 * 回傳單一布林是刻意的 —— 「不存在」與「屬於別人」MUST NOT 被呼叫端區分開，
 * 兩者一旦回不同的值，守衛就有辦法（也就必然有人）把它們渲染成不同的錯誤，
 * 而那正好把「這個 id 存在」洩漏給非擁有者。
 */
export async function novelBelongsToAuthor(authorId: string, novelId: string): Promise<boolean> {
  const row = await prisma.novel.findFirst({
    where: { id: novelId, authorId },
    select: { id: true },
  });
  return row !== null;
}

/**
 * 作品管理頁的完整資料（FR-012a）；**非擁有者一律回 `null`**。
 *
 * 與公開查詢的關鍵差異：卷內章節**不加 `status` 條件** —— 管理頁本來就要看得到草稿。
 * 正因為如此，擁有者條件 MUST 寫在 `where` 裡而不是取回後再過濾：
 * 少了它，這個函式就是一個「輸入任意作品識別碼即可讀到別人草稿」的端點。
 */
export async function getAuthorNovelManage(
  authorId: string,
  novelId: string
): Promise<AuthorNovelManage | null> {
  const row = await prisma.novel.findFirst({
    where: { id: novelId, authorId },
    include: {
      categoryRel: { select: { label: true } },
      tags: { select: { tagId: true } },
      volumes: {
        orderBy: { number: 'asc' },
        include: {
          chapters: {
            orderBy: { number: 'asc' },
            include: { content: { select: { updatedAt: true } } },
          },
        },
      },
    },
  });
  if (!row) return null;

  return {
    id: row.id,
    title: row.title,
    excerpt: row.excerpt,
    description: row.description,
    categoryId: row.categoryId,
    category: row.categoryRel.label,
    coverColor: row.coverColor,
    status: row.status as AuthorNovelManage['status'],
    serialStatus: row.serialStatus as AuthorNovelManage['serialStatus'],
    tagIds: row.tags.map((t) => t.tagId),
    wordCount: row.wordCount,
    chapterCount: row.chapterCount,
    volumes: row.volumes.map((v) => ({
      id: v.id,
      number: v.number,
      title: v.title,
      chapters: v.chapters.map((ch) => ({
        id: ch.id,
        number: ch.number,
        title: ch.title,
        status: ch.status as AuthorManageChapter['status'],
        wordCount: ch.wordCount,
        updatedAt: toDateOnly(ch.content?.updatedAt ?? null),
      })),
    })),
  };
}

/** 作者整體數據匯總；只聚合該作者擁有的作品 */
export async function getAuthorSummary(authorId: string): Promise<AuthorSummary> {
  const agg = await prisma.novel.aggregate({
    where: { authorId },
    _sum: { totalViews: true, favoriteCount: true, commentCount: true },
    _count: { _all: true },
  });

  return {
    totalViews: agg._sum.totalViews ?? 0,
    totalFavorites: agg._sum.favoriteCount ?? 0,
    totalComments: agg._sum.commentCount ?? 0,
    totalNovels: agg._count._all,
  };
}
