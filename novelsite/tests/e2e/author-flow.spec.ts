import os from 'node:os';
import path from 'node:path';
import { test, expect, type Page, type Request } from '@playwright/test';
import { loadTestEnv } from '../testEnv';

/**
 * 端對端：作者流（FR-038、`arch.md` §10.4 流程 2）
 * ================================================
 * 以**讀者**帳號起步，走完：
 *   登入 → 開通作者 → 建立作品 → 建卷 → 寫章節 → 發佈章節 → 上架作品
 *   → **另一個瀏覽器情境（未登入訪客）讀到該章正文**
 *
 * 最後一步是整條流程的意義所在。前面每一步都可以用整合測試逐一驗證，
 * 但「作者按完那一串按鈕之後，一個素未謀面的訪客真的讀得到那段文字」
 * 這件事只有走一次完整的瀏覽器旅程才算數 —— 中間任何一處的轉址、
 * 快取或權限判斷出錯，都會讓結果是空白頁而不是錯誤訊息。
 *
 * **不使用固定的測試帳號名稱以外的任何硬編識別碼**：作品與章節的 id 由系統指派，
 * 一律自畫面上的網址解析。
 */

/**
 * `playwright.config.ts` 的 `webServer.env` 只套用到**伺服器行程**，
 * 測試行程自己讀不到 `.env.test`（初版即因此 `fill(undefined)` 而失敗）。
 * 一律經 `loadTestEnv()` 取，與三個 vitest 設定檔同一個來源。
 */
const SEED_PASSWORD = loadTestEnv().SEED_USER_PASSWORD;
const READER_EMAIL = 'reader@novelsite.tw';

/** 每次執行都用不同的標題，避免同一個 e2e.db 連跑兩次時分不出新舊 */
const RUN_ID = Date.now().toString(36);
const NOVEL_TITLE = `E2E 作者流測試作品 ${RUN_ID}`;
const CHAPTER_TITLE = `第一章 破曉 ${RUN_ID}`;
const CHAPTER_BODY = [
  `晨光尚未破曉，蕭塵已提劍立於崖邊。（${RUN_ID}）`,
  '',
  '「這一劍，斬的不是敵人，而是過去的自己。」',
].join('\n');

async function login(page: Page): Promise<void> {
  await page.goto('/auth/login');
  await page.getByLabel('Email').fill(READER_EMAIL);
  await page.getByLabel('密碼').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: '登入' }).click();
  await expect(page).not.toHaveURL(/\/auth\/login/);
}

test.describe('作者流：從讀者到讀者讀得到', () => {
  test('登入 → 開通作者 → 建立作品 → 發佈章節 → 訪客讀到正文', async ({ page, browser }) => {
    // ── 1. 以讀者身分登入 ──
    await login(page);

    // ── 2. 自助開通作者（FR-023）──
    await page.goto('/profile/settings');
    const upgradeSection = page.locator('section').filter({ hasText: '成為作者' });
    await upgradeSection.getByLabel('筆名').fill(`E2E 筆名 ${RUN_ID}`);
    await upgradeSection.getByRole('button', { name: '開通作者身分' }).click();

    // 等升級真的完成再往下走：成功後畫面重新整理，該區塊會消失
    // （已是作者的人不該看到一個必定回 409 的按鈕）。
    // 少了這個等待，下一行的 goto 會搶在補發的 Cookie 寫回之前送出，
    // proxy 讀到舊的 reader 角色快照就把它導向首頁 —— 而失敗訊息會指向一個沒問題的斷言
    await expect(upgradeSection).toHaveCount(0, { timeout: 15_000 });

    // 「本裝置無須重新登入」：升級後**直接**進得了作者後台，中間沒有登入頁
    await page.goto('/author/novels');
    await expect(page).toHaveURL(/\/author\/novels/);

    // ── 3. 建立作品（FR-012）──
    await page.goto('/author/create');
    await page.getByLabel('作品名稱').fill(NOVEL_TITLE);
    await page.getByLabel('作品簡介').fill('由端對端測試建立，用於驗證作者流可完整走通。');
    await page.getByRole('button', { name: '建立作品' }).click();

    // 建立成功後由 Action 轉址至作品管理頁，novelId 自網址解析
    await page.waitForURL(/\/author\/novels\/[^/]+$/);
    const novelId = new URL(page.url()).pathname.split('/').pop()!;
    expect(novelId).toBeTruthy();

    // ── 4. 建卷（章節必須歸屬於某一卷，FR-003c）──
    await page.getByLabel('新增卷（編號由系統指派）').fill('第一卷 少年篇');
    await page.getByRole('button', { name: '新增卷' }).click();
    await expect(page.getByRole('button', { name: '新增章節' })).toBeVisible();

    // ── 5. 建立章節（系統建空白草稿後轉入編輯器）──
    await page.getByRole('button', { name: '新增章節' }).click();
    await page.waitForURL(/\/author\/editor\/[^/]+$/);
    const chapterId = new URL(page.url()).pathname.split('/').pop()!;

    // ── 6. 撰寫並發佈（FR-013）──
    await page.getByLabel('章節標題').fill(CHAPTER_TITLE);
    await page.getByLabel('章節正文').fill(CHAPTER_BODY);
    await page.getByRole('button', { name: '儲存草稿' }).click();
    // 儲存進行中兩個按鈕都是 disabled；等它回到可按再發佈，
    // 否則點擊會落在一個停用的按鈕上而靜靜地什麼都沒發生
    await expect(page.getByRole('button', { name: '發佈章節' })).toBeEnabled();
    await page.getByRole('button', { name: '發佈章節' }).click();
    // 發佈後控制項切換為「下架此章」—— 這是狀態真的變了的畫面證據
    await expect(page.getByRole('button', { name: '下架此章' })).toBeVisible();

    // ── 7. 作品上架（草稿作品對訪客一律 404，US1 AC8）──
    await page.goto(`/author/novels/${novelId}`);
    await page.getByRole('button', { name: '上架作品' }).click();
    await expect(page.getByRole('button', { name: '下架作品' })).toBeVisible();

    // ── 8. 另一個瀏覽器情境：**未登入訪客**讀到該章正文（FR-038）──
    const guestContext = await browser.newContext();
    try {
      const guest = await guestContext.newPage();

      const detail = await guest.goto(`/novels/${novelId}`);
      expect(detail?.status(), '訪客讀不到已上架的作品詳情頁').toBe(200);
      await expect(guest.getByText(NOVEL_TITLE).first()).toBeVisible();

      const reader = await guest.goto(`/reader/${novelId}/${chapterId}`);
      expect(reader?.status(), '訪客讀不到已發佈的章節').toBe(200);

      // 判準是**正文區塊內**看得到作者寫的字：整頁比對會被 RSC payload 裡的
      // 原始字串矇混過去（同 T043a 的結論）
      const content = guest.locator('#reader-content');
      await expect(content).toContainText('晨光尚未破曉');
      await expect(content).toContainText(RUN_ID);
      await expect(content).toContainText('這一劍，斬的不是敵人');
    } finally {
      await guestContext.close();
    }
  });
});

/**
 * 批次匯入（FEAT-7 T045／T045a／T045b）
 * ====================================
 * **這三條需求的實作在 React 元件裡，而元件在整合測試層看不見**：送出鈕停用、
 * 逾時措辭、預覽不落地 —— 前兩者是畫面狀態，第三者要問的是「作者看完預覽卻沒按確認時，
 * 瀏覽器有沒有偷偷送出任何東西」。整合層不會產生預覽，「不送出」在那裡是預設狀態，
 * 那樣的案例永遠不可能變紅（2026-08-21 第四／五輪 analyze）。
 *
 * **沿用本檔既有的相依前提**：上方的作者流已把示範讀者升級為作者
 * （`playwright.config.ts` 已載明四個 spec 共用同一台伺服器與同一份 `e2e.db`，
 * 且 `privilege-flow` 同樣依賴這件事）。
 */

/** 每一案各建一部作品：斷言以「該作品的章節列」為準，共用會讓前一案的殘留決定後一案 */
async function createNovelWithVolume(page: Page, label: string): Promise<string> {
  await page.goto('/author/create');
  await page.getByLabel('作品名稱').fill(`${label} ${RUN_ID}`);
  await page.getByLabel('作品簡介').fill('由端對端測試建立，用於驗證批次匯入流程。');
  await page.getByRole('button', { name: '建立作品' }).click();

  await page.waitForURL(/\/author\/novels\/[^/]+$/);
  const novelId = new URL(page.url()).pathname.split('/').pop()!;

  await page.getByLabel('新增卷（編號由系統指派）').fill('第一卷 匯入篇');
  await page.getByRole('button', { name: '新增卷' }).click();
  await expect(page.getByRole('button', { name: '批次上傳' })).toBeVisible();

  /*
    **重新載入是必要的，不是保險**（FEAT-10 起，2026-09-06）。
    章節區塊自 FEAT-10 起以卷為單位摺疊，而「預設展開」只在**頁面載入的那一刻**
    依當時的卷數決定（FR-004）—— 本函式進到管理頁時是 0 卷，建卷走的是
    `router.refresh()`（軟刷新、元件不重建），因此那一卷是**收合**的。
    這是規格明訂的刻意行為（spec FR-004「連帶的已知行為」），不是待修的缺陷。

    收合的卷不渲染章節清單與該卷的批次操作列，下游每一個「章節連結看得到」
    「全選本卷按得到」的斷言都會失敗，而失敗訊息會指向匯入或批次功能——
    與真正的原因無關。重新載入之後只有一卷，依 FR-004 即為展開，
    也正是真實作者重新整理後會看到的狀態。
  */
  await page.reload();
  await expect(page.getByRole('button', { name: /^第 1 卷・/ })).toHaveAttribute(
    'aria-expanded',
    'true'
  );

  return novelId;
}

/** `第N章_標題.md` 的合法來源檔。標題帶 `RUN_ID`，同一份 e2e.db 連跑兩次也分得出新舊 */
function chapterFiles(count: number, tag: string) {
  return Array.from({ length: count }, (_, i) => ({
    name: `第${i + 1}章_${tag}${i + 1}-${RUN_ID}.md`,
    mimeType: 'text/markdown',
    buffer: Buffer.from(`第 ${i + 1} 章的正文（${RUN_ID}）。`, 'utf8'),
  }));
}

/** 展開匯入面板並選檔，等預覽摘要列出現 */
async function pickFiles(page: Page, count: number, tag: string): Promise<void> {
  await page.getByRole('button', { name: '批次上傳' }).click();
  await page.getByLabel('選擇章節檔（可多選）').setInputFiles(chapterFiles(count, tag));
  await expect(page.getByText(`可匯入 ${count} 章`)).toBeVisible();
}

const IMPORT_URL_RE = /\/api\/author\/volumes\/[^/]+\/chapters\/import$/;

/** 選檔 → 確認匯入 → 等章節真的出現在管理頁（批次操作的資料前提） */
async function importChapters(page: Page, count: number, tag: string): Promise<void> {
  await pickFiles(page, count, tag);
  await page.getByRole('button', { name: '確認匯入' }).click();
  await expect(page.getByText(`已建立 ${count} 章`)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('link', { name: `${tag}${count}-${RUN_ID}` })).toBeVisible();
}

const MANAGE_PATH_RE = /^\/author\/novels\/[^/]+$/;

/**
 * 批次發佈／刪除是**打在管理頁網址上的 Server Action**（不是 API 路由），
 * 故以「POST ＋ 管理頁路徑 ＋ `next-action` 標頭」三者共同辨識 ——
 * 少了標頭那一項會把 `router.refresh()` 的 RSC 請求一併算進來。
 */
function isBatchAction(request: Request): boolean {
  if (request.method() !== 'POST') return false;
  if (!MANAGE_PATH_RE.test(new URL(request.url()).pathname)) return false;
  return Boolean(request.headers()['next-action']);
}

/** 全選本卷 → 批次發佈 → 確認發佈（`確認發佈` 只存在於對話框內） */
async function publishAll(page: Page): Promise<void> {
  await page.getByRole('button', { name: '全選本卷' }).click();
  await page.getByRole('button', { name: '批次發佈' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '確認發佈' }).click();
}

/**
 * **整個 describe 共用一次登入**（FEAT-7 T045 實作修正，2026-08-22）：
 * `LOGIN_RATE_IP_MAX` 預設為每分鐘 5 次／每個位址，而三個 project 共用同一份記憶體限流表；
 * 每一案各登入一次的話，本檔第六次登入必被擋下，
 * 而失敗訊息會停在「還在 `/auth/login`」—— 看不出跟限流有關。
 */
const AUTHOR_STATE = path.join(os.tmpdir(), 'novelsite-e2e-author-state.json');

test.describe('批次匯入與批次操作：預覽、確認、送出與逾時措辭', () => {
  test.use({ storageState: AUTHOR_STATE });

  test.beforeAll(async ({ browser }) => {
    // `storageState: undefined` 是必要的：`browser.newContext()` 會沿用上方 `test.use` 的
    // 設定，而那個檔案正是本 hook 要產生的 —— 不覆寫就會在讀取不存在的檔案上失敗
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();
    await login(page);
    await context.storageState({ path: AUTHOR_STATE });
    await context.close();
  });

  test('T045 選檔 → 預覽摘要列 → 確認 → 回到管理頁看到新章節', async ({ page }) => {
    await createNovelWithVolume(page, 'E2E 批次匯入作品');

    await pickFiles(page, 3, '匯入章');
    await page.getByRole('button', { name: '確認匯入' }).click();

    // 成功後面板自行收起（`onImported`），畫面回到章節管理並在頁首報出結果
    // （quickstart §3 US1 表：「導回管理頁，顯示『已建立 N 章』」）
    await expect(page.getByText('已建立 3 章')).toBeVisible({ timeout: 30_000 });

    // 判準不只那句話 —— **章節列真的多了三筆**
    await expect(page.getByRole('link', { name: `匯入章1-${RUN_ID}` })).toBeVisible();
    await expect(page.getByRole('link', { name: `匯入章2-${RUN_ID}` })).toBeVisible();
    await expect(page.getByRole('link', { name: `匯入章3-${RUN_ID}` })).toBeVisible();
    // 匯入產出一律草稿（FR-009）
    await expect(page.getByText('草稿').first()).toBeVisible();
  });

  test('T045a(a) 確認後送出鈕停用，重複點擊不產生第二個請求（FR-004a、US1 AC5）', async ({
    page,
  }) => {
    await createNovelWithVolume(page, 'E2E 批次匯入停用');

    // 把該筆請求拖住，好在「作業進行中」這個狀態上做斷言
    await page.route(IMPORT_URL_RE, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      await route.continue();
    });

    let imports = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST' && IMPORT_URL_RE.test(new URL(request.url()).pathname)) {
        imports += 1;
      }
    });

    await pickFiles(page, 2, '停用章');
    const submit = page.getByRole('button', { name: '確認匯入' });
    await submit.click();

    await expect(submit).toBeDisabled();
    // `force` 跳過可操作性檢查，真的往那個位置點下去 —— 停用的按鈕不會觸發處理常式，
    // 這正是要驗的事（少了 force，Playwright 只會等它變成可按而逾時）
    await submit.click({ force: true });
    await submit.click({ force: true });

    await expect(page.getByRole('link', { name: `停用章1-${RUN_ID}` })).toBeVisible({
      timeout: 30_000,
    });
    expect(imports, '重複點擊產生了第二個匯入請求').toBe(1);
  });

  test('T045a(b) 伺服器已成功但連線中斷時，畫面說「已建立 N 章」（FR-004e、SC-008）', async ({
    page,
  }) => {
    await createNovelWithVolume(page, 'E2E 批次匯入逾時');

    // 先讓請求真的送達伺服器（章節因此確實建立），再讓瀏覽器端視為連線中斷 ——
    // 這就是 FR-004e 描述的情境：**伺服器成功了，作者卻只看到失敗**
    await page.route(IMPORT_URL_RE, async (route) => {
      await route.fetch();
      await route.abort('failed');
    });

    await pickFiles(page, 2, '逾時章');
    await page.getByRole('button', { name: '確認匯入' }).click();

    await expect(page.getByText('已建立 2 章')).toBeVisible({ timeout: 30_000 });
    // **MUST NOT 出現「匯入失敗」**：那句話會誘使作者重送，而重送必然整批撞號中止
    await expect(page.getByText('匯入失敗')).toHaveCount(0);
  });

  test('T045a(b) 章號尚未出現時的措辭 MUST 逐字相符（FR-004e、SC-008）', async ({ page }) => {
    await createNovelWithVolume(page, 'E2E 批次匯入未達');

    // 這一次請求根本沒送到伺服器：什麼都沒建立，重查自然查不到
    await page.route(IMPORT_URL_RE, (route) => route.abort('failed'));

    await pickFiles(page, 2, '未達章');
    await page.getByRole('button', { name: '確認匯入' }).click();

    // 措辭是這條需求的全部內容 —— 查不到並不等於失敗
    await expect(page.getByText('尚未看到新章節，請稍後重新整理確認')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText('匯入失敗')).toHaveCount(0);
  });

  test('T045b 預覽不落地：未按確認前不發出任何 POST，章節列不變（FR-003、US1 AC1）', async ({
    page,
  }) => {
    await createNovelWithVolume(page, 'E2E 批次匯入預覽');

    // 監聽自建卷完成之後才掛上 —— 建作品與建卷本身是 Server Action，那些 POST 與本案無關
    const posts: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST') posts.push(request.url());
    });

    await pickFiles(page, 5, '預覽章');

    // **不按確認**。這一行才是本案的意義：日後有人為了斷點續傳加一個暫存端點，
    // 「預覽不落地」就會在這裡變紅
    expect(posts, `預覽期間送出了 POST：${posts.join('、')}`).toEqual([]);

    // 章節列仍是空的 —— 整合層看不到預覽，這個斷言只有在瀏覽器裡才成立
    await page.reload();
    await expect(page.getByText('這一卷還沒有章節。')).toBeVisible();
    await expect(page.getByRole('link', { name: `預覽章1-${RUN_ID}` })).toHaveCount(0);
  });

  // ───────────────────────────────────────────────
  // FEAT-8 批次發佈與批次刪除（T047／T047a／T048）
  //
  // **這幾條 MUST 在 E2E 而非整合層**：它們斷言的是**確認畫面的內容**與
  // **控制項狀態**，整合層看不到 React 元件 —— 寫在那裡最後會被降級成只測資料庫。
  // ───────────────────────────────────────────────

  test('T047 批次發佈：確認畫面 → 摘要「已發佈 N 章」，重複點擊不產生第二個請求（FR-025）', async ({
    page,
  }) => {
    await createNovelWithVolume(page, 'E2E 批次發佈');
    await importChapters(page, 3, '批發章');

    // 把該次 Server Action 拖住，好在「作業進行中」這個狀態上做斷言
    await page.route('**/author/novels/*', async (route) => {
      if (!isBatchAction(route.request())) return route.fallback();
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      await route.continue();
    });

    let batchCalls = 0;
    page.on('request', (request) => {
      if (isBatchAction(request)) batchCalls += 1;
    });

    await page.getByRole('button', { name: '全選本卷' }).click();
    await expect(page.getByText('已選 3 章')).toBeVisible();

    await page.getByRole('button', { name: '批次發佈' }).click();

    // 確認畫面 MUST 同時給**章號區段**與統計（FR-025a）——
    // 只給數量擋不住「選錯範圍」：選第 1–3 章與選第 201–203 章的數字一模一樣。
    // 連字號為 U+2013，與 `formatChapterRanges` 同一份規則
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('第 1–3 章');
    await expect(dialog).toContainText('共 3 章');

    await dialog.getByRole('button', { name: '確認發佈' }).click();

    // FR-025：確認後觸發控制項即停用；`force` 跳過可操作性檢查，
    // 真的往那個位置點下去 —— 停用的按鈕不會觸發處理常式，這正是要驗的事
    const trigger = page.getByRole('button', { name: /^(批次發佈|發佈中…)$/ });
    await expect(trigger).toBeDisabled();
    await trigger.click({ force: true });
    await trigger.click({ force: true });

    await expect(page.getByText('已發佈 3 章')).toBeVisible({ timeout: 30_000 });
    expect(batchCalls, '重複點擊產生了第二個批次請求').toBe(1);
  });

  test('T047a(a) 逾時但伺服器已成功：訊息與資料庫一致，且不自動重送（FR-026／SC-009）', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await createNovelWithVolume(page, 'E2E 批次逾時已成功');
    await importChapters(page, 2, '逾成章');

    // 先讓請求真的送達伺服器（章節因此確實發佈），再把**回應**壓在前端逾時門檻
    // （`BatchActionBar` 的 15 秒）之後 —— 這就是 FR-026 的情境：伺服器成功了，作者卻還沒看到
    await page.route('**/author/novels/*', async (route) => {
      if (!isBatchAction(route.request())) return route.fallback();
      const response = await route.fetch();
      await new Promise((resolve) => setTimeout(resolve, 25_000));
      await route.fulfill({ response });
    });

    let batchCalls = 0;
    page.on('request', (request) => {
      if (isBatchAction(request)) batchCalls += 1;
    });

    await publishAll(page);

    // 1. 逾時後改以**重查結果**說話，MUST NOT 說失敗。
    //    兩種措辭都是逾時分支：重查已看到變化、或還沒看到 ——
    //    `router.refresh()` 與尚未結算的 Server Action 共用同一條 transition，
    //    重查結果**不保證**在回應抵達前就繪出，故此處接受兩者之一。
    //    真正不可接受的是「操作失敗」：那句話會誘使作者再按一次
    await expect(page.getByText(/尚未看到變更|重查後已看到/)).toBeVisible({ timeout: 40_000 });
    await expect(page.getByText('操作失敗')).toHaveCount(0);

    // 2. 回應終於抵達後，**最終訊息 MUST 與資料庫實際狀態一致**（SC-009）
    await expect(page.getByText('已發佈 2 章')).toBeVisible({ timeout: 40_000 });
    await page.reload();
    // 重新載入 ＝ 直接問伺服器：作品的已發佈章節數就是那 2 章
    await expect(page.getByText('2 章已發佈')).toBeVisible();

    // 3. 逾時只是「還沒看到回應」，再送一次就是第二批 —— 而批次發佈的第二批會多送一則通知
    expect(batchCalls, '逾時後自動重送了第二批').toBe(1);
  });

  test('T047a(b) 逾時且章節尚未變化：文案 MUST 逐字為「尚未看到變更」（FR-026／SC-009）', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await createNovelWithVolume(page, 'E2E 批次逾時未達');
    await importChapters(page, 2, '逾未章');

    // 這一次請求**還沒送到伺服器**：什麼都沒發佈，重查自然查不到變化。
    // 用可控的閘門而不是固定秒數，斷言才不必跟一個計時器賽跑
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/author/novels/*', async (route) => {
      if (!isBatchAction(route.request())) return route.fallback();
      await held;
      await route.continue();
    });

    let batchCalls = 0;
    page.on('request', (request) => {
      if (isBatchAction(request)) batchCalls += 1;
    });

    await publishAll(page);

    // 措辭是這條需求的全部內容 —— **查不到並不等於失敗**。
    // 講成失敗，作者就會再按一次，而那正是 FR-026 要擋的第二批
    await expect(
      page.getByText('尚未看到變更。已重新查詢這一卷的章節清單，系統不會自動重送這一批。')
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('操作失敗')).toHaveCount(0);
    expect(batchCalls, '逾時後自動重送了第二批').toBe(1);

    // 放行，讓那個請求正常收尾（測試結束時不留下懸著的路由處理常式）
    release();
  });

  test('T048 批次刪除的二次確認：含已發佈章節才有，草稿不加同一道摩擦（FR-016／FR-017）', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await createNovelWithVolume(page, 'E2E 批次刪除確認');
    await importChapters(page, 2, '刪確章');

    // ── 反面（FR-017）：全為草稿的選取 MUST NOT 出現二次確認與「無法復原」 ──
    // 對低風險操作施加同等摩擦，只會讓作者學會無視所有確認步驟；
    // 而「順手也對草稿加一道」不會讓任何其他測試變紅，只有這個斷言擋得住
    await page.getByRole('button', { name: '全選本卷' }).click();
    await page.getByRole('button', { name: '批次刪除' }).click();
    const draftDialog = page.getByRole('dialog');
    await expect(draftDialog).toContainText('全部為草稿');
    await expect(draftDialog.getByText('刪除後無法復原')).toHaveCount(0);
    await expect(draftDialog.getByRole('checkbox')).toHaveCount(0);
    await expect(draftDialog.getByRole('button', { name: '確認刪除' })).toBeEnabled();
    await draftDialog.getByRole('button', { name: '取消' }).click();

    // ── 正面（FR-016）：先把兩章發佈，選取因此含已發佈章節 ──
    await publishAll(page);
    await expect(page.getByText('已發佈 2 章')).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: '全選本卷' }).click();
    await page.getByRole('button', { name: '批次刪除' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('其中 2 章已發佈');
    await expect(dialog).toContainText('刪除後無法復原');
    // 未完成二次確認前 MUST NOT 送得出去
    await expect(dialog.getByRole('button', { name: '確認刪除' })).toBeDisabled();

    // 重新載入 ＝ 直接問資料庫：兩章都還在，二次確認前**零變動**
    await page.reload();
    await expect(page.getByRole('link', { name: `刪確章1-${RUN_ID}` })).toBeVisible();
    await expect(page.getByRole('link', { name: `刪確章2-${RUN_ID}` })).toBeVisible();
  });
});
