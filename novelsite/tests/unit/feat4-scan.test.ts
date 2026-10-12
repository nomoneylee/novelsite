import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * FEAT-4 交付前的全站掃描（T151；FR-017／FR-018／FR-019／FR-040／FR-041／FR-043a／
 * FR-064／FR-065）
 * ================================================================================
 * 逐項任務清單能保證「被列到的那幾行改了」，保證不了「沒有第十一處」。
 * FR-065 明訂驗收以**全站掃描**而非逐項清單進行，FR-064 則明訂稽核對象限於
 * 本階段新增的樣式 —— 兩者範圍不同，混在同一次掃描裡是本檔先前無法執行的原因：
 *
 *   - **甲、全 `src/` 掃描**：造假資料來源、已失效的文案主張、假成功提示。
 *     這三類在全站任何一處都不該存在。
 *   - **乙、僅限本階段新增的樣式**：硬編色碼與 `Math.random()` 產生的元件 id。
 *     掃全站只有兩個結局 —— 恆紅的測試，或為了轉綠去改一票與本需求無關的既有檔案，
 *     而後者直接違反憲章「MUST NOT 順手重構未壞的相鄰程式碼」。
 *
 * 掃描以測試而非一次性的 `grep` 實作：`grep` 的結果只存在於當下那個終端機裡，
 * 下一個人把字串加回來時不會有任何東西變紅（同 `layering.test.ts` 的結論）。
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

const FILES: SourceFile[] = collectSources(SRC).map((file) => ({
  path: rel(file),
  source: fs.readFileSync(file, 'utf8'),
}));

const CODE_FILES = FILES.filter((f) => /\.tsx?$/.test(f.path));

/**
 * 去掉註解後的程式碼。
 *
 * **只用於甲之一（造假來源識別字）**：一則寫著「`SAMPLE_REVIEWS` 已刪除」的註解
 * 是刪除的紀錄，不是一個造假來源；把它判紅會逼人刪掉唯一寫著理由的那句話，
 * 而下一個人就會把常數加回來。
 *
 * `[^:]` 是為了不把 `https://` 之後的內容當成行註解切掉。
 * 這是啟發式而非剖析器 —— 它可能少切一點（誤判為程式碼），但 MUST NOT 多切
 * （多切會讓真正的命中消失，測試恆綠）。
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

// ─────────────────────────────────────────────────────────────────────────────
// 甲之一：造假資料來源的識別字（FR-019／FR-040／FR-043a）
// ─────────────────────────────────────────────────────────────────────────────

describe('T151 甲-1：造假資料來源已自程式碼消失（FR-019／FR-040／FR-043a）', () => {
  const FAKE_SOURCES = [
    'getAuthorDailyStats',
    'SEED_READING_HISTORY',
    'WEEKLY_RANKING',
    'MONTHLY_RANKING',
    'ALL_TIME_RANKING',
    'SAMPLE_REVIEWS',
  ];

  it('掃描範圍非空（收集邏輯壞掉時整組檢查會靜默通過）', () => {
    expect(CODE_FILES.length).toBeGreaterThan(50);
  });

  for (const identifier of FAKE_SOURCES) {
    it(`全 src 的程式碼（不含註解）內無 \`${identifier}\``, () => {
      const offenders = CODE_FILES.filter((f) => stripComments(f.source).includes(identifier)).map(
        (f) => f.path
      );
      expect(offenders).toEqual([]);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 甲之二：已失效的文案主張（FR-017／FR-018／FR-041）
// ─────────────────────────────────────────────────────────────────────────────

describe('T151 甲-2：已失效的文案主張不得殘留（FR-017／FR-018／FR-041）', () => {
  /**
   * **註解一併納入掃描範圍**，且清單刻意比原始任務多兩個字串。
   *
   * 原清單只有「僅保存在此瀏覽器」，而 `NovelHero.tsx`、`BookshelfView.tsx`、
   * `ReadingHistoryView.tsx`、`ReaderView.tsx` 四處**註解**寫的是
   * 「僅存於瀏覽器本機，換裝置不會同步」—— 既不在逐項任務清單內、也掃不到，
   * 會完整活過整個階段，然後在下一位維護者眼中變成現況說明。
   * FR-017 禁止的是**主張**，不是某一個字串。
   */
  const STALE_CLAIMS = [
    '僅保存在此瀏覽器',
    '換裝置不會同步',
    '僅存於瀏覽器',
    '尚未接上',
    '部分示範',
    // FEAT-5（T057）：密碼重設與聯絡表單接通後，這兩句同樣是已失效的主張。
    // `尚無密碼重設功能` 在 `src/` 原有**兩處**（`LoginForm.tsx`、`RegisterForm.tsx`），
    // 兩處自始就是一組（arch.md §7.2「登入頁明示 ＋ 註冊流程於送出前告知同一件事」）——
    // 漏掉任一處這則就紅，而紅燈與實作進度無關。
    '尚無密碼重設功能',
    '尚無法送出訊息',
  ];

  for (const claim of STALE_CLAIMS) {
    it(`全 src（含註解）內無「${claim}」`, () => {
      const offenders = FILES.filter((f) => f.source.includes(claim)).map((f) => f.path);
      expect(offenders).toEqual([]);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 甲之二 b：README 的已失效主張（FEAT-5 T058／FR-026）
// ─────────────────────────────────────────────────────────────────────────────

describe('T058 甲-2b：README 內無已失效的階段性主張（FEAT-5 FR-026）', () => {
  /**
   * **刻意是一份與甲-2 分開的清單，MUST NOT 併入甲-2**（research R-14）。
   *
   * 甲-2 掃的是 `src/`，其清單含 `僅保存在此瀏覽器` —— 而那句話**現在就寫在 README 裡**
   * （FEAT-4 的已解除列刻意引用了原文，好讓讀者知道被解除的是哪一句主張）。
   * 把 README 併進甲-2，測試會在任何人動一行程式碼之前就先紅，而紅的原因與交付無關。
   *
   * 反過來說，README 的已解除列**MUST NOT 引用 FEAT-5 這兩句原文**（連刪除線引用都不行），
   * 否則本則恆紅 —— 這也是 T055／T056 改寫時的約束。
   */
  const README = path.resolve(__dirname, '../../README.md');
  const README_STALE_CLAIMS = ['尚無密碼重設功能', '尚無法送出訊息'];

  const readme = fs.readFileSync(README, 'utf8');

  it('README 讀得到且非空（讀檔壞掉時整組檢查會靜默通過）', () => {
    expect(readme.length).toBeGreaterThan(1000);
  });

  for (const claim of README_STALE_CLAIMS) {
    it(`README.md 內無「${claim}」`, () => {
      expect(readme.includes(claim)).toBe(false);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 甲之三：假成功提示（FR-065）
// ─────────────────────────────────────────────────────────────────────────────

describe('T151 甲-3：宣告成功的提示必須位於實際寫入的回應分支內（FR-065）', () => {
  /**
   * 判準：訊息中含「成功」二字的 `showToast(...)`，其**所在的函式**內
   * MUST 同時具備 `await`（真的等過寫入）與失敗處理（`catch`／`.success`／
   * `res.ok` 之一）。少了 await 就是還沒寫入就先報喜；少了失敗處理就是
   * 不論結果都報喜 —— 兩者都會讓提示與實際寫入結果不一致。
   *
   * **函式邊界**以縮排推定：本專案的處理函式一律是元件內縮排 2 格的 `const`
   * 宣告，故自命中行往回找到第一個縮排 ≤ 2 的宣告列即為該函式的開頭。
   *
   * **本規則的邊界（刻意不擴大）**：判準綁在「成功」這兩個字上，
   * 樂觀更新式的提示（例如按下即顯示「已加入書架」、失敗時才回捲畫面）
   * 不在本規則的射程內 —— 那是既有的互動模式，改寫它屬於另一個需求。
   */
  const SUCCESS_TOAST = /showToast\(\s*[`'"][^`'"]*成功/;
  const FUNCTION_START = /^ {0,2}(export\s+)?(const|async\s+function|function)\s/;

  function enclosingFunction(lines: string[], index: number): string {
    let start = 0;
    for (let i = index; i >= 0; i--) {
      if (FUNCTION_START.test(lines[i])) {
        start = i;
        break;
      }
    }
    let end = lines.length;
    for (let i = index + 1; i < lines.length; i++) {
      if (FUNCTION_START.test(lines[i])) {
        end = i;
        break;
      }
    }
    return lines.slice(start, end).join('\n');
  }

  const occurrences = CODE_FILES.flatMap((file) => {
    const lines = file.source.split(/\r?\n/);
    return lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => SUCCESS_TOAST.test(line))
      .map(({ index }) => ({
        where: `${file.path}:${index + 1}`,
        body: enclosingFunction(lines, index),
      }));
  });

  it('掃描確實命中了既有的成功提示（0 筆代表樣式寫錯，而非全站沒有提示）', () => {
    expect(occurrences.length).toBeGreaterThan(0);
  });

  it('每一則成功提示所在的函式都等過寫入（含 await）', () => {
    const offenders = occurrences.filter((o) => !o.body.includes('await')).map((o) => o.where);
    expect(offenders).toEqual([]);
  });

  it('每一則成功提示所在的函式都處理了失敗路徑', () => {
    const handled = /catch|\.success|res\.ok|result\.error/;
    const offenders = occurrences.filter((o) => !handled.test(o.body)).map((o) => o.where);
    expect(offenders).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 乙：硬編色碼與隨機元件 id —— 僅限本階段新增／修改的檔案（FR-064、憲章第 V 條）
// ─────────────────────────────────────────────────────────────────────────────

describe('T151 乙：本階段的樣式不得硬編色碼或以亂數產生元件 id（FR-064）', () => {
  /**
   * 清單取自 `git diff --name-only main...HEAD -- novelsite/src/`（2026-08-08）。
   *
   * **為何凍結成常數而非在測試裡跑 git**：本分支併回 `main` 之後
   * `main...HEAD` 會變成空集合，掃描範圍隨之歸零 —— 一個併入後就自動失效的
   * 驗收測試等於沒有驗收。FR-064 的稽核對象是一組**固定的歷史事實**
   * （FEAT-4 動過的那些檔案），把它寫成常數才是它真正的形狀。
   *
   * 唯一自 git 清單移除的是本階段**刪除**的 `lib/content.ts` —— 已不存在的檔案
   * 沒有樣式可稽核，留在清單裡只會讓下面那則「檔案全數存在」恆紅。
   */
  const CHANGED_FILES = [
    'app/api/author/comments/[id]/route.ts',
    'app/api/author/comments/route.ts',
    'app/api/bookshelf/[novelId]/route.ts',
    'app/api/bookshelf/route.ts',
    'app/api/chapters/[id]/comments/route.ts',
    'app/api/chapters/[id]/view/route.ts',
    'app/api/comments/[id]/route.ts',
    'app/api/cron/publish-scheduled/route.ts',
    'app/api/cron/rankings/route.ts',
    'app/api/cron/rollup-stats/route.ts',
    'app/api/history/route.ts',
    'app/api/notifications/[id]/route.ts',
    'app/api/notifications/route.ts',
    'app/api/novels/[id]/reviews/route.ts',
    'app/api/reader-preference/route.ts',
    'app/api/reader-state/merge/route.ts',
    'app/api/reading-progress/route.ts',
    'app/api/reviews/[id]/like/route.ts',
    'app/api/reviews/[id]/route.ts',
    'app/author/actions.ts',
    'app/author/comments/page.module.css',
    'app/author/comments/page.tsx',
    'app/author/dashboard/page.tsx',
    'app/author/earn/page.module.css',
    'app/author/earn/page.tsx',
    'app/novels/[id]/page.tsx',
    'app/page.tsx',
    'app/profile/notifications/page.tsx',
    'app/ranking/page.tsx',
    'app/reader/[novelId]/[chapterId]/page.tsx',
    'components/SessionProvider.tsx',
    'components/author/AuthorCommentList.module.css',
    'components/author/AuthorCommentList.tsx',
    'components/author/AuthorDashboardView.module.css',
    'components/author/AuthorDashboardView.tsx',
    'components/author/AuthorSidebar.tsx',
    'components/author/ChapterEditor.module.css',
    'components/author/ChapterEditor.tsx',
    'components/home/HeroSection.module.css',
    'components/home/RankingWidget.module.css',
    'components/home/RankingWidget.tsx',
    'components/layout/SiteHeader.module.css',
    'components/layout/SiteHeader.tsx',
    'components/novel/NovelHero.tsx',
    'components/novel/ReviewSection.module.css',
    'components/novel/ReviewSection.tsx',
    'components/profile/BookshelfView.tsx',
    'components/profile/NotificationCenter.module.css',
    'components/profile/NotificationCenter.tsx',
    'components/profile/ReadingHistoryView.tsx',
    'components/ranking/RankingPageView.module.css',
    'components/ranking/RankingPageView.tsx',
    'components/reader/ChapterCommentSection.module.css',
    'components/reader/ChapterCommentSection.tsx',
    'components/reader/ReaderView.tsx',
    'hooks/useBookshelf.ts',
    'hooks/useBookshelfIds.ts',
    'hooks/useProgressReporter.ts',
    'hooks/useReaderPrefs.ts',
    'hooks/useReaderStateMerge.ts',
    'hooks/useReadingHistory.ts',
    'hooks/useTheme.ts',
    'lib/auth/guard.ts',
    'lib/auth/origin.ts',
    'lib/auth/rateLimit.ts',
    'lib/auth/routeHelpers.ts',
    'lib/env.ts',
    'lib/mockData.ts',
    'lib/pagination/cursor.ts',
    'lib/reader/bookshelfApi.ts',
    'lib/reader/preferenceApi.ts',
    'lib/reader/progressReporter.ts',
    'lib/reader/readerStateMerge.ts',
    'lib/repositories/authors.ts',
    'lib/repositories/bookshelf.ts',
    'lib/repositories/chapters.ts',
    'lib/repositories/comments.ts',
    'lib/repositories/index.ts',
    'lib/repositories/mappers.ts',
    'lib/repositories/notifications.ts',
    'lib/repositories/novels.ts',
    'lib/repositories/rankings.ts',
    'lib/repositories/reading.ts',
    'lib/repositories/reviews.ts',
    'lib/repositories/stats.ts',
    'lib/repositories/users.ts',
    'lib/services/bookshelfService.ts',
    'lib/services/chapterService.ts',
    'lib/services/commentService.ts',
    'lib/services/notificationService.ts',
    'lib/services/preferenceService.ts',
    'lib/services/rankingService.ts',
    'lib/services/readingService.ts',
    'lib/services/reviewService.ts',
    'lib/services/statsService.ts',
    'lib/stats/viewerHash.ts',
    'lib/time/taipeiDay.ts',
    'lib/types.ts',
    'lib/validation/chapter.ts',
    'lib/validation/comment.ts',
    'lib/validation/common.ts',
    'lib/validation/notification.ts',
    'lib/validation/reader.ts',
    'lib/validation/review.ts',
    'styles/design-tokens.css',
  ];

  /** `#rrggbb`／`rgb(`／`rgba(`／`Math.random(` 的字面值 */
  const HARDCODED = /#[0-9a-fA-F]{3,8}\b|rgba?\(|Math\.random\(/g;

  /**
   * 既有基線：**FEAT-4 之前就在的行**，本階段只因其他理由碰過所在的檔案。
   *
   * 以「命中次數」而非行號比對：行號會隨任何一次無關的編輯漂移，
   * 而次數只在真的多出一個硬編色碼時才會變 —— 那正是要擋的事。
   *
   * 這些 MUST NOT 於本階段順手修改（憲章「變更範圍」），並 MUST 於
   * `README.md` 的「已知基線」一節誠實列出（T156）。
   */
  const BASELINE_HITS: Record<string, number> = {
    // Chart.js 的資料集色。圖表函式庫收的是具體色值字串，吃不了 CSS 變數；
    // 這四處自 FEAT-4 之前即存在（本階段只換掉資料來源，沒動樣式）
    'components/author/AuthorDashboardView.tsx': 4,
    // 排行榜名次徽章與漲跌色，FEAT-1 既有
    'components/home/RankingWidget.module.css': 8,
    // 首頁 Hero 的疊字底色與輪播圓點色，FEAT-1 既有。
    // 本階段只把圓點的**命中區**撐到 24px（T155），沒有動任何色值
    'components/home/HeroSection.module.css': 41,
    /**
     * 設計 token 的定義處。**這裡的色碼是「唯一該有色碼的地方」** ——
     * FR-064 要求元件的樣式取自 token，而 token 自己必須是具體值。
     * 本階段只新增了一個 `--color-on-accent`（T151）；其餘 149 處為既有調色盤。
     *
     * 2026-08-19 Hero 可讀性修正 +6：新增 `--color-on-hero` / `--color-on-hero-strong` /
     * `--color-on-hero-hover-bg` / `--hero-scrim` / `--hero-text-shadow`。
     * 透明 Header 疊在 Hero 上必須改用淺色前景，而這組值三個主題共用、
     * 既有 token 沒有這個語意；依 FR-064，色值只能落在 token 定義處。
     *
     * 2026-09-06 FEAT-9 後台 UI 重構 +6：三個主題各新增 `--viz-series-1` /
     * `--viz-series-2`（圖表資料序列色）。原本 Chart.js 的序列色是**寫死在
     * `AdminChart.tsx` 裡的 hex**，切主題不會變、夜間模式對比不足；依 FR-064
     * 把色值移進 token 定義處，元件改以 `getComputedStyle` 讀取。
     * 六組值皆經 dataviz `validate_palette.js` 六項檢查通過。
     */
    'styles/design-tokens.css': 162,
    'components/ranking/RankingPageView.module.css': 1,
    'components/layout/SiteHeader.module.css': 1,
    'app/author/earn/page.module.css': 1,
    // 示範作品的封面漸層，屬**資料**而非樣式；本階段只刪掉其中的排行常數
    'lib/mockData.ts': 51,
  };

  const byPath = new Map(FILES.map((f) => [f.path, f.source]));

  it('凍結清單中的檔案全數存在（檔案改名後這份清單會靜默失去作用）', () => {
    const missing = CHANGED_FILES.filter((p) => !byPath.has(p));
    expect(missing).toEqual([]);
  });

  it('本階段動過的檔案中，硬編色碼與亂數 id 的數量未超出既有基線', () => {
    const unexpected: string[] = [];
    for (const filePath of CHANGED_FILES) {
      const source = byPath.get(filePath);
      if (source === undefined) continue;
      const count = (source.match(HARDCODED) ?? []).length;
      const allowed = BASELINE_HITS[filePath] ?? 0;
      if (count !== allowed) unexpected.push(`${filePath}：實際 ${count} 處，基線 ${allowed} 處`);
    }
    expect(unexpected).toEqual([]);
  });

  it('基線清單本身沒有列到早已清乾淨的檔案（過期的例外會遮蔽真正的新增）', () => {
    const stale = Object.keys(BASELINE_HITS).filter(
      (p) => ((byPath.get(p) ?? '').match(HARDCODED) ?? []).length === 0
    );
    expect(stale).toEqual([]);
  });
});
