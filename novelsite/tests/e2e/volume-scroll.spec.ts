import { test, expect, type Page } from '@playwright/test';
import { loadTestEnv } from '../testEnv';

/**
 * 作品管理頁的卷內章節瀏覽（FEAT-10）
 * ====================================
 * 本檔由 Phase 1（T003）建立骨架，Phase 5（T023，摺疊／鍵盤／操作後仍展開）與
 * Phase 7（T030，作品資訊表單的儲存後同步）都往這裡追加案例。
 *
 * **為何骨架屬於 Setup 而不屬於任一 user story**：兩個階段共用同一份登入與同一份
 * 測試資料，而 FR-020 與摺疊功能毫無交集 —— 若讓 Phase 5 建檔，Phase 7 就無法
 * 如設計所述地獨立於摺疊功能執行。
 *
 * **登入 MUST 只做一次，之後靠 Cookie 重放**：`LOGIN_RATE_ACCOUNT_MAX` 預設為 5
 * （`src/lib/env.ts`），每個測試各登入一次的話，第 6 個會撞上帳號層限流，
 * 症狀是 `waitForURL` 逾時而不是任何斷言失敗（同 `admin-flow.spec.ts` 的結論）。
 *
 * **測試資料由本檔自行建立，不借用示範作品**：示範作品的 `authorId` 是
 * `content-author-N`（`prisma/seed.ts`），那些帳號的密碼是隨機且不外印的，
 * 登入不進去，也就管理不到。示範登入帳號 `author@novelsite.tw` 角色已是 `author`
 * 但**一部作品也沒有**，故於 `beforeAll` 現建一部。這樣本檔單獨執行
 * （`npx playwright test tests/e2e/volume-scroll.spec.ts`）也成立，
 * 不依賴 `author-flow` 是否先跑過。
 *
 * **MUST NOT 斷言 `scrollTop` 或 `toBeInViewport()`**：本檔建立的卷只有幾章，
 * 不會產生捲軸，那兩種斷言會恆真地通過（research R-8）。捲動位置的驗證
 * 由手動步驟（T034）承載。
 */

const SEED_PASSWORD = loadTestEnv().SEED_USER_PASSWORD;
const AUTHOR_EMAIL = 'author@novelsite.tw';

/** 每次執行都用不同的標題，避免同一份 e2e.db 連跑兩次時分不出新舊 */
const RUN_ID = Date.now().toString(36);
const NOVEL_TITLE = `FEAT-10 卷內捲動測試作品 ${RUN_ID}`;
const VOLUME_TITLE = `第一卷 卷內捲動 ${RUN_ID}`;

/** 本檔建立的章節數。排序（上移／下移）與批次選取都需要一卷內有多章 */
const CHAPTER_COUNT = 3;

let authorCookies: Awaited<ReturnType<import('@playwright/test').BrowserContext['cookies']>>;

/** `beforeAll` 建立的作品 id，由管理頁網址解析而來 */
let novelId: string;

/** 作品管理頁 */
function managePath(): string {
  return `/author/novels/${novelId}`;
}

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext();
  const page: Page = await context.newPage();

  await page.goto('/auth/login');
  await page.getByLabel('Email').fill(AUTHOR_EMAIL);
  await page.getByLabel('密碼').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: /登入/ }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/auth/login'));

  // ── 建立作品：成功後由 Server Action 轉址至管理頁，novelId 自網址解析 ──
  await page.goto('/author/create');
  await page.getByLabel('作品名稱').fill(NOVEL_TITLE);
  await page.getByLabel('作品簡介').fill('由 FEAT-10 端對端測試建立，用於驗證卷內章節瀏覽。');
  await page.getByRole('button', { name: '建立作品' }).click();
  await page.waitForURL(/\/author\/novels\/[^/]+$/);
  novelId = new URL(page.url()).pathname.split('/').pop()!;
  expect(novelId, '建立作品後未能自網址解析出 novelId').toBeTruthy();

  // ── 建卷：章節必須歸屬於某一卷 ──
  await page.getByLabel('新增卷（編號由系統指派）').fill(VOLUME_TITLE);
  await page.getByRole('button', { name: '新增卷' }).click();
  await expect(page.getByRole('button', { name: '新增章節' })).toBeVisible();

  /*
    建章節：「新增章節」會建立空白草稿並**直接轉入編輯器**，故每建一章就要回管理頁。
    標題留白的草稿在清單上分不出彼此，這裡逐章命名 —— 排序測試要能指名道姓地
    斷言「第 2 章的標題現在是哪一篇」，只有「未命名」的話那個斷言寫不出來。
  */
  for (let i = 1; i <= CHAPTER_COUNT; i++) {
    await page.goto(managePath());
    await page.getByRole('button', { name: '新增章節' }).click();
    await page.waitForURL(/\/author\/editor\/[^/]+$/);
    await page.getByLabel('章節標題').fill(`測試章節 ${i}（${RUN_ID}）`);
    await page.getByLabel('章節正文').fill(`第 ${i} 章的正文。（${RUN_ID}）`);
    await page.getByRole('button', { name: '儲存草稿' }).click();
    // 儲存進行中按鈕為 disabled；等它回到可按再往下走，否則下一次導覽會搶在儲存完成之前
    await expect(page.getByRole('button', { name: '儲存草稿' })).toBeEnabled();
  }

  authorCookies = await context.cookies();
  await context.close();
});

test.describe('FEAT-10 作品管理頁：卷內章節瀏覽', () => {
  test.beforeEach(async ({ context }) => {
    await context.addCookies(authorCookies);
  });

  test('smoke：作品管理頁開得起來，章節區塊與本卷章節都在', async ({ page }) => {
    await page.goto(managePath());

    await expect(page.getByRole('heading', { name: '章節', level: 2 })).toBeVisible();
    /*
      卷名在本頁出現**兩次**（上方「分卷」區的清單一次、下方「章節」區的卷標題一次），
      不限定範圍的 `getByText` 會撞上 strict mode。這裡要的是章節區的那一個 —— `h3`。
    */
    await expect(page.getByRole('heading', { level: 3, name: new RegExp(RUN_ID) })).toBeVisible();

    // 章節真的建起來了 —— 少了這條，後續階段的失敗會指向摺疊功能而不是資料前提
    for (let i = 1; i <= CHAPTER_COUNT; i++) {
      await expect(page.getByRole('link', { name: `測試章節 ${i}（${RUN_ID}）` })).toBeVisible();
    }
  });
});

/**
 * 摺疊、鍵盤與「操作之後仍展開」（FEAT-10 T023；FR-003／FR-004／FR-011／FR-013）
 * ============================================================================
 * **沿用上方 describe 的 `beforeEach` Cookie 重放，MUST NOT 自己再登入一次**
 * （`LOGIN_RATE_ACCOUNT_MAX` 預設 5，第 6 次登入會撞帳號層限流）。
 *
 * **「新增章節後仍展開」不在本組之內**：`createChapterAction` 成功後
 * `redirect('/author/editor/<id>')`（`src/app/author/actions.ts:155`）——
 * 頁面直接離開管理頁，沒有「操作後」的展開狀態可斷言。FR-011 於本組
 * 改以**排序／批次發佈／刪除**三種留在原頁的操作承載，它們走的都是同一條
 * `run()` + `router.refresh()` 路徑，是同一個失效機制。
 *
 * **MUST NOT 斷言 `scrollTop` 或 `toBeInViewport()`**：本檔的卷只有三章、
 * 不會產生捲軸，那兩種斷言恆真（research R-8）。捲動位置由 T034 手動驗證。
 *
 * **本組會改動資料**（排序、發佈、刪除各一次），故刪除排在最後 ——
 * 前面的案例都還看得到三章。
 */
test.describe('FEAT-10 摺疊狀態與操作後的存續', () => {
  test.beforeEach(async ({ context }) => {
    await context.addCookies(authorCookies);
  });

  /** 章節區的卷展開／收合控制。上方「分卷」區的同名文字是 `<span>`，不會撞名 */
  function volumeToggle(page: Page) {
    return page.getByRole('button', { name: /^第 1 卷・/ });
  }

  function chapterLink(page: Page, index: number) {
    return page.getByRole('link', { name: `測試章節 ${index}（${RUN_ID}）` });
  }

  test('單卷作品預設展開，控制項可收合再展開（FR-003／FR-004）', async ({ page }) => {
    await page.goto(managePath());

    const toggle = volumeToggle(page);
    // 本作品只有一卷 —— 預設展開（contracts §5）
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(chapterLink(page, 1)).toBeVisible();

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    /*
      收合是**條件渲染**而非 `hidden`（T016、research R-3）：DOM 裡完全不留下那些列，
      故斷言 `toHaveCount(0)` 而非 `not.toBeVisible()` —— 後者對 `hidden` 保留 DOM
      的實作也會通過，那樣 Ctrl+F 仍搜得到看不見的章節。
    */
    await expect(chapterLink(page, 1)).toHaveCount(0);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(chapterLink(page, 1)).toBeVisible();
  });

  test('鍵盤 Enter 與空白鍵都能切換展開狀態（FR-003）', async ({ page }) => {
    await page.goto(managePath());

    const toggle = volumeToggle(page);
    await toggle.focus();
    await expect(toggle).toBeFocused();

    /*
      這一條**只有真實瀏覽器驗得到**：jsdom 不實作按鈕的 activation behavior，
      對 `<button>` 送 keyDown 不會派送 click（見 `tests/a11y/volume-collapse.test.tsx`）。
      要防的失效是「用 `<div onClick>` 做摺疊控制」—— 那種寫法在這裡按不動。
    */
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await page.keyboard.press('Space');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  test('重新整理後回到預設狀態，展開狀態 MUST NOT 被持久化（FR-013）', async ({ page }) => {
    await page.goto(managePath());

    const toggle = volumeToggle(page);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await page.reload();
    // 單卷的預設是展開；若這裡仍是收合，代表有人把狀態存進了 sessionStorage 或查詢字串
    await expect(volumeToggle(page)).toHaveAttribute('aria-expanded', 'true');
  });

  test('排序之後該卷仍為展開狀態（FR-011）', async ({ page }) => {
    await page.goto(managePath());

    const toggle = volumeToggle(page);
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    const before = await page.getByRole('link', { name: /^測試章節 \d+（/ }).allTextContents();
    await page.getByRole('button', { name: `將〈${before[1]}〉往前移一位` }).click();
    await expect(page.getByText('章節順序已更新')).toBeVisible();

    /*
      排序走 `run()` + `router.refresh()`（軟刷新、元件不重建）。
      這一條紅掉的典型原因是有人給卷區塊加了會變動的 `key`，或把 `novel` 複製進
      `useState` —— 兩者都會讓展開狀態在每次操作後歸零（research R-3 三條 MUST NOT）。
    */
    await expect(volumeToggle(page)).toHaveAttribute('aria-expanded', 'true');
    const after = await page.getByRole('link', { name: /^測試章節 \d+（/ }).allTextContents();
    expect(after[0], '被上移的章節 MUST 換到第一位').toBe(before[1]);
  });

  test('批次發佈之後該卷仍為展開狀態（FR-011）', async ({ page }) => {
    await page.goto(managePath());

    await page.getByRole('button', { name: '全選本卷' }).click();
    await page.getByRole('button', { name: '批次發佈' }).click();
    await page.getByRole('button', { name: '確認發佈' }).click();

    /*
      等待訊號 MUST 是**只有發佈成功才會出現**的東西。用 `getByText(/已發佈/)` 是不行的：
      頁首的「N 章已發佈」與每一列的狀態徽章一直都在，那條斷言不等任何事情就會通過，
      後面的 `aria-expanded` 於是變成在刷新完成之前量測的。
      卷摘要（FR-002）在發佈後由「草稿 N」翻成「已發佈 N」，那才是本次操作的實質結果。
    */
    await expect(volumeToggle(page)).toHaveAccessibleName(
      new RegExp(`已發佈 ${CHAPTER_COUNT}・草稿 0`)
    );
    await expect(volumeToggle(page)).toHaveAttribute('aria-expanded', 'true');
  });

  test('刪除章節之後該卷仍為展開狀態（FR-011）', async ({ page }) => {
    await page.goto(managePath());

    const victim = `測試章節 ${CHAPTER_COUNT}（${RUN_ID}）`;
    await page.getByRole('button', { name: `刪除〈${victim}〉` }).click();
    await page.getByRole('button', { name: '確認刪除' }).click();

    await expect(page.getByText(`〈${victim}〉已刪除`)).toBeVisible();
    await expect(volumeToggle(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('link', { name: victim })).toHaveCount(0);
  });
});

/**
 * 作品資訊表單的重填時機（FEAT-10 T030；FR-020、contracts §7）
 * ==========================================================
 * **兩個方向都要驗，而第二條更重要**：只驗第一條的話，最省事的錯誤實作
 * （props 一變就重填）會通過測試，而它會在作者打字打到一半時清掉輸入 ——
 * 一個比原本嚴重得多的問題。
 *
 * **第二條的觸發方式改用「排序」，不是原訂的「新增章節」**
 * （`/speckit-implement` T030 實測，2026-09-06）：`createChapterAction` 成功後
 * `redirect('/author/editor/<id>')`，頁面直接離開管理頁，「再返回」是一次全新的頁面載入，
 * 表單本來就會以伺服器值重填 —— 那樣的斷言驗不到「props 更新時要不要重填」這件事。
 * 排序、批次發佈、上下架都留在本頁、都走同一條 `run()` + `router.refresh()`，
 * 是同一個失效機制；取其中一個即可。
 *
 * 沿用本檔的 `beforeAll` 登入，MUST NOT 自己再登入一次。
 */
test.describe('FEAT-10 作品資訊表單的重填時機（FR-020）', () => {
  test.beforeEach(async ({ context }) => {
    await context.addCookies(authorCookies);
  });

  test('自己儲存成功後，畫面顯示的是伺服器修剪過的值（SC-008）', async ({ page }) => {
    await page.goto(managePath());

    const title = page.getByLabel('作品名稱');
    // 伺服器端 `validation/novel.ts` 會 trim；表單狀態不會 —— 這就是 FR-020 的缺陷
    await title.fill(`  ${NOVEL_TITLE}  `);
    await page.getByRole('button', { name: '儲存作品資訊' }).click();
    await expect(page.getByText('作品資訊已更新')).toBeVisible();

    /*
      存的是「標題」，畫面卻還是「  標題  」，而下一次儲存會再送一次未修剪的值。
      嚴重度低，但它讓「畫面上看到的」與「實際存的」長期不一致。
    */
    await expect(title).toHaveValue(NOVEL_TITLE);
  });

  test('本頁其他操作觸發刷新時，未儲存的輸入 MUST 原樣保留（contracts §7 第二列）', async ({
    page,
  }) => {
    await page.goto(managePath());

    const title = page.getByLabel('作品名稱');
    const draft = `${NOVEL_TITLE}（打到一半，沒有儲存）`;
    await title.fill(draft);

    // 排序留在本頁且會 router.refresh()，與新增章節、批次發佈、上下架是同一條路徑
    await page
      .getByRole('button', { name: /往後移一位$/ })
      .first()
      .click();
    await expect(page.getByText('章節順序已更新')).toBeVisible();

    /*
      **這一條是「props 一變就重填」的照妖鏡**：那種一行版本會讓這裡的輸入被伺服器值蓋掉，
      作者捲下去按個新增章節回來，打了一半的簡介就沒了 ——
      用一個空白字元的問題換一個資料遺失的問題（research R-9）。
    */
    await expect(title).toHaveValue(draft);
  });
});
