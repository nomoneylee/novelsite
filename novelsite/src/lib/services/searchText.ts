/**
 * 搜尋預算的組裝與正規化（FR-027、data-model.md §2.1）
 * ======================================================
 * `Novel.searchText` 的**唯一**組裝實作。`novelService`／`seed.ts` 一律由此匯入 ——
 * 多一份實作就多一種「這部作品搜不到但那部搜得到」的方式，而兩份都會看起來是對的。
 *
 * **為何獨立成檔而非直接寫在 `searchService.ts`**：`searchService` 需要
 * `import 'server-only'` 與資料存取層，而 `prisma/seed.ts` 是由 `tsx` 直接執行的
 * 純 Node 腳本 —— `server-only` 在那個環境會在載入階段就擲錯。
 * 本檔只有字串運算、無任何相依，兩邊都用得起；
 * `searchService.ts` 一併 re-export，contracts/internal-modules.md §1.4 的匯入路徑不變。
 */

/** `searchText` 與查詢字串的共同長度上限（PostgreSQL btree 索引列的大小限制，約 2704 bytes） */
export const SEARCH_TEXT_MAX_LENGTH = 512;

/**
 * trim → 轉小寫 → 連續空白收斂為單一半形空白 → 截斷至 512 字元。
 *
 * **查詢字串也要走這一條**（FR-034／SC-005）：`searchText` 以小寫落庫，
 * 查詢端不轉小寫的話，大小寫折疊就落到資料庫身上，而 SQLite 的 `LIKE` 只折疊 ASCII、
 * PostgreSQL 的 `ILIKE` 依 locale 折疊更多 —— 「兩軌結果完全一致」會變成只在 ASCII 成立。
 */
export function normalize(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, SEARCH_TEXT_MAX_LENGTH);
}

export interface SearchTextSource {
  title: string;
  /** 作者的公開顯示名（`penName ?? name`，由呼叫端遞補） */
  author: string;
  /** 分類的顯示 label */
  category: string;
  tags: string[];
}

/** 標題 + 作者顯示名 + 分類 + 標籤，以單一空白相接後正規化 */
export function buildSearchText(src: SearchTextSource): string {
  return normalize([src.title, src.author, src.category, ...src.tags].join(' '));
}
