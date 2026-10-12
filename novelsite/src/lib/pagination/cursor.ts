/**
 * 複合游標的編解碼（FEAT-4 T006，contracts/internal-modules.md §3）
 * ==================================================================
 * 列表分頁一律以「排序主鍵 + `id` 決勝」的複合游標翻頁，MUST NOT 用位移分頁，
 * 也 MUST NOT 用 Prisma 的 `cursor`/`skip`（前面插入一筆就整頁位移）。
 *
 * 游標對呼叫端是**不透明字串**：它只負責原樣帶回來。編碼成 base64url 不是為了隱藏
 * （內容本來就不是機密），而是讓它能不經轉義直接放進查詢字串。
 */

/**
 * 主鍵與識別碼之間的分隔符。
 * 取 U+0000：識別碼（cuid／uuid）、ISO 8601 時間字串與十進位數字都不可能含它，
 * 故「取第一個分隔符切開」不會把主鍵本身切壞。
 */
const SEPARATOR = '\u0000';

/** base64url 的字元集；先擋掉非法字元，`Buffer.from` 對它們是靜默忽略而非擲出 */
const BASE64URL = /^[A-Za-z0-9_-]+$/;

function primaryToString(primary: string | number | Date): string {
  if (primary instanceof Date) return primary.toISOString();
  return String(primary);
}

/** 以排序主鍵與識別碼組出游標 */
export function encodeCursor(primary: string | number | Date, id: string): string {
  return Buffer.from(`${primaryToString(primary)}${SEPARATOR}${id}`, 'utf8').toString('base64url');
}

/**
 * 解開游標。
 *
 * 無效輸入一律回 `null`，**MUST NOT 擲出**：游標來自查詢字串，是使用者可控的輸入，
 * 由呼叫端把 `null` 轉成 400（FR-005）。擲出的話 `?cursor=%%%` 會變成 500。
 */
export function decodeCursor(raw: string): { primary: string; id: string } | null {
  if (!BASE64URL.test(raw)) return null;

  const plain = Buffer.from(raw, 'base64url').toString('utf8');
  const at = plain.indexOf(SEPARATOR);
  if (at < 0) return null;

  const primary = plain.slice(0, at);
  const id = plain.slice(at + SEPARATOR.length);
  // 半截游標（任一邊為空）不是有效輸入 —— 放行會產生一個 where 條件恆真或恆假的查詢
  if (primary === '' || id === '') return null;

  return { primary, id };
}
