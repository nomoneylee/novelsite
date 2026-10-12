import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 章節清單捲動容器的版面規則（FEAT-10 T018；FR-006～FR-008、contracts §2.1／§2.2）
 * ================================================================================
 * 本檔斷言的是**純文字事實**：`NovelManageView.module.css` 裡的捲動容器規則長什麼樣。
 *
 * **為什麼不用元件測試驗「120 章出現捲軸、3 章不出現」**：jsdom 沒有版面計算
 * （`scrollHeight`／`clientHeight` 恆為 0），而純 CSS `max-height` 方案下
 * 3 章與 120 章渲染出來的 DOM **完全相同** —— 那樣的斷言兩側都會通過，
 * 其實什麼都沒驗，比沒有測試更糟（research R-8）。門檻兩側的實際行為由 T034 手動驗證。
 *
 * **MUST 斷言結構，MUST NOT 逐字比對上限的字面值**：spec Assumptions 與 research R-2
 * 都明訂「上限的實際數值寫在 CSS 裡、**不寫進規格**，由實作依實測列高決定」。
 * 寫成 `toContain('max-height: min(60dvh, 30rem)')` 等於把一個刻意不入規格的數值
 * 釘進測試 —— T034 依實測調整時會弄紅**這個**檔案，而沒有任何任務授權去改這個期望值。
 *
 * **MUST NOT 併進 `style-token-scan.test.ts`**：那一支是**全站**的 CSS 變數閘門，
 * 這一支是**單一元件**的版面規則。併在一起會讓 T010 宣告的「閘門已綠」在本檔轉紅時
 * 一起變紅，下一個看到紅燈的人會先去查 token，而問題其實在別處。
 */

const CSS_PATH = path.resolve(__dirname, '../../src/components/author/NovelManageView.module.css');
const css = fs.readFileSync(CSS_PATH, 'utf8');

/**
 * 取出某個類別選擇器的宣告區塊內容。
 *
 * 選擇器後面**限定接空白再接 `{`**，`.chapterScroll` 因此不會誤取到
 * `.chapterScroll:focus-visible`（後者接的是 `:`）—— 兩者是不同的斷言對象。
 */
function ruleBody(selector: string): string {
  const match = css.match(new RegExp(`\\.${selector}\\s*\\{([^}]*)\\}`));
  expect(match, `找不到 .${selector} 的規則`).not.toBeNull();
  return match![1];
}

describe('T018 章節清單捲動容器的 CSS 規則（FR-006～FR-008）', () => {
  it('以 max-height 設上限，且上限值採視窗相對單位 dvh（FR-008）', () => {
    const body = ruleBody('chapterScroll');

    const maxHeight = body.match(/max-height\s*:\s*([^;]+);/);
    expect(maxHeight, '捲動容器 MUST 有 max-height').not.toBeNull();

    /*
      `dvh` 是 FR-008「隨可視視窗高度調整」的充分條件，同時擋掉兩種壞法：
        - `vh`：行動瀏覽器網址列展開時算的是**最大**視窗高，容器底部會被網址列蓋住（R-2）
        - 純 px：小視窗下上限比視窗還高，內部捲軸形同虛設
      **只驗單位、不驗數值** —— 數值刻意不入規格。
    */
    expect(maxHeight![1]).toContain('dvh');
  });

  it('縱向捲動、橫向不捲（contracts §2.1）', () => {
    const body = ruleBody('chapterScroll');

    expect(body).toMatch(/overflow-y\s*:\s*auto/);
    // 容器只負責縱向；過長標題的溢位由既有的文字截斷處理
    expect(body).toMatch(/overflow-x\s*:\s*hidden/);
  });

  it('MUST NOT 設 height 或 min-height —— 這是 FR-007「內容不足不留白」的充分條件', () => {
    const body = ruleBody('chapterScroll');

    /*
      `max-height` 在內容不足時不佔位，`height`／`min-height` 會 ——
      3 章的卷底下拖著一大片空白，正是 FR-007 要擋的東西。
      前置的 `[;\s]` 讓 `max-height:` 不會被誤判（它前面是 `-`）。
    */
    expect(body, 'MUST NOT 設 height').not.toMatch(/(^|[;\s])height\s*:/);
    expect(body, 'MUST NOT 設 min-height').not.toMatch(/min-height\s*:/);
  });

  it('有 :focus-visible 焦點樣式（contracts §2.2）', () => {
    /*
      容器帶 `tabIndex={0}`（T021）就會被 Tab 聚焦到 —— 少了焦點樣式，
      鍵盤使用者按 Tab 進到這裡時焦點等於憑空消失。
    */
    const body = ruleBody('chapterScroll:focus-visible');

    expect(body).toMatch(/outline\s*:.*var\(--color-accent\)/);
    expect(body).toMatch(/outline-offset\s*:/);
  });
});
