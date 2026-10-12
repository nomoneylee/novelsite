import { describe, it, expect } from 'vitest';
import { escapeLikePattern } from '@/lib/repositories/search';

/**
 * `LIKE`／`ILIKE` 的萬用字元轉義（FR-033、research R-3）。
 *
 * `%` 與 `_` 不是注入向量而是**模式字元** —— 參數化擋得住注入，擋不住「誤配」：
 * 使用者搜「100%」時，未轉義的 `%` 會讓查詢命中每一部作品。
 *
 * 轉義**順序**是這一組測試真正的重點：反斜線必須先轉義。若先處理 `%`，
 * 後續的反斜線加倍會把剛加上的轉義字元本身再加倍一次，結果是「轉義了一個反斜線」
 * 而不是「轉義了一個百分號」。這種錯誤在只含單一特殊字元的輸入上看不出來，
 * 故每一則斷言都以**明確的字元序列**表達，不寫「大概會多一個反斜線」。
 */

/** 以碼位組出字串，避免測試檔內出現難以目視分辨的連續反斜線 */
const BS = String.fromCharCode(0x5c); // '\'

describe('escapeLikePattern：單一特殊字元', () => {
  it('反斜線加倍', () => {
    expect(escapeLikePattern(BS)).toBe(BS + BS);
  });

  it('百分號前置反斜線', () => {
    expect(escapeLikePattern('%')).toBe(BS + '%');
  });

  it('底線前置反斜線', () => {
    expect(escapeLikePattern('_')).toBe(BS + '_');
  });

  it('無特殊字元者原樣通過（含中文與空白）', () => {
    expect(escapeLikePattern('劍影 行紀')).toBe('劍影 行紀');
    expect(escapeLikePattern('')).toBe('');
  });

  it('單引號不處理 —— 由參數化查詢負責，自行加工才是注入來源（R-3）', () => {
    expect(escapeLikePattern("O'Brien")).toBe("O'Brien");
  });
});

describe('escapeLikePattern：轉義順序（反斜線 MUST 先於 % 與 _）', () => {
  /**
   * 輸入 `\%`（反斜線 + 百分號）：
   *   正確順序：`\` → `\\` 得 `\\%`，再 `%` → `\%` 得 `\\` + `\%`（共 4 字元）
   *   錯誤順序：`%` → `\%` 得 `\` + `\%`，再 `\` → `\\` 得 5 字元
   * 兩者長度與內容皆不同，故本則是順序的唯一判準。
   */
  it('反斜線後接百分號 → 兩者各自被轉義（4 個字元）', () => {
    const escaped = escapeLikePattern(BS + '%');
    expect(escaped).toBe(BS + BS + BS + '%');
    expect(escaped).toHaveLength(4);
  });

  it('反斜線後接底線 → 兩者各自被轉義（4 個字元）', () => {
    const escaped = escapeLikePattern(BS + '_');
    expect(escaped).toBe(BS + BS + BS + '_');
    expect(escaped).toHaveLength(4);
  });

  it('已被使用者手動轉義過的輸入不會被「還原」（`\\%` 仍是字面的兩個字元）', () => {
    // 使用者輸入的每一個字元都是要被字面比對的內容，沒有「使用者也會轉義」這回事
    expect(escapeLikePattern(BS + BS)).toBe(BS + BS + BS + BS);
  });
});

describe('escapeLikePattern：混合輸入', () => {
  it('百分數搜尋詞（FR-033 的實際情境）', () => {
    expect(escapeLikePattern('100%')).toBe('100' + BS + '%');
  });

  it('多個特殊字元逐一轉義，非特殊字元不動', () => {
    expect(escapeLikePattern('a%b_c')).toBe('a' + BS + '%b' + BS + '_c');
  });
});
