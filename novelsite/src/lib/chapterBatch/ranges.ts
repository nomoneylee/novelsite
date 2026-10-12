/**
 * 章號區段的推導與顯示（FR-025a／FR-027a／FR-028a，contracts/internal-modules.md §1）
 * ====================================================================================
 * **純函式，client / server 共用。MUST NOT `import 'server-only'`**，
 * MUST NOT 引用 repository、Prisma 或任何 Node 專屬 API。
 * 這一條是硬需求：確認畫面與結果摘要跑在瀏覽器、結構化紀錄跑在伺服器，
 * **三處要的是同一份規則**（research R-6）。各寫一份的下場是同一批章節在
 * 確認畫面、結果摘要與日誌裡長成三種樣子，而那不會讓任何測試變紅。
 */

/** 一段連續章號。單章時 `start === end` */
export interface ChapterRange {
  /** 含 */
  start: number;
  /** 含；單章時 `start === end` */
  end: number;
}

/**
 * 章號序列 → 連續區段。
 *
 * **入參不必事先排序或去重**，函式內自理：呼叫端手上的章號來自使用者的勾選順序，
 * 要求它先整理過，等於把同一段整理邏輯散到每個呼叫端去。
 */
export function toChapterRanges(numbers: readonly number[]): ChapterRange[] {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  if (sorted.length === 0) return [];

  const ranges: ChapterRange[] = [];
  let start = sorted[0];
  let end = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === end + 1) {
      end = sorted[i];
      continue;
    }
    ranges.push({ start, end });
    start = sorted[i];
    end = sorted[i];
  }
  ranges.push({ start, end });

  return ranges;
}

/** 區段之間的分隔符 */
const SEPARATOR = '、';

/**
 * 連字號為 **U+2013 EN DASH（–）**，**MUST NOT** 是 ASCII 連字號（contracts §1 的格式表）。
 * 兩者在等寬字型下幾乎分不出來，故抽成具名常數而非散在字串內插裡 ——
 * 「看起來對、其實是 ASCII 連字號」正是這個值最容易壞掉的方式，
 * 而 `tests/unit/chapterBatch-ranges.test.ts` 以碼位鎖死它。
 */
const EN_DASH = '–';

/**
 * 區段 → 顯示字串。空陣列回**空字串**（呼叫端自行決定要不要顯示該行）。
 *
 * 格式規則（三處共用，MUST 一致）：
 * - `[{1,3},{7,8},{20,20}]` → `第 1–3、第 7–8、第 20 章`
 * - `[{5,5}]` → `第 5 章`，**MUST NOT** 是「第 5–5 章」
 * - 「章」字只出現在**結尾一次**，不是每段一次
 */
export function formatChapterRanges(ranges: readonly ChapterRange[]): string {
  if (ranges.length === 0) return '';

  const parts = ranges.map((range) =>
    range.start === range.end ? `第 ${range.start}` : `第 ${range.start}${EN_DASH}${range.end}`
  );
  return `${parts.join(SEPARATOR)} 章`;
}
