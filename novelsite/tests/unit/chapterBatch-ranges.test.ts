import { describe, expect, it } from 'vitest';
import { toChapterRanges, formatChapterRanges, type ChapterRange } from '@/lib/chapterBatch/ranges';

/**
 * 章號區段的推導與顯示（FEAT-8 T004，FR-025a／FR-027a／FR-028a）
 * ==============================================================
 * 這一份規則同時服務**確認畫面（瀏覽器）**、**結果摘要（瀏覽器）**與
 * **結構化紀錄（伺服器）**。三處吃同一支函式是設計上的硬需求，
 * 故本檔把格式的每一條邊界都鎖死 —— 格式漂了不會有型別錯誤，只會在日誌裡默默長歪。
 */

describe('T004 toChapterRanges：章號序列 → 連續區段', () => {
  it('連續章號併為單一區段', () => {
    expect(toChapterRanges([1, 2, 3])).toEqual<ChapterRange[]>([{ start: 1, end: 3 }]);
  });

  it('單章為 start === end 的區段', () => {
    expect(toChapterRanges([5])).toEqual<ChapterRange[]>([{ start: 5, end: 5 }]);
  });

  it('多段不連續各自成段', () => {
    expect(toChapterRanges([1, 2, 3, 7, 8, 20])).toEqual<ChapterRange[]>([
      { start: 1, end: 3 },
      { start: 7, end: 8 },
      { start: 20, end: 20 },
    ]);
  });

  it('亂序輸入的結果與排序後相同（函式自行排序，呼叫端不必先整理）', () => {
    expect(toChapterRanges([20, 2, 8, 1, 7, 3])).toEqual(toChapterRanges([1, 2, 3, 7, 8, 20]));
  });

  it('重複輸入去重後才分段（`[3,3,4]` 是一段 3–4，不是兩段）', () => {
    // 重複的章號若不去重，`end + 1` 的判定會被同值中斷，3、3、4 會裂成 {3,3} 與 {4,4}
    expect(toChapterRanges([3, 3, 4])).toEqual<ChapterRange[]>([{ start: 3, end: 4 }]);
  });

  it('空陣列回空陣列', () => {
    expect(toChapterRanges([])).toEqual([]);
  });
});

describe('T004 formatChapterRanges：區段 → 顯示字串（格式邊界）', () => {
  it('多段：`第 1–3、第 7–8、第 20 章`', () => {
    expect(
      formatChapterRanges([
        { start: 1, end: 3 },
        { start: 7, end: 8 },
        { start: 20, end: 20 },
      ])
    ).toBe('第 1–3、第 7–8、第 20 章');
  });

  it('單章 MUST 為「第 5 章」，MUST NOT 為「第 5–5 章」', () => {
    const output = formatChapterRanges([{ start: 5, end: 5 }]);
    expect(output).toBe('第 5 章');
    expect(output).not.toContain('5–5');
  });

  it('空陣列回空字串（呼叫端自行決定要不要顯示該行）', () => {
    expect(formatChapterRanges([])).toBe('');
  });

  it('「章」字只在結尾出現一次，不是每段一次', () => {
    const output = formatChapterRanges([
      { start: 1, end: 3 },
      { start: 7, end: 8 },
      { start: 20, end: 20 },
    ]);
    expect(output.split('章')).toHaveLength(2);
    expect(output.endsWith(' 章')).toBe(true);
  });

  it('連字號為 U+2013 EN DASH，MUST NOT 為 ASCII 連字號（U+002D）', () => {
    // 以**碼位**斷言而非貼字元：兩者在等寬字型下幾乎一樣，肉眼比對等於沒比對
    const output = formatChapterRanges([{ start: 1, end: 3 }]);
    const dash = output[output.indexOf('1') + 1];
    expect(dash.codePointAt(0)).toBe(0x2013);
    expect(output).not.toContain(String.fromCodePoint(0x2d));
    expect(output).toBe(`第 1${String.fromCodePoint(0x2013)}3 章`);
  });
});

describe('T004 兩支函式串接：與三處共用的實際用法一致', () => {
  it('亂序含重複的章號 → 顯示字串', () => {
    expect(formatChapterRanges(toChapterRanges([8, 1, 2, 20, 3, 7, 8]))).toBe(
      '第 1–3、第 7–8、第 20 章'
    );
  });

  it("一章都沒有時串接結果為空字串（紀錄的 `ranges` 於未知時為 `''`）", () => {
    expect(formatChapterRanges(toChapterRanges([]))).toBe('');
  });
});
