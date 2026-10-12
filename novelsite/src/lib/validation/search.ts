import { z } from 'zod';

/**
 * 搜尋參數的驗證規則（contracts/search-api.md §1、data-model.md §7）
 * ==================================================================
 * client / server 共用：`/search` 頁的 Server Component、`GET /api/search`
 * 與用戶端的「載入更多」都吃同一份定義。
 *
 * **只有 `limit` 是錯誤**：`q` 為空、`cursor` 解不開、查無資料在這裡都不算錯 ——
 * 把「查無資料」表現成失敗，使用者會以為是網站壞了。
 */

/** 每頁預設筆數與上限（`arch.md` §5.1） */
export const DEFAULT_SEARCH_LIMIT = 20;
export const MAX_SEARCH_LIMIT = 50;

/** 建議清單：2 字元觸發、上限 8 筆、300ms 防抖（FR-031、US2 AC5） */
export const SUGGEST_MIN_CHARS = 2;
export const SUGGEST_LIMIT = 8;
export const SUGGEST_DEBOUNCE_MS = 300;

export const searchQuerySchema = z.object({
  // 空字串合法且是常態（使用者還沒打字）；正規化與短路由服務層負責
  q: z.string().default(''),
  category: z.string().trim().min(1, '分類識別碼不得為空').optional(),
  // base64 游標；**解不開視為無游標**（回第一頁），故此處只驗形狀不驗內容
  cursor: z.string().trim().min(1).optional(),
  limit: z.coerce
    .number({ message: `每頁筆數必須是 ${1}–${MAX_SEARCH_LIMIT} 的整數` })
    .int(`每頁筆數必須是 ${1}–${MAX_SEARCH_LIMIT} 的整數`)
    .min(1, `每頁筆數不得小於 1`)
    .max(MAX_SEARCH_LIMIT, `每頁筆數不得超過 ${MAX_SEARCH_LIMIT}`)
    .default(DEFAULT_SEARCH_LIMIT),
  /** 建議模式旗標（查詢字串只會是 `'1'`）；帶了就走建議、`limit` 一律忽略 */
  suggest: z.literal('1').optional(),
});

export type SearchQueryInput = z.infer<typeof searchQuerySchema>;
