import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 全站 CSS 變數閘門（FEAT-10 T004；FR-019、SC-006、SC-009）
 * ==========================================================
 * 逐項任務清單能保證「被列到的那幾行改了」，保證不了「沒有第二十五處」，
 * 也保證不了下一個人不會再寫一個。故以測試而非一次性的 `grep` 實作
 * （`grep` 的結果只存在於當下那個終端機裡，同 `feat4-scan.test.ts` 的結論）。
 *
 * 本檔斷言**兩個**閘門值，兩者的失效機制完全不同：
 *
 *   - **閘門值 1 —— 無 fallback 的未定義引用**：`var(--not-defined)` 求值為
 *     guaranteed-invalid，整條宣告被丟棄。畫面上看到的是繼承色或瀏覽器預設值，
 *     而不是任何錯誤 —— **這就是它能在本頁活到今天的原因**。
 *   - **閘門值 2 —— fallback 是寫死的色碼**：`var(--not-defined, #b91c1c)` 畫面**正常**，
 *     因為那個 hex 一直在生效。壞的是它不隨主題變：夜間模式下是深紅壓深底。
 *     這是本專案「MUST NOT 硬編色碼」條款的實質違反。
 *
 * **閘門值 2 MUST 獨立於閘門值 1 存在**：帶 fallback 的引用本來就不在閘門值 1 的
 * 計數內，只斷言閘門值 1 的話，那幾處改不改，閘門都是綠的 ——
 * **一道無論如何都會通過的閘門，保證的是零**（`/speckit-analyze` 2026-09-06）。
 *
 * **MUST NOT 把所有帶 fallback 的引用都判為錯誤**：`var(--header-height, 64px)` 的
 * fallback 是長度不是顏色，`var(--cat-color, var(--color-accent))` 的 fallback 是
 * 另一個 token —— 兩者都沒有壞。判它們就是製造誤報，而**一道會誤報的閘門，
 * 第三次紅的時候就沒有人會看了**。
 *
 * 掃描器本身在本規格撰寫期間誤報過三次（同一份掃描給過 20／29／24 三個數字，
 * 前兩個分別漏掉行內變數與 fallback），故本檔另備四個**針對掃描器自己**的邊界案例。
 */

const SRC = path.resolve(__dirname, '../../src');

interface SourceFile {
  path: string;
  source: string;
}

/** 遞迴收集 `.ts`／`.tsx`／`.css`，排除 Prisma 產生物（建置產物，不是我們寫的程式碼） */
function collectSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'generated') continue;
      out.push(...collectSources(full));
      continue;
    }
    if (/\.(tsx?|css)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** 相對於 `src/` 的路徑，以 `/` 分隔（Windows 上 `path.relative` 會回 `\`） */
function rel(file: string): string {
  return path.relative(SRC, file).split(path.sep).join('/');
}

/**
 * 去掉註解後的內容（邊界二）。
 *
 * 註解裡寫著 `var(--color-text-primary)` 的**示意文字**不是一個引用，
 * 判它紅會逼人刪掉唯一寫著理由的那句話。本規格撰寫期間即誤報過
 * `AdminChart.tsx` 與 `AdminPage.module.css` 註解裡的示意文字。
 *
 * `[^:]` 是為了不把 `https://` 之後的內容當成行註解切掉。
 * 這是啟發式而非剖析器 —— 它可能少切一點（誤判為程式碼），但 MUST NOT 多切
 * （多切會讓真正的命中消失，測試恆綠）。
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * 定義來源（邊界一）：**全部 CSS 檔的 `--x:` 宣告** ∪ **TSX/TS 以行內 `style` 設定的變數**。
 *
 * **MUST NOT 只取 `design-tokens.css`**：`--cat-color`／`--cat-bg` 是由
 * `style={{ '--cat-color': ... }}` 在執行期設定的，任何一份只看 CSS 檔的定義清單
 * 都會把它們判成未定義 —— 那正是本掃描第一次給出 29 這個錯誤數字的原因。
 *
 * TSX 側刻意要求引號：`cssVar="--color-primary"` 是一個**字串屬性**而不是一個定義，
 * 只有 `'--x':`（物件鍵）才算。
 */
function collectDefinedVars(files: SourceFile[]): Set<string> {
  const defined = new Set<string>();
  for (const file of files) {
    const source = stripComments(file.source);
    const pattern = file.path.endsWith('.css')
      ? /(--[A-Za-z0-9_-]+)\s*:/g
      : /['"](--[A-Za-z0-9_-]+)['"]\s*:/g;
    for (const match of source.matchAll(pattern)) defined.add(match[1]);
  }
  return defined;
}

interface VarRef {
  name: string;
  /** `null` 表示 `var(--x)`（無 fallback）；字串為 fallback 的完整內容（邊界三） */
  fallback: string | null;
  line: number;
}

/**
 * 取出一份內容裡的全部 `var()` 引用（邊界三：區分有無 fallback）。
 *
 * fallback 以**括號配對**而非「讀到下一個 `)`」取得：`var(--cat-color, var(--color-accent))`
 * 的 fallback 是 `var(--color-accent)`，讀到第一個 `)` 就停的話會切成 `var(--color-accent`，
 * 而那個殘骸不會等於任何色碼字面值 —— 一個永遠不會紅的閘門。
 *
 * 巢狀的內層 `var()` 也會被獨立收錄一次（它本來就是一個引用，也該受同樣的檢查）。
 */
function collectVarRefs(source: string): VarRef[] {
  const refs: VarRef[] = [];
  const pattern = /var\(\s*(--[A-Za-z0-9_-]+)\s*/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const line = source.slice(0, match.index).split('\n').length;
    let cursor = match.index + match[0].length;
    if (source[cursor] !== ',') {
      refs.push({ name: match[1], fallback: null, line });
      continue;
    }
    cursor += 1;
    const start = cursor;
    let depth = 1;
    while (cursor < source.length) {
      const char = source[cursor];
      if (char === '(') depth += 1;
      else if (char === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
      cursor += 1;
    }
    refs.push({ name: match[1], fallback: source.slice(start, cursor).trim(), line });
  }
  return refs;
}

/**
 * fallback **整體**是不是一個寫死的色碼字面值。
 *
 * 涵蓋 `#rgb`／`#rgba`／`#rrggbb`／`#rrggbbaa` 與 `rgb()`／`rgba()`／`hsl()`／`hsla()`。
 *
 * **判的是「整體等於」而非「內含」**：`var(--shadow-md, 0 8px 24px rgb(0 0 0 / 12%))`
 * 的 fallback 是一個**陰影值**，陰影的組成本來就含一個顏色，那不是硬編色碼條款要防的事。
 * 改成「內含色碼」的話，這一處會被判紅，而唯一的「修法」是把一個沒壞的 fallback 刪掉。
 */
function isColorLiteral(value: string): boolean {
  return /^(#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgba?|hsla?)\([^()]*\))$/i.test(value);
}

interface ScanResult {
  /** 閘門值 1：無 fallback 且變數未定義的引用 */
  undefinedNoFallback: string[];
  /** 閘門值 2：fallback 為寫死色碼的引用（不論該變數是否已定義） */
  colorLiteralFallback: string[];
}

function scan(files: SourceFile[]): ScanResult {
  const defined = collectDefinedVars(files);
  const undefinedNoFallback: string[] = [];
  const colorLiteralFallback: string[] = [];

  for (const file of files) {
    for (const ref of collectVarRefs(stripComments(file.source))) {
      const at = `${file.path}:${ref.line} ${ref.name}`;
      if (ref.fallback === null) {
        if (!defined.has(ref.name)) undefinedNoFallback.push(at);
      } else if (isColorLiteral(ref.fallback)) {
        colorLiteralFallback.push(`${at} → ${ref.fallback}`);
      }
    }
  }

  return { undefinedNoFallback, colorLiteralFallback };
}

const FILES: SourceFile[] = collectSources(SRC).map((file) => ({
  path: rel(file),
  source: fs.readFileSync(file, 'utf8'),
}));

// ─────────────────────────────────────────────────────────────────────────────
// 甲：掃描器自己的邊界案例（先確認掃描器是對的，再拿它去判全站）
// ─────────────────────────────────────────────────────────────────────────────

describe('T004 甲：掃描器邊界（FR-019 的三項邊界要求）', () => {
  it('邊界一：TSX 以行內 style 設定的變數 MUST 視為已定義', () => {
    const files: SourceFile[] = [
      { path: 'a/Widget.tsx', source: `<div style={{ '--cat-color': color }} />` },
      { path: 'a/Widget.module.css', source: `.x { color: var(--cat-color); }` },
    ];
    expect(scan(files).undefinedNoFallback).toEqual([]);
  });

  it('邊界一之反面：完全沒有定義來源時 MUST 判紅（否則整組檢查會靜默通過）', () => {
    const files: SourceFile[] = [{ path: 'a.css', source: `.x { color: var(--nope); }` }];
    expect(scan(files).undefinedNoFallback).toEqual(['a.css:1 --nope']);
  });

  it('邊界二：註解裡的示意文字 MUST 被忽略', () => {
    const files: SourceFile[] = [
      { path: 'a.css', source: `/* 原本寫的是 var(--color-text-primary) */\n.x { color: red; }` },
      { path: 'b.tsx', source: `// 舊寫法：var(--color-text-primary)\nexport const x = 1;` },
    ];
    const result = scan(files);
    expect(result.undefinedNoFallback).toEqual([]);
    expect(result.colorLiteralFallback).toEqual([]);
  });

  it('邊界三：合法的非顏色 fallback MUST 兩個閘門都不判', () => {
    const files: SourceFile[] = [
      {
        path: 'a.css',
        source: [
          '.x { top: calc(var(--header-height, 64px)); }',
          '.y { color: var(--cat-color, var(--color-accent)); }',
          '.z { box-shadow: var(--shadow-md, 0 8px 24px rgb(0 0 0 / 12%)); }',
          ':root { --color-accent: #d97706; }',
        ].join('\n'),
      },
    ];
    const result = scan(files);
    expect(result.undefinedNoFallback).toEqual([]);
    expect(result.colorLiteralFallback).toEqual([]);
  });

  it('邊界四：fallback 是色碼者 MUST 只被閘門值 2 抓到，MUST NOT 進閘門值 1', () => {
    const files: SourceFile[] = [
      {
        path: 'a.css',
        source: [
          '.a { color: var(--nope-1, #b91c1c); }',
          '.b { color: var(--nope-2, #fff); }',
          '.c { color: var(--nope-3, rgba(0, 0, 0, 0.5)); }',
          '.d { color: var(--nope-4, hsl(0 100% 50%)); }',
        ].join('\n'),
      },
    ];
    const result = scan(files);
    // 四處變數皆未定義，但四處都有 fallback —— 閘門值 1 MUST 是空的
    expect(result.undefinedNoFallback).toEqual([]);
    expect(result.colorLiteralFallback).toHaveLength(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 乙：全站閘門（FR-019、SC-006、SC-009）
// ─────────────────────────────────────────────────────────────────────────────

describe('T004 乙：全站 CSS 變數閘門（FR-019）', () => {
  it('掃描範圍非空（收集邏輯壞掉時整組檢查會靜默通過）', () => {
    expect(FILES.length).toBeGreaterThan(50);
    expect(collectDefinedVars(FILES).size).toBeGreaterThan(50);
  });

  it('閘門值 1：全站無 fallback 的未定義 CSS 變數引用數為 0', () => {
    expect(scan(FILES).undefinedNoFallback).toEqual([]);
  });

  it('閘門值 2：全站 fallback 為寫死色碼的 var() 引用數為 0', () => {
    expect(scan(FILES).colorLiteralFallback).toEqual([]);
  });
});
