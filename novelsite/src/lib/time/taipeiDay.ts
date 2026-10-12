/**
 * 台北日界線（FEAT-4 4-C / T094，contracts/internal-modules.md §3、research R-2）
 * ================================================================================
 * 整個統計域「哪一天」的唯一定義。彙總只處理已結束的日期、回補要逐日列出、
 * 成效期間要對齊日界 —— 三者都靠本模組，錯一毫秒就是整批數字歸到隔壁那一天。
 *
 * **固定偏移的純算術，MUST NOT 依賴 `Intl` 或時區資料庫**：台灣自 1980 年起無日光節約
 * 時間，台北恆為 UTC+8；而 `Intl` 的時區支援取決於 Node 建置的 ICU 資料，
 * `small-icu` 建置會**靜默退化為 UTC**（research R-2）—— 那種錯誤在開發機上永遠不出現，
 * 只在部署環境把每一天都平移八小時。
 *
 * 服務層 MUST 只經本模組做日期運算，MUST NOT 自行寫 `+8` 魔術數。
 */

export const TAIPEI_OFFSET_MS = 8 * 3_600_000;

const DAY_MS = 24 * 3_600_000;

/** `at` 所屬台北日的 00:00 對應的 UTC 絕對時刻；不修改入參 */
export function taipeiDayStart(at: Date): Date {
  const shifted = at.getTime() + TAIPEI_OFFSET_MS;
  return new Date(Math.floor(shifted / DAY_MS) * DAY_MS - TAIPEI_OFFSET_MS);
}

/**
 * 單日的查詢區間。`end` 為**開區間上界**（start + 24h），
 * 查詢寫作 `viewedAt >= start AND viewedAt < end` —— 用閉區間會使
 * 23:59:59.999 之後的那一毫秒同時落在兩天。
 */
export function taipeiDayRange(day: Date): { start: Date; end: Date } {
  const start = taipeiDayStart(day);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

/**
 * 回補用的逐日序列（兩端**皆含**，入參為任意時刻，自動正規化到日起點）。
 * `from` 晚於 `to` 時回空陣列，MUST NOT 擲出 —— 起點取 `min(…, 昨日)` 時本就可能反序。
 */
export function taipeiDaysBetween(from: Date, to: Date): Date[] {
  const first = taipeiDayStart(from).getTime();
  const last = taipeiDayStart(to).getTime();

  const days: Date[] = [];
  for (let at = first; at <= last; at += DAY_MS) {
    days.push(new Date(at));
  }
  return days;
}

/** 「已結束的最後一天」的日起點（FR-036b：當日 MUST NOT 建列） */
export function yesterdayTaipei(now: Date): Date {
  return new Date(taipeiDayStart(now).getTime() - DAY_MS);
}

/**
 * 台北日的日期字串（`YYYY-MM-DD`）。
 *
 * 圖表標籤與「統計截止日」對外一律用這個形式。**MUST NOT 直接對日起點取
 * `toISOString().slice(0,10)`** —— 那個絕對時刻的 UTC 日期是前一天（16:00），
 * 於是畫面上每一格都會標成前一天的日期。
 */
export function taipeiDateString(day: Date): string {
  return new Date(taipeiDayStart(day).getTime() + TAIPEI_OFFSET_MS).toISOString().slice(0, 10);
}
