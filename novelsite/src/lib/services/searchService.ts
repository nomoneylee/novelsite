import 'server-only';
import { searchNovelIds, suggestNovels, getNovelsByIds } from '@/lib/repositories';
import type { NovelSuggestion, SearchPage } from '@/lib/types';
import {
  searchQuerySchema,
  SUGGEST_LIMIT,
  SUGGEST_MIN_CHARS,
  DEFAULT_SEARCH_LIMIT,
  MAX_SEARCH_LIMIT,
} from '@/lib/validation/search';
import { normalize } from './searchText';
import { parseOrThrow } from './errors';

/**
 * 搜尋與建議的業務規則（FR-030～FR-035、contracts/internal-modules.md §1.4）
 * ===========================================================================
 * `/search` 頁的 Server Component 與 `GET /api/search` **共用本服務**，
 * 空查詢短路與錯誤語意因而完全一致 —— 兩條路各寫一份的話，
 * 使用者重新整理頁面就會看到跟「載入更多」不一樣的結果，而且沒有人會覺得那是 bug。
 *
 * 三件事一律在本層完成，MUST NOT 下放給資料存取層或呼叫端：
 *   1. **正規化**：查詢字串轉小寫後才下傳（FR-034／SC-005，理由見 `searchText.ts`）
 *   2. **短路**：空查詢與未達 2 字元的建議，完全不呼叫資料存取層（FR-032、SC-004）
 *   3. **游標編解碼**：對外是一個不透明字串，對內是 (updatedAt, id)
 */

export { normalize, buildSearchText } from './searchText';
export type { SearchTextSource } from './searchText';
export { SUGGEST_LIMIT, SUGGEST_MIN_CHARS, DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT };

/** 游標為 base64url(`${updatedAt.toISOString()}|${id}`)（data-model.md §8） */
function encodeCursor(row: { updatedAt: Date; id: string }): string {
  return Buffer.from(`${row.updatedAt.toISOString()}|${row.id}`, 'utf8').toString('base64url');
}

/**
 * 解不開的游標一律視為**無游標**（回第一頁），MUST NOT 視為錯誤（FR-030）。
 * 游標會出現在使用者能改的網址裡；把它當錯誤處理，等於讓一個手滑的貼上動作
 * 變成一個看起來像故障的畫面。
 */
function decodeCursor(raw: string | undefined): { updatedAt: Date; id: string } | undefined {
  if (!raw) return undefined;

  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  const sep = decoded.indexOf('|');
  if (sep <= 0) return undefined;

  const updatedAt = new Date(decoded.slice(0, sep));
  const id = decoded.slice(sep + 1);
  if (Number.isNaN(updatedAt.getTime()) || !id) return undefined;

  return { updatedAt, id };
}

/**
 * 全站搜尋（FR-030a、FR-030b、FR-034、FR-035）。
 *
 * 關鍵字與分類皆缺席時直接回空 —— 「沒輸入任何條件」不是「列出全部作品」，
 * 那是書庫列表的工作（SC-004、FR-032）。分類單獨成立則照常查詢（US2 AC10）。
 */
export async function search(params: unknown): Promise<SearchPage> {
  const input = parseOrThrow(searchQuerySchema, params);
  const query = normalize(input.q);

  if (!query && !input.category) return { items: [], nextCursor: null };

  const cursor = decodeCursor(input.cursor);
  const { rows, hasMore } = await searchNovelIds(query, {
    limit: input.limit,
    ...(input.category ? { categoryId: input.category } : {}),
    ...(cursor ? { cursor } : {}),
  });

  if (rows.length === 0) return { items: [], nextCursor: null };

  const items = await getNovelsByIds(rows.map((r) => r.id));
  return {
    items,
    // 游標取自**已回傳的最後一筆**，不是多取的那一筆；下一頁自它之後開始
    nextCursor: hasMore ? encodeCursor(rows[rows.length - 1]) : null,
  };
}

/**
 * 即時建議（FR-031）。未達 2 字元一律短路 ——
 * 1 字元的子字串比對幾乎命中全站，那不是建議，是把整個資料庫倒出來。
 */
export async function suggest(params: unknown): Promise<NovelSuggestion[]> {
  const input = parseOrThrow(searchQuerySchema, params);
  const term = normalize(input.q);

  if (term.length < SUGGEST_MIN_CHARS) return [];

  return suggestNovels(term, SUGGEST_LIMIT);
}
