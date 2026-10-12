import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 網格入場動畫：同一列的卡片 MUST NOT 各自垂直位移
 * ==================================================
 * **這支測試在擋什麼**：多欄網格的入場動畫若「逐張卡片位移 y + stagger」，
 * 動畫進行中的每一影格裡，同一列的卡片會停在不同的垂直位置 ——
 * 第一張已就位、後面幾張還低十幾 px。使用者看到的就是
 * 「最左邊那一格比同列其他格高一點」。因為入場由捲動觸發、觸發時機受
 * 捲動位置與字型／圖片載入時序影響而不固定，所以時有時無，重新載入後又正常。
 *
 * 正確作法：**位移掛在網格容器、透明度才逐張錯開**。容器整體位移時，
 * 同一列的卡片在每一影格的垂直位置都相同，而入場的層次感由 opacity 的
 * stagger 保留下來。
 *
 * **為什麼是掃原始碼而不是元件測試**：jsdom 沒有版面計算（`getBoundingClientRect`
 * 恆為 0），也沒有 requestAnimationFrame 驅動的 GSAP 時間軸 —— 用元件測試斷言
 * 「同列卡片的 top 相同」兩側都會通過，其實什麼都沒驗，比沒有測試更糟。
 * 真正的視覺行為由人工在瀏覽器確認；這支測試守的是「不會有人把逐張位移改回去」。
 *
 * **只涵蓋多欄網格**：直向清單（RankingWidget、RankingPageView、NovelHero）
 * 每列只有一個元素，逐項位移不會造成同列錯位，故不在此閘門內。
 */

/** 受管的多欄網格元件：檔案路徑 → 網格容器的 data 標記 */
const GRID_COMPONENTS: Array<{ file: string; gridAttr: string }> = [
  { file: 'src/components/home/CategoryNav.tsx', gridAttr: 'data-cat-grid' },
  { file: 'src/components/home/NewBooksSection.tsx', gridAttr: 'data-novel-grid' },
  { file: 'src/components/novel/RelatedNovels.tsx', gridAttr: 'data-related-grid' },
];

const ROOT = path.resolve(__dirname, '../..');

/**
 * 屬性名的前一個字元 MUST 是分界字元（行首、空白、`,`、`{`）。
 *
 * 少了這個條件，找 `y` 會連 `opacity:` 的結尾一起抓到 —— 那正是這支測試
 * 最容易寫錯、而且錯了還會全綠的地方。
 */
function propPattern(prop: string): RegExp {
  return new RegExp('(^|[,{\\s])' + prop + '\\s*:', 'g');
}

/**
 * 取出所有「包住某個屬性名」的物件實字（object literal）內容。
 *
 * 從屬性名的位置往回找到它所屬的那一個 `{`（沿路把成對的括號抵銷掉），
 * 再往前找到對應的 `}`。GSAP 的設定物件裡會有巢狀的 `scrollTrigger: { ... }`，
 * 單純用正則抓 `{[^}]*}` 會在巢狀物件的第一個 `}` 就截斷。
 */
function literalsContaining(source: string, prop: string): string[] {
  const out: string[] = [];
  const needle = propPattern(prop);
  let m: RegExpExecArray | null;

  while ((m = needle.exec(source)) !== null) {
    const at = m.index;

    // 往回找所屬的開括號
    let depth = 0;
    let open = -1;
    for (let i = at; i >= 0; i--) {
      const ch = source[i];
      if (ch === '}') depth++;
      else if (ch === '{') {
        if (depth === 0) {
          open = i;
          break;
        }
        depth--;
      }
    }
    if (open === -1) continue;

    // 往前找對應的閉括號
    depth = 0;
    let close = -1;
    for (let i = open; i < source.length; i++) {
      const ch = source[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    if (close === -1) continue;

    out.push(source.slice(open + 1, close));
  }

  return out;
}

/** 物件實字裡是否有 `y:` 這個屬性 */
function hasY(literal: string): boolean {
  return propPattern('y').test(literal);
}

describe('多欄網格的入場動畫', () => {
  for (const { file, gridAttr } of GRID_COMPONENTS) {
    describe(file, () => {
      const source = fs.readFileSync(path.join(ROOT, file), 'utf8');

      it('帶 stagger 的 tween MUST NOT 同時位移 y —— 那會讓同一列的卡片在動畫中錯開', () => {
        const staggered = literalsContaining(source, 'stagger');
        expect(staggered.length, '應至少有一個帶 stagger 的入場 tween').toBeGreaterThan(0);

        for (const literal of staggered) {
          expect(
            hasY(literal),
            `逐項 stagger 的 tween 不得帶 y 位移，請把位移移到網格容器（${gridAttr}）上：\n${literal}`
          ).toBe(false);
        }
      });

      it(`位移掛在網格容器上（${gridAttr}），且該容器在 JSX 裡確實存在`, () => {
        // JSX 上的標記
        expect(source, `網格容器 MUST 標上 ${gridAttr}`).toContain(gridAttr);
        // 動畫端確實以它為目標（querySelector 或選擇器字串皆可）
        expect(source, `位移 tween MUST 以 ${gridAttr} 為目標`).toContain(`[${gridAttr}]`);
      });

      it('位移 tween MUST 帶 clearProps —— GSAP 留下的行內 transform 會蓋掉 CSS 的 :hover 浮起', () => {
        const moves = literalsContaining(source, 'y').filter(hasY);
        expect(moves.length, '應至少有一個位移 tween').toBeGreaterThan(0);

        for (const literal of moves) {
          expect(
            /clearProps\s*:/.test(literal),
            `位移 tween 少了 clearProps，動畫跑完後行內 transform 會永久留著：\n${literal}`
          ).toBe(true);
        }
      });
    });
  }
});
