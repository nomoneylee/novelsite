/**
 * 搜尋資料存取（Search Repository）— **雙軌分歧點的唯一所在**
 * ==============================================================
 * 全專案只有這一個檔案會依 `DATABASE_PROVIDER` 選擇不同的實作（憲章第 III 條、
 * contracts/internal-modules.md §2.3）。差異刻意壓到最小：
 * **只有比對運算子與佔位符的寫法不同**，條件、排序與筆數上限一字不差 ——
 * 分歧愈小，SC-005 的「兩軌結果完全一致」才可能是設計出來的而不是碰巧的。
 *
 * 採兩步查詢（research R-2）：本層的 raw 查詢**只回識別碼與排序鍵**，
 * 領域型別仍由 `novels.ts` + `mappers.ts` 產生。若在這裡手工組裝領域型別，
 * 就等於在 `mappers.ts` 之外複製一份對應規則，而複製出來的那一份不會跟著改。
 *
 * **入參前提**：`query`／`term` MUST 已經過 `services/searchText.ts` 的 `normalize()`
 * （已 trim、已轉小寫）。本層不再自行正規化 —— 兩處各自為政的結果是兩處都對不上。
 */
import 'server-only';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import type { NovelSuggestion } from '@/lib/types';
// 筆數上限的單一來源是驗證層（client／server 共用的那一份）。在這裡另寫一個 20
// 只會多出一個會漂移的字面量，而漂移的那一天兩邊都還是「看起來對的」
import { DEFAULT_SEARCH_LIMIT } from '@/lib/validation/search';

export { DEFAULT_SEARCH_LIMIT };

export type SearchProvider = 'sqlite' | 'postgresql';

/** 游標的兩個組成（排序鍵 + 決勝鍵）。base64 的編解碼屬服務層，見 `searchService` */
export interface SearchCursor {
  updatedAt: Date;
  id: string;
}

export interface SearchOptions {
  limit?: number;
  cursor?: SearchCursor;
  categoryId?: string;
}

export interface SearchRow {
  id: string;
  updatedAt: Date;
}

export interface SearchRows {
  rows: SearchRow[];
  hasMore: boolean;
}

/**
 * `LIKE`／`ILIKE` 的模式字元轉義（FR-033、research R-3）。
 *
 * **順序不可顛倒**：反斜線必須先加倍，否則後續為 `%`／`_` 加上的轉義字元
 * 會被第二輪再加倍一次，轉義的對象就從百分號變成了反斜線。
 * 單引號**不處理** —— 參數化查詢已經處理好了，自行加工才是注入的來源。
 */
export function escapeLikePattern(raw: string): string {
  return raw.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * 產生兩軌各自的比對 SQL（純函式，單元測試對象）。
 *
 * 拆成純函式而非直接內嵌，是為了讓「SQLite 用 `LIKE`、PostgreSQL 用 `ILIKE`」
 * 這條唯一的分歧能在**沒有資料庫**的情況下被斷言 ——
 * 只能靠跑起來才驗得到的分支，在兩軌之一沒被跑到的那天就會靜靜地壞掉。
 */
export function buildSearchSql(
  provider: SearchProvider,
  pattern: string,
  opts: { take: number; cursor?: SearchCursor; categoryId?: string }
): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  /** 推入一個參數並回傳它的佔位符（SQLite `?`／PostgreSQL `$n`） */
  const bind = (value: unknown): string => {
    params.push(value);
    return provider === 'postgresql' ? `$${params.length}` : '?';
  };

  // 兩軌唯一的差異就是這一個運算子（查詢詞與欄位皆已小寫，故兩者語意等價，research R-1）
  const operator = provider === 'postgresql' ? 'ILIKE' : 'LIKE';

  const where = [`"status" = 'published'`, `"searchText" ${operator} ${bind(pattern)} ESCAPE '\\'`];

  if (opts.categoryId) {
    where.push(`"categoryId" = ${bind(opts.categoryId)}`);
  }

  if (opts.cursor) {
    // (updatedAt, id) 的複合比較。只比 updatedAt 的話，同一時刻的兩筆會在頁邊界
    // 被整組跳過或整組重複 —— 而那只在「剛好同時更新」時發生，最不容易被發現
    const lt = bind(opts.cursor.updatedAt);
    const eq = bind(opts.cursor.updatedAt);
    const afterId = bind(opts.cursor.id);
    where.push(`("updatedAt" < ${lt} OR ("updatedAt" = ${eq} AND "id" > ${afterId}))`);
  }

  const sql = [
    'SELECT "id", "updatedAt" FROM "Novel"',
    `WHERE ${where.join(' AND ')}`,
    'ORDER BY "updatedAt" DESC, "id" ASC',
    `LIMIT ${bind(opts.take)}`,
  ].join(' ');

  return { sql, params };
}

/**
 * 依關鍵字取得作品識別碼（兩步查詢的第一步）。
 *
 * 關鍵字與分類皆缺席時**完全不發出查詢**（FR-032、SC-004）。
 * 分類單獨成立時仍會查詢 —— 空關鍵字產生的模式是 `%%`，本來就命中全部，
 * 交給 SQL 處理比在這裡多開一條分支簡單（FR-030b）。
 */
export async function searchNovelIds(query: string, opts?: SearchOptions): Promise<SearchRows> {
  const limit = opts?.limit ?? DEFAULT_SEARCH_LIMIT;
  if (!query && !opts?.categoryId) return { rows: [], hasMore: false };

  const { sql, params } = buildSearchSql(env.DATABASE_PROVIDER, `%${escapeLikePattern(query)}%`, {
    // 多取一筆用來判斷有沒有下一頁，回傳前再切掉
    take: limit + 1,
    ...(opts?.cursor ? { cursor: opts.cursor } : {}),
    ...(opts?.categoryId ? { categoryId: opts.categoryId } : {}),
  });

  const rows = await prisma.$queryRawUnsafe<SearchRow[]>(sql, ...params);
  const hasMore = rows.length > limit;
  return { rows: hasMore ? rows.slice(0, limit) : rows, hasMore };
}

/**
 * 即時建議（FR-031）。
 *
 * 與一般搜尋走**完全相同**的比對條件（`%term%` 子字串、只收已發佈）——
 * 建議若改用前綴比對，「搜『劍』命中『劍影行紀』」這類中文情境會直接失效，
 * 而使用者只會看到「打了字卻沒有建議」，不會知道是比對方式換了。
 */
export async function suggestNovels(term: string, limit: number): Promise<NovelSuggestion[]> {
  if (!term) return [];

  const { sql, params } = buildSearchSql(env.DATABASE_PROVIDER, `%${escapeLikePattern(term)}%`, {
    take: limit,
  });

  const rows = await prisma.$queryRawUnsafe<SearchRow[]>(sql, ...params);
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const novels = await prisma.novel.findMany({
    where: { id: { in: ids } },
    select: { id: true, title: true, author: { select: { name: true, penName: true } } },
  });

  const byId = new Map(
    novels.map((n) => [
      n.id,
      { id: n.id, title: n.title, author: n.author.penName ?? n.author.name },
    ])
  );
  return ids.map((id) => byId.get(id)).filter((n): n is NovelSuggestion => Boolean(n));
}
