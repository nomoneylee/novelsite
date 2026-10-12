/**
 * 作品資料存取（Novels Repository）
 * ===================================
 * 上層透過本層取得作品資料，回傳 `src/lib/types.ts` 領域型別。
 * 換資料庫時僅需改 `src/lib/db.ts`，本層邏輯不變。
 */
import 'server-only';
import { prisma } from '@/lib/db';
import type { Novel, NovelDetail, ChapterContext, TagOption } from '@/lib/types';
import { getPublishedChapterWithContent } from './chapters';
import { db, type TxClient } from './tx';
import {
  toNovel,
  toNovelDetail,
  newNovelThreshold,
  NOVEL_INCLUDE,
  NOVEL_DETAIL_INCLUDE,
} from './mappers';

/**
 * 全站作品清單（依上架時間新→舊）。
 *
 * **只收已發佈**（research R-14、FR-037）：本函式是書庫列表、相關作品、書架與
 * 網站地圖四個公開讀取端的共同來源。FEAT-3 是第一個會產生草稿作品的階段 ——
 * 少了這個條件，作者一按「建立作品」，那部還沒寫半個字的草稿就會出現在全站書庫裡。
 */
export async function getAllNovels(): Promise<Novel[]> {
  const rows = await prisma.novel.findMany({
    where: { status: 'published' },
    orderBy: { publishedAt: 'desc' },
    include: NOVEL_INCLUDE,
  });
  return rows.map((row) => toNovel(row));
}

/**
 * 精選作品（Hero 用）。
 *
 * **決勝鍵 `updatedAt DESC, id ASC` 是必要的**（FR-043c）：FR-043a 把全站六個計數歸零後，
 * 每一部作品的熱門度都一樣，而排序鍵相同時資料庫沒有義務給出穩定的次序 ——
 * 首頁重新整理一次排列就換一種，看起來像頁面壞了。`id` 為主鍵、必然唯一，
 * 有它才構成全序；只補 `updatedAt` 仍可能同值（兩軌 seed 皆以上架時間寫入該欄）。
 */
export async function getFeaturedNovels(): Promise<Novel[]> {
  const rows = await prisma.novel.findMany({
    where: { isFeatured: true },
    orderBy: [{ weeklyViews: 'desc' }, { updatedAt: 'desc' }, { id: 'asc' }],
    include: NOVEL_INCLUDE,
  });
  return rows.map((row) => toNovel(row));
}

/** 新書清單（`publishedAt` 落在近 30 天者，依上架時間新→舊，可限制數量） */
export async function getNewNovels(limit?: number): Promise<Novel[]> {
  const rows = await prisma.novel.findMany({
    where: { publishedAt: { gte: newNovelThreshold() } },
    orderBy: { publishedAt: 'desc' },
    include: NOVEL_INCLUDE,
    ...(limit ? { take: limit } : {}),
  });
  return rows.map((row) => toNovel(row));
}

/** 依分類 label 取得作品（先查 Category，再以 categoryId 過濾；依人氣排序） */
export async function getNovelsByCategory(categoryLabel: string): Promise<Novel[]> {
  const category = await prisma.category.findFirst({ where: { label: categoryLabel } });
  if (!category) return [];

  const rows = await prisma.novel.findMany({
    where: { categoryId: category.id },
    // 決勝鍵同 `getFeaturedNovels`（FR-043c）：計數全為 0 時仍 MUST 為全序
    orderBy: [{ weeklyViews: 'desc' }, { rating: 'desc' }, { updatedAt: 'desc' }, { id: 'asc' }],
    include: NOVEL_INCLUDE,
  });
  return rows.map((row) => toNovel(row));
}

/** 各分類作品數量統計（label → count） */
export async function getCategoryCounts(): Promise<Record<string, number>> {
  const [grouped, categories] = await Promise.all([
    prisma.novel.groupBy({ by: ['categoryId'], _count: { _all: true } }),
    prisma.category.findMany({ select: { id: true, label: true } }),
  ]);

  const labelById = new Map(categories.map((c) => [c.id, c.label]));
  const result: Record<string, number> = {};
  for (const g of grouped) {
    const label = labelById.get(g.categoryId);
    if (label) result[label] = g._count._all;
  }
  return result;
}

/**
 * 取得作品詳情（**公開視角，只回已發佈**）。
 *
 * 草稿作品回 `null`，呼叫端據此 `notFound()` → 404 而非 403（US1 AC8、FR-004）：
 * 對非擁有者而言，「這部作品存在但還沒上架」本身就是不該外流的資訊。
 * 作者要看自己的草稿走的是另一條路（`getAuthorNovelManage`，帶擁有者條件），
 * 兩條路徑刻意不共用 —— 一旦共用，放寬條件的那一天就會同時放寬給所有人。
 *
 * 閱讀頁的 `getChapterContext` 也建立在本函式之上，故作品下架時章節頁一併 404。
 */
export async function getNovelDetail(id: string): Promise<NovelDetail | null> {
  const row = await prisma.novel.findFirst({
    where: { id, status: 'published' },
    include: NOVEL_DETAIL_INCLUDE,
  });
  if (!row) return null;
  return toNovelDetail(row);
}

/**
 * 依 id 陣列取得作品（**保持傳入順序**）。
 *
 * 相關推薦與**搜尋的第二步**（research R-2）共用本函式：`search.ts` 的 raw 查詢
 * 只回識別碼與排序鍵，領域型別一律經 `NOVEL_INCLUDE` + `mappers.ts` 產生。
 * 保序是必要的 —— `IN (…)` 的回傳順序不受保證，靠它就等於把 `updatedAt DESC, id ASC`
 * 這個已經算好的排序丟掉。
 *
 * **本函式不帶 `status` 條件**：搜尋的可見性條件在第一步就已成立（FR-035），
 * 相關推薦則另有自己的來源。在這裡再加一次條件不會更安全，只會讓兩個呼叫端
 * 對「誰負責過濾」的認知不一致。
 */
export async function getNovelsByIds(ids: string[]): Promise<Novel[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.novel.findMany({
    where: { id: { in: ids } },
    include: NOVEL_INCLUDE,
  });
  const map = new Map(rows.map((r) => [r.id, toNovel(r)]));
  return ids.map((id) => map.get(id)).filter((n): n is Novel => Boolean(n));
}

// 註（FEAT-3 3-A，FR-036／SC-009）：原本的 `searchNovels()` 已移除。
// 它把整張 Novel 表載入記憶體再逐筆 `includes()` 過濾（`nextstep.md` M-4）——
// 資料量小的時候看不出差別，而看得出差別的那一天已經是正式環境。
// 取代者為 `repositories/search.ts` 的資料庫層篩選（兩軌 `LIKE`／`ILIKE` + 預算欄位），
// 經 `services/searchService.ts` 對外。

// ─────────────────────────────────────────────
// 作品寫入（FEAT-3 3-B，FR-005）
//
// 作者向的更新與刪除**一律以 `authorId` 為 where 條件的一部分**：即使服務層漏檢，
// `UPDATE … WHERE id = ? AND authorId = ?` 的影響列數也會是 0，呼叫端據此轉 NOT_FOUND。
// 這是型別層之外的第二道 —— 守衛可以被忘記，SQL 的 where 不會。
// ─────────────────────────────────────────────

export interface CreateNovelRow {
  id: string;
  title: string;
  authorId: string;
  categoryId: string;
  excerpt: string;
  coverColor: string;
}

/** 建立作品（狀態固定為 draft；計數自 0 起算，由章節寫入回填） */
export async function createNovelRow(input: CreateNovelRow, tx?: TxClient): Promise<string> {
  const row = await db(tx).novel.create({
    data: {
      ...input,
      wordCount: 0,
      chapterCount: 0,
      rating: 0,
      status: 'draft',
    },
    select: { id: true },
  });
  return row.id;
}

export interface UpdateNovelRow {
  title?: string;
  categoryId?: string;
  excerpt?: string;
  description?: string;
  coverColor?: string;
  serialStatus?: string;
  /**
   * 搜尋的主排序鍵（FR-034）。呼叫端**一律帶入**，兩個理由：
   *  1. 作品有更新就該在搜尋結果上浮；
   *  2. 少了它，「只改標籤」這種其餘欄位全空的更新會產生一個沒有 SET 子句的 UPDATE，
   *     影響列數為 0，而呼叫端會把 0 讀成「不存在或非擁有者」→ 回一個假的「找不到」。
   */
  updatedAt?: Date;
}

/** 更新作品欄位；回傳影響列數（0 = 不存在或非擁有者，兩者不可區分） */
export async function updateNovelOwned(
  authorId: string,
  novelId: string,
  data: UpdateNovelRow,
  tx?: TxClient
): Promise<number> {
  const result = await db(tx).novel.updateMany({ where: { id: novelId, authorId }, data });
  return result.count;
}

/** 上架／下架；回傳影響列數 */
export async function setNovelStatusOwned(
  authorId: string,
  novelId: string,
  status: 'draft' | 'published' | 'admin_suspended',
  tx?: TxClient
): Promise<number> {
  const result = await db(tx).novel.updateMany({
    where: { id: novelId, authorId },
    data: { status },
  });
  return result.count;
}

/** 刪除作品（卷／章節／正文／標籤關聯由 schema 的級聯處理）；回傳影響列數 */
export async function deleteNovelOwned(
  authorId: string,
  novelId: string,
  tx?: TxClient
): Promise<number> {
  const result = await db(tx).novel.deleteMany({ where: { id: novelId, authorId } });
  return result.count;
}

/** 全站標籤選項（作品管理頁的多選來源；作者只能自既有集合挑選，FR-012c） */
export async function getAllTags(): Promise<TagOption[]> {
  return prisma.tag.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } });
}

/** 該作品目前的標籤識別碼集合 */
export async function countExistingTags(tagIds: string[], tx?: TxClient): Promise<number> {
  if (tagIds.length === 0) return 0;
  return db(tx).tag.count({ where: { id: { in: tagIds } } });
}

/** 整批覆寫作品標籤（先清後寫，於呼叫端的交易內執行） */
export async function replaceNovelTags(
  novelId: string,
  tagIds: string[],
  tx?: TxClient
): Promise<void> {
  const client = db(tx);
  await client.novelTag.deleteMany({ where: { novelId } });
  if (tagIds.length > 0) {
    await client.novelTag.createMany({ data: tagIds.map((tagId) => ({ novelId, tagId })) });
  }
}

/** 分類是否存在（`categoryId` 的存在性由寫入端查證，FR-006） */
export async function categoryExists(categoryId: string, tx?: TxClient): Promise<boolean> {
  const row = await db(tx).category.findUnique({ where: { id: categoryId }, select: { id: true } });
  return row !== null;
}

/**
 * 作品存在且**已發佈**（FEAT-4 4-A）。
 *
 * 讀者向的寫入（加入書架、上報進度、合併本機資料）一律以此為前置：
 * 「不存在」與「還是草稿」對讀者是同一個回答（404），
 * 分開回答等於告訴外面的人「這個 id 有效，只是還沒公開」。
 */
export async function publishedNovelExists(novelId: string, tx?: TxClient): Promise<boolean> {
  const row = await db(tx).novel.findFirst({
    where: { id: novelId, status: 'published' },
    select: { id: true },
  });
  return row !== null;
}

/** 一次篩出清單中已發佈者（合併路徑逐筆查會是 N 次往返，而 N 上限是 200） */
export async function filterPublishedNovelIds(
  novelIds: string[],
  tx?: TxClient
): Promise<Set<string>> {
  if (novelIds.length === 0) return new Set();
  const rows = await db(tx).novel.findMany({
    where: { id: { in: novelIds }, status: 'published' },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}

// ─────────────────────────────────────────────
// 搜尋預算與排序鍵（FEAT-3 3-A，FR-027／FR-028／FR-034）
// ─────────────────────────────────────────────

/** 重算 `searchText` 所需的四項來源；形狀與 `services/searchText.ts` 的入參一致 */
export interface NovelSearchSource {
  title: string;
  /** 作者的公開顯示名（`penName ?? name`，於本層遞補） */
  author: string;
  /** 分類的顯示 label */
  category: string;
  tags: string[];
}

/**
 * 該作者名下全部作品的識別碼（筆名異動時的重算範圍，FR-028a）。
 *
 * **不帶 `status` 條件**：草稿作品此刻不進搜尋結果，但它的預算仍須正確 ——
 * 否則作者上架時看到的是用舊筆名算出來的預算，而上架那條路徑並不會重算 `searchText`。
 */
export async function listNovelIdsByAuthor(authorId: string, tx?: TxClient): Promise<string[]> {
  const rows = await db(tx).novel.findMany({
    where: { authorId },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** 取得重算搜尋預算所需的來源欄位；作品不存在回 `null` */
export async function getNovelSearchSource(
  novelId: string,
  tx?: TxClient
): Promise<NovelSearchSource | null> {
  const row = await db(tx).novel.findUnique({
    where: { id: novelId },
    select: {
      title: true,
      author: { select: { name: true, penName: true } },
      categoryRel: { select: { label: true } },
      tags: { select: { tag: { select: { name: true } } } },
    },
  });
  if (!row) return null;

  return {
    title: row.title,
    author: row.author.penName ?? row.author.name,
    category: row.categoryRel.label,
    tags: row.tags.map((t) => t.tag.name),
  };
}

/**
 * 寫入搜尋預算。
 *
 * **排序鍵不在這裡動**：`updatedAt` 由各寫入路徑自己負責（`updateNovelOwned` 的
 * 同一筆 UPDATE、`touchNovel`、或建立時的預設值）。兩者若都在這裡寫，
 * 每次更新就會對同一列發兩次 UPDATE，而其中一次的值還會覆蓋另一次。
 */
export async function setNovelSearchText(
  novelId: string,
  searchText: string,
  tx?: TxClient
): Promise<void> {
  await db(tx).novel.update({ where: { id: novelId }, data: { searchText } });
}

/**
 * 只更新排序鍵（data-model.md §2.2：**章節異動即作品有更新**）。
 *
 * 少了這一步，作者更新章節後作品不會在搜尋結果上浮 ——
 * 而「更新時間」正是 FR-034 選它當主排序鍵的理由。
 */
export async function touchNovel(novelId: string, updatedAt: Date, tx?: TxClient): Promise<void> {
  await db(tx).novel.update({ where: { id: novelId }, data: { updatedAt } });
}

/**
 * 依實際章節重算反正規化計數（FR-011、data-model.md §4.1）。
 *
 * **只計已發佈章節**，與 FEAT-2 seed 建立的語意一致。
 * MUST 與觸發它的那次章節寫入位於同一交易 —— 否則會留下與目錄對不起來的數字。
 */
export async function refreshNovelCounters(novelId: string, tx?: TxClient): Promise<void> {
  const client = db(tx);
  const agg = await client.chapter.aggregate({
    where: { novelId, status: 'published' },
    _sum: { wordCount: true },
    _count: { _all: true },
  });

  await client.novel.update({
    where: { id: novelId },
    data: {
      wordCount: agg._sum.wordCount ?? 0,
      chapterCount: agg._count._all,
    },
  });
}

/**
 * 讀取作品層級的反正規化計數（FEAT-7 T015）。
 *
 * 批次匯入的成功回應要回填 `chapterCount`／`wordCount`（契約 §1.2），
 * 而 `refreshNovelCounters` 回傳 `void` —— 讓它改回傳值等於動到 5 條既有寫入路徑共用的函式，
 * 故另立一支唯讀的取值函式。**接 `tx` 是必要的**：值必須取自重算所在的那一個交易，
 * 交易外再查一次會讀到重算之前（或別人插隊之後）的數字。
 */
export async function getNovelCounters(
  novelId: string,
  tx?: TxClient
): Promise<{ chapterCount: number; wordCount: number }> {
  const row = await db(tx).novel.findUniqueOrThrow({
    where: { id: novelId },
    select: { chapterCount: true, wordCount: true },
  });
  return { chapterCount: row.chapterCount, wordCount: row.wordCount };
}

// ─────────────────────────────────────────────
// 閱讀頁：章節上下文
// ─────────────────────────────────────────────

/**
 * 取得閱讀頁所需的完整章節上下文（含正文、上下章導航）。
 *
 * 正文來自 `ChapterContent`（經 `chapters` repository）；未發佈或不存在的章節一律回 null，
 * 閱讀頁 Server Component 據此呼叫 `notFound()` → 404（不是 403，FR-014）。
 */
export async function getChapterContext(
  novelId: string,
  chapterId: string
): Promise<ChapterContext | null> {
  const novel = await getNovelDetail(novelId);
  if (!novel) return null;

  const published = await getPublishedChapterWithContent(novelId, chapterId);
  if (!published) return null;

  let flatIndex = 0;
  let found: { volumeIdx: number; chapterIdx: number } | null = null;
  for (let vi = 0; vi < novel.volumes.length; vi++) {
    const ci = novel.volumes[vi].chapters.findIndex((ch) => ch.id === chapterId);
    if (ci !== -1) {
      found = { volumeIdx: vi, chapterIdx: ci };
      flatIndex += ci;
      break;
    }
    flatIndex += novel.volumes[vi].chapters.length;
  }
  if (!found) return null;

  const volume = novel.volumes[found.volumeIdx];
  const chapter = volume.chapters[found.chapterIdx];
  const index = found.chapterIdx;

  const prevChapterId =
    index > 0
      ? volume.chapters[index - 1].id
      : (() => {
          const prevVolume = novel.volumes[found.volumeIdx - 1];
          return prevVolume ? prevVolume.chapters[prevVolume.chapters.length - 1].id : null;
        })();

  const nextChapterId =
    index < volume.chapters.length - 1
      ? volume.chapters[index + 1].id
      : (() => {
          const nextVolume = novel.volumes[found.volumeIdx + 1];
          return nextVolume ? nextVolume.chapters[0].id : null;
        })();

  const totalChapters = novel.volumes.reduce((acc, v) => acc + v.chapters.length, 0);
  const progressInVolume =
    totalChapters > 0 ? Math.round(((flatIndex + 1) / totalChapters) * 100) : 0;

  return {
    novel,
    volume,
    chapter,
    bodyMarkdown: published.bodyMarkdown,
    prevChapterId,
    nextChapterId,
    progressInVolume,
  };
}

// ─────────────────────────────────────────────────────────────
// FEAT-4 4-B 互動計數（T064／T065，contracts/internal-modules.md §2「擴充既有」）
//
// 兩支都寫 `Novel` 的計數欄位，故落在本檔而非 reviews.ts／comments.ts ——
// `commentCount` 的呼叫端有**兩個**（評論與留言各一），放在其中一邊會讓另一邊
// 深層 import 過去拿，而那正是 barrel 要擋掉的事。
// ─────────────────────────────────────────────────────────────

/**
 * 以重算出的真值覆寫作品評分。
 *
 * 刻意收「真值」而非增量：以原值 ± 這一筆推算時，任何一次遺漏或重試都會永久偏掉，
 * 而評分沒有第二個來源可以對帳（`aggregateNovelRating` 才是唯一真相）。
 */
export async function setNovelRating(
  novelId: string,
  value: { rating: number; ratingCount: number },
  tx?: TxClient
): Promise<void> {
  await db(tx).novel.update({
    where: { id: novelId },
    data: { rating: value.rating, ratingCount: value.ratingCount },
  });
}

/**
 * `Novel.commentCount` 增減（評論與留言共用同一個計數，contracts/interaction-api.md）。
 * `+1` 與 `−1` MUST 成對出現在**同一交易**內；只減不加會讓計數走負，
 * 而「使用者的動作立即反映」（FR-038a）在那條路徑上就恆假。
 */
export async function adjustNovelCommentCount(
  novelId: string,
  delta: number,
  tx?: TxClient
): Promise<number> {
  const row = await db(tx).novel.update({
    where: { id: novelId },
    data: { commentCount: { increment: delta } },
    select: { commentCount: true },
  });
  return row.commentCount;
}

// ─────────────────────────────────────────────────────────────
// FEAT-4 4-C 每日彙總的回填與校正（T100，data-model.md §7.1）
//
// `Novel` 上的六個計數是**快取值**，真相在原始表裡。快取一定會漂：交易中途失敗、
// 直接改資料庫、未來某次重構漏掉一條增減路徑 —— 漂了以後沒有人看得出來。
// 這兩支是那份快取的唯一修復機制，由 `statsService.rollupDaily` 在彙總之後呼叫。
//
// 兩支都**只更新與真值不同的列**：全量重算的正確性不受影響，而每日彙總在
// 沒有任何東西漂掉的日子（也就是絕大多數日子）不會產生任何一筆寫入。
// ─────────────────────────────────────────────────────────────

/**
 * 以 `NovelDailyStat` 回填 `Novel.totalViews`（全期）與 `weeklyViews`（`weekStart` 起）。
 *
 * **回填而非累加**：`SUM` 的結果是真值，重跑得到同一個數字（SC-008 的冪等）；
 * 寫成 `increment` 的話同一天彙總兩次，兩個欄位就會翻倍。
 * 沒有任何統計列的作品一律回 0 —— 明細被清理後統計列仍在，故 0 表示「真的沒有」。
 */
export async function backfillNovelViewCounts(weekStart: Date): Promise<number> {
  const [totals, weekly, novels] = await Promise.all([
    prisma.novelDailyStat.groupBy({ by: ['novelId'], _sum: { views: true } }),
    prisma.novelDailyStat.groupBy({
      by: ['novelId'],
      where: { date: { gte: weekStart } },
      _sum: { views: true },
    }),
    prisma.novel.findMany({ select: { id: true, totalViews: true, weeklyViews: true } }),
  ]);

  const totalByNovel = new Map(totals.map((r) => [r.novelId, r._sum.views ?? 0]));
  const weeklyByNovel = new Map(weekly.map((r) => [r.novelId, r._sum.views ?? 0]));

  let updated = 0;
  for (const novel of novels) {
    const totalViews = totalByNovel.get(novel.id) ?? 0;
    const weeklyViews = weeklyByNovel.get(novel.id) ?? 0;
    if (novel.totalViews === totalViews && novel.weeklyViews === weeklyViews) continue;

    await prisma.novel.update({ where: { id: novel.id }, data: { totalViews, weeklyViews } });
    updated++;
  }
  return updated;
}

/**
 * 以原始表全量重算 `favoriteCount`／`commentCount`／`rating`／`ratingCount`（SC-019 後半）。
 *
 * 口徑與寫入路徑一致：留言與評論**只計可見者**（隱藏的低分評論不得拉低平均），
 * 而 `commentCount` 是章節留言與作品評論**兩者相加**（兩條寫入路徑共用同一個計數欄）。
 */
export async function recomputeNovelCounters(): Promise<number> {
  const [favorites, reviews, commentsByChapter, chapters, novels] = await Promise.all([
    prisma.bookshelf.groupBy({ by: ['novelId'], _count: { _all: true } }),
    prisma.review.groupBy({
      by: ['novelId'],
      where: { status: 'visible' },
      _count: { _all: true },
      _avg: { rating: true },
    }),
    prisma.comment.groupBy({
      by: ['chapterId'],
      where: { status: 'visible' },
      _count: { _all: true },
    }),
    prisma.chapter.findMany({ select: { id: true, novelId: true } }),
    prisma.novel.findMany({
      select: {
        id: true,
        favoriteCount: true,
        commentCount: true,
        rating: true,
        ratingCount: true,
      },
    }),
  ]);

  const favoriteByNovel = new Map(favorites.map((r) => [r.novelId, r._count._all]));
  const reviewByNovel = new Map(
    reviews.map((r) => [r.novelId, { count: r._count._all, avg: r._avg.rating ?? 0 }])
  );

  const novelIdByChapter = new Map(chapters.map((c) => [c.id, c.novelId]));
  const commentByNovel = new Map<string, number>();
  for (const row of commentsByChapter) {
    const novelId = novelIdByChapter.get(row.chapterId);
    if (!novelId) continue;
    commentByNovel.set(novelId, (commentByNovel.get(novelId) ?? 0) + row._count._all);
  }

  let updated = 0;
  for (const novel of novels) {
    const review = reviewByNovel.get(novel.id);
    const next = {
      favoriteCount: favoriteByNovel.get(novel.id) ?? 0,
      commentCount: (commentByNovel.get(novel.id) ?? 0) + (review?.count ?? 0),
      rating: review?.avg ?? 0,
      ratingCount: review?.count ?? 0,
    };

    if (
      novel.favoriteCount === next.favoriteCount &&
      novel.commentCount === next.commentCount &&
      novel.rating === next.rating &&
      novel.ratingCount === next.ratingCount
    ) {
      continue;
    }

    await prisma.novel.update({ where: { id: novel.id }, data: next });
    updated++;
  }
  return updated;
}

/**
 * 追更通知所需的作品最小欄位（FEAT-4 4-D，T127）。
 *
 * **MUST NOT 改用 `getNovelDetail`**：那一支帶 `NOVEL_DETAIL_INCLUDE`（作者、分類、
 * 標籤、卷章），為了三個欄位拉回整份詳情，而通知是每次發佈都要跑的路徑。
 *
 * `slug` 取 `id`：本站的作品網址就是 `/novels/{id}`（`Novel` 沒有另一組對外識別字串），
 * 通知酬載的 `novelSlug` 因而與 `novelId` 同值。**留著這一格而非省略**是為了讓酬載的
 * 六個欄位與 data-model.md §2.8 的形狀完全一致 —— 前端與測試依賴的是那個形狀。
 */
export async function getNovelNotifyRef(
  novelId: string,
  tx?: TxClient
): Promise<{ id: string; slug: string; title: string; authorId: string } | null> {
  const row = await db(tx).novel.findUnique({
    where: { id: novelId },
    select: { id: true, title: true, authorId: true },
  });
  return row ? { id: row.id, slug: row.id, title: row.title, authorId: row.authorId } : null;
}
