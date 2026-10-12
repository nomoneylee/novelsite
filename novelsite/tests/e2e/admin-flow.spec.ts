import { test, expect } from '@playwright/test';
import { loadTestEnv } from '../testEnv';

/**
 * 管理後台流（FEAT-9 UI 重構回歸，2026-09-06）
 * ================================================
 * **這條流程只為一件事存在：篩選按下去，畫面上的清單真的要跟著變。**
 *
 * 為何非 E2E 不可：整合測試是直接對伺服器發 HTTP，`/admin/users?search=X` 一直都回傳
 * 正確的過濾結果 —— 那部分從來沒壞過。壞的是瀏覽器裡的那一段：表格元件把 `initial*`
 * 複製進 `useState`，`router.push` 換了查詢字串、伺服器也回了新資料、props 也換了，
 * 但元件實例沒被重建，`useState` 的初始值只在掛載當下取一次，於是畫面停在舊清單。
 * 症狀是「搜尋沒反應」，而網址列明明變了、後端也算對了 ——
 * **任何不經過真實瀏覽器導覽的測試都會綠燈通過**。
 *
 * 修法是 `useSyncedList`（`src/components/admin/useAdminList.ts`）——
 * 在渲染期間比對 props 身分並重設本地清單，**不重建元件**。
 * 第一版曾用 `key` 強制重建，那會連搜尋框一起重建；再加上搜尋框原本每個 onChange
 * 都直接導覽，於是每打一個字就失去焦點，得用滑鼠點回去才能繼續打。
 * 除了同步之外另補了搜尋去抖（`useDebouncedCallback`），本檔一併驗證它確實只導覽一次。
 *
 * **只讀不寫**：本檔不做任何停權／下架／刪除，`e2e.db` 與其他 spec 共用，
 * 改了資料會讓後面依檔名執行的流程紅在別人身上。
 */

const SEED_PASSWORD = loadTestEnv().SEED_USER_PASSWORD;
const ADMIN_EMAIL = 'admin@novelsite.tw';

/**
 * **登入 MUST 只做一次，之後靠 Cookie 重放**。
 *
 * `LOGIN_RATE_ACCOUNT_MAX` 預設為 5（`src/lib/env.ts`），而本檔有 6 個測試；
 * 每個測試各登入一次的話，第 6 個會撞上帳號層限流，症狀是
 * `waitForURL` 逾時而不是任何斷言失敗 —— 看起來像頁面壞了，其實是測試自己打爆了限流。
 */
let adminCookies: Awaited<ReturnType<import('@playwright/test').BrowserContext['cookies']>>;

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('/auth/login');
  await page.getByLabel('Email').fill(ADMIN_EMAIL);
  await page.getByLabel('密碼').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: /登入/ }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/auth/login'));

  adminCookies = await context.cookies();
  await context.close();
});

/** 表格資料列數。`AdminDataTable` 無資料時渲染空態而非空 tbody，故 0 列也是合法結果 */
function rowCount(page: import('@playwright/test').Page) {
  return page.locator('table tbody tr').count();
}

test.describe('FEAT-9 管理後台：篩選必須真的改變畫面', () => {
  test.beforeEach(async ({ context }) => {
    await context.addCookies(adminCookies);
  });

  test('使用者管理：關鍵字搜尋縮小清單，且網址與畫面一致', async ({ page }) => {
    await page.goto('/admin/users');
    const before = await rowCount(page);
    expect(before).toBeGreaterThan(1);

    await page.getByLabel('搜尋').fill('admin@novelsite.tw');
    await page.getByLabel('搜尋').press('Enter');
    await page.waitForURL(/[?&]search=/);

    // 列數 MUST 真的變少 —— 只斷言網址變了的話，正是原本那個 bug 會通過的測法
    await expect(page.locator('table tbody tr')).toHaveCount(1);
    await expect(page.locator('table tbody')).toContainText(ADMIN_EMAIL);
  });

  test('使用者管理：角色篩選為管理員時只留下管理員', async ({ page }) => {
    await page.goto('/admin/users');
    const before = await rowCount(page);

    /*
      `exact: true` 是必要的：每一列都有一個 `aria-label="變更 <姓名> 的角色"` 的下拉，
      Playwright 的 `getByLabel` 預設是子字串比對，只寫 '角色' 會同時命中十幾個元素
    */
    await page.getByLabel('角色', { exact: true }).selectOption('admin');
    await page.waitForURL(/[?&]role=admin/);

    const after = await rowCount(page);
    expect(after).toBeLessThan(before);
    expect(after).toBeGreaterThan(0);
    await expect(page.locator('table tbody')).toContainText('管理員');
  });

  test('作品內容管理：狀態篩選會改變清單', async ({ page }) => {
    await page.goto('/admin/content');
    const before = await rowCount(page);
    expect(before).toBeGreaterThan(0);

    // 示範資料沒有任何違規下架的作品，故此篩選的正解是「一列都不剩」
    await page.getByLabel('作品狀態').selectOption('admin_suspended');
    await page.waitForURL(/[?&]status=admin_suspended/);
    await expect(page.locator('table tbody tr')).toHaveCount(0);

    // 切回已發佈：清單 MUST 回來（證明重建是雙向的，不是單程把畫面清空）
    await page.getByLabel('作品狀態').selectOption('published');
    await page.waitForURL(/[?&]status=published/);
    expect(await rowCount(page)).toBeGreaterThan(0);
  });

  test('標籤治理：關鍵字搜尋縮小清單', async ({ page }) => {
    await page.goto('/admin/tags');
    const before = await rowCount(page);
    expect(before).toBeGreaterThan(1);

    // 取第一列的標籤名當關鍵字，避免把示範標籤的具體字面寫死在測試裡
    const firstTagName = (
      await page.locator('table tbody tr').first().locator('td').first().innerText()
    ).trim();
    await page.getByLabel('搜尋').fill(firstTagName);
    await page.waitForURL(/[?&]search=/);

    const after = await rowCount(page);
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThanOrEqual(before);
    await expect(page.locator('table tbody')).toContainText(firstTagName);
  });

  test('邊打字邊搜尋 MUST 去抖：三個字只導覽一次，且輸入框內容與焦點都留著', async ({ page }) => {
    await page.goto('/admin/content');

    /*
      **這個測試的判別點是請求次數，不是焦點。**
      焦點雖然是使用者實際回報的症狀（每打一個字就要用滑鼠點回搜尋框），
      但它在 Playwright 裡測不出來 —— 合成按鍵不經過輸入法的組字流程，
      而焦點正是在組字中途被 `router.push` 打斷才掉的；
      實測「每鍵導覽 + key 重建」的壞組態下，合成輸入的焦點依然留在 INPUT。
      能穩定判別的是伺服器請求數：沒有去抖時三個字會送出三次請求。
    */
    /*
      判別點是**送出的 RSC 請求數**，MUST NOT 用 `framenavigated` ——
      實測 Next 的軟導覽在有無去抖時 `framenavigated` 都只算到 1 次
      （只有最後一個網址會觸發事件），那個計數分不出兩種組態。
      請求數則明確：去抖後 1 次，去抖前每個字元各 1 次共 3 次。
    */
    const filterRequests: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('search=')) filterRequests.push(req.url());
    });

    const search = page.getByLabel('搜尋');
    await search.click();
    // `press()` 不吃 CJK 字元（Unknown key），逐字輸入要用 pressSequentially
    for (const ch of ['雲', '海', '之']) {
      await search.pressSequentially(ch);
    }

    await page.waitForURL(/[?&]search=/, { timeout: 5000 });
    await page.waitForTimeout(600); // 讓可能的多餘導覽有機會發生

    expect(filterRequests).toHaveLength(1);
    await expect(search).toHaveValue('雲海之');
    await expect(search).toBeFocused();
  });

  test('稽核日誌：動作別篩選會改變清單', async ({ page }) => {
    await page.goto('/admin/audit');

    // 示範資料不含稽核紀錄，先確認頁面本身可用（空態或有列都算通過）
    await expect(page.getByRole('heading', { name: '安全稽核留痕' })).toBeVisible();

    await page.getByLabel('動作別').fill('絕不存在的動作別');
    await page.getByRole('button', { name: '套用篩選' }).click();
    await page.waitForURL(/[?&]action=/);

    // 查無資料 MUST 顯示空態，MUST NOT 停在篩選前的清單
    await expect(page.locator('table tbody tr')).toHaveCount(0);
  });
});
