import 'server-only';
import { revalidateTag } from 'next/cache';

/**
 * 快取標籤與失效輔助（FR-010）
 * ==============================
 * **服務層是唯一呼叫者**。元件、頁面與 Action 內 MUST NOT 直接呼叫 `revalidateTag`／
 * `revalidatePath` —— 失效呼叫一旦散落，就沒有任何一處能回答「這次寫入該讓什麼過期」，
 * 而漏掉的那一處只會以「使用者看到舊資料」的形式在正式環境現身。
 *
 * 為何包一層（research R-5）：框架的失效 API 名稱與語意隨版本變動
 * （Next 16 同時存在 `revalidateTag` 與 `updateTag`，後者**只能**在 Server Action 內呼叫，
 * 於 Route Handler 內呼叫會擲錯）。收攏於本檔後，改動面恆為一個檔案。
 *
 * **現況的誠實標示**：本專案未啟用 `cacheComponents`，`src/` 內尚無任何
 * `unstable_cache` 包裹或 `'use cache'` 區段，即**尚無已標記的快取項目**；
 * 全站頁面亦因 root layout 讀取 `headers()`（CSP nonce）而全樹動態產生。
 * 因此下列呼叫目前是無害的 no-op——介面與呼叫點先就位，日後任何一個
 * repository 改以 `unstable_cache(fn, keyParts, { tags })` 包裹時即自動生效。
 */

/** 書庫列表、搜尋結果、sitemap 等「作品集合」的共用標籤 */
export const NOVELS_LIST = 'novels:list';

/** 單一作品（詳情頁、作者管理頁）的標籤 */
export function novelTag(novelId: string): string {
  return `novel:${novelId}`;
}

/** 單一章節（閱讀頁）的標籤 */
export function chapterTag(chapterId: string): string {
  return `chapter:${chapterId}`;
}

/**
 * 失效行為採 `profile='max'`（stale-while-revalidate）。
 * MUST NOT 改用單引數形式 `revalidateTag(tag)` —— 該形式在 Next 16 已標記為 deprecated。
 */
const PROFILE = 'max';

/**
 * 失效呼叫的統一包裝。
 *
 * **為何吞下例外**：`revalidateTag` 依賴框架的請求範圍儲存區，在請求範圍之外
 * （示範資料載入、整合測試直接呼叫服務層、日後的排程工作）呼叫會擲錯。
 * 而失效發生在**寫入交易已經提交之後** —— 讓它把整個操作變成失敗，
 * 等於「資料已經改好了，但使用者收到錯誤訊息」，那比看到一份舊快取糟得多。
 *
 * MUST 保留 `console.error`：真正的快取失效失敗必須在記錄裡看得見。
 * 靜靜吞掉的那一版，會以「使用者一直看到舊資料而沒人知道為什麼」的形式活很久。
 */
function safeRevalidate(tag: string): void {
  try {
    revalidateTag(tag, PROFILE);
  } catch (err) {
    console.error(`[cache] 標籤 "${tag}" 失效失敗（多半是在請求範圍之外呼叫）`, err);
  }
}

/** 作品本身異動（資訊、標籤、上下架、計數回填） */
export function invalidateNovel(novelId: string): void {
  safeRevalidate(novelTag(novelId));
}

/** 作品集合異動（新建、刪除、上下架 —— 會改變列表成員） */
export function invalidateNovelsList(): void {
  safeRevalidate(NOVELS_LIST);
}

/** 章節異動（正文、標題、發佈狀態、排序） */
export function invalidateChapter(chapterId: string): void {
  safeRevalidate(chapterTag(chapterId));
}
