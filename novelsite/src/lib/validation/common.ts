/**
 * 驗證規則的共用常數與工具（FR-006a、FR-019、data-model.md §7）
 * ================================================================
 * client / server 共用同一份定義（contracts/internal-modules.md）。
 * 上限值集中於此，MUST NOT 於各 schema 內重複字面量 —— 重複的必然結果是漂移，
 * 而漂移出來的那一版永遠是比較寬鬆的那一版。
 */

/** trim 後的字元數上限。key 為欄位語意，非資料庫欄位名 */
export const MAX_LENGTH = {
  /** 作品標題 */
  novelTitle: 100,
  /** 作品簡介（excerpt）與描述（description）共用級距 */
  novelExcerpt: 2000,
  /** 卷標題 */
  volumeTitle: 100,
  /** 章節標題 */
  chapterTitle: 200,
  /** 使用者暱稱 */
  userName: 50,
  /** 作者筆名 */
  penName: 50,
  /** 使用者簡介 */
  userBio: 500,
  /** 章節正文（Markdown 原文） */
  chapterBody: 100_000,
  /** 作品評論內容（FR-029） */
  reviewContent: 1000,
  /** 章節留言內容（FR-029） */
  commentContent: 500,
  /** 聯絡表單的稱呼（FEAT-5 FR-017） */
  contactName: 50,
  /** 聯絡表單的訊息本文（FEAT-5 FR-017）。**下限 10 字不在本表**——它是「有沒有寫東西」的門檻，不是欄位容量 */
  contactMessage: 2000,
} as const;

/**
 * 控制字元過濾（data-model.md §7）。
 *
 * 移除 U+0000–U+0008、U+000B、U+000C、U+000E–U+001F、U+007F；
 * **保留** `\t`(U+0009)、`\n`(U+000A)、`\r`(U+000D) —— 正文的換行與縮排是內容的一部分，
 * 一併濾掉會把作者寫好的分段變成一整坨。
 */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** 濾除控制字元；不做 trim、不改動換行 */
export function stripControlChars(value: string): string {
  return value.replace(CONTROL_CHARS, '');
}

/**
 * 字數 ＝ 去除所有空白後的字元數（規則源自 FEAT-2 FR-011a；FEAT-7 FR-008 要求與單章路徑一致）。
 * Markdown 標記本身計入 —— 儲存的是原文，不做轉譯後再數。
 *
 * **自 `services/chapterService.ts` 移入**（FEAT-7 T004）：FR-002c 要求字數規則
 * 只有一份實作且前後端共用，而 `chapterService.ts` 首行是 `import 'server-only'`，
 * client component 引用它會在建置期失敗。`stripControlChars` 本來就住在這裡，兩者是同一類東西。
 * 原處改為 re-export，既有呼叫端與既有測試的 import 路徑一律不變。
 */
export function countWords(bodyMarkdown: string): number {
  return bodyMarkdown.replace(/\s/g, '').length;
}
