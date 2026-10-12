import { test, expect, type Page } from '@playwright/test';
import { loadTestEnv } from '../testEnv';
import { fillForm } from './formFill';

/**
 * 端對端：越權流（FR-059、`arch.md` §10.4 流程 3）
 * ================================================
 * 作者 A 直接把作者 B 的編輯器網址打進網址列 → **被導離或找不到**。
 *
 * 這條流程的重點在「直接輸入網址」：畫面上本來就不會有通往別人章節的連結，
 * 靠點按走不到，也就永遠測不到守衛。整合測試可以驗 repository 的 where 條件，
 * 但「頁面層、版面層與 proxy 三道之中沒有任何一道把它放行」只有真的送出一次
 * 瀏覽器請求才算數。
 *
 * **判準是 404 而非 403**（`lib/auth/ownership.ts`）：403 等於告訴對方
 * 「這個 id 有效，只是不是你的」，而作者的章節清單本身就是要保護的資訊。
 *
 * 同時驗**兩種身分**：
 *   - 作者 A（角色足夠、擁有權不足）→ 404
 *   - 一般讀者（角色不足）→ 被導離到首頁
 * 少了任一種，另一條守衛壞掉時這個檔案仍會是綠的。
 */

const SEED_PASSWORD = loadTestEnv().SEED_USER_PASSWORD;
const AUTHOR_EMAIL = 'author@novelsite.tw';

/**
 * 角色不足的那一則 MUST 自己註冊一個帳號，**MUST NOT 沿用示範讀者帳號**。
 *
 * 四個 spec 共用同一台伺服器與同一個 e2e.db，而 `author-flow` 會把
 * `reader@novelsite.tw` 升級成作者（那正是它要驗的事）。它依檔名先於本檔執行，
 * 於是「一般讀者」到了這裡已經是作者 —— 測試會紅在一個完全正確的守衛上，
 * 而失敗訊息指向的是網址而不是角色。
 */
const NEW_READER_PASSWORD = 'E2ePrivilege1234';
const NEW_READER_EMAIL = `e2e-privilege-${Date.now().toString(36)}@example.com`;

/**
 * 本檔獨立的限流分桶。四個 spec 共用同一台伺服器與同一份記憶體限流表，
 * 而本檔一次跑兩則、各登入一次；與 `author-flow`／`reader-flow` 共用桶會逼近
 * `LOGIN_RATE_IP_MAX`（預設 5），屆時失敗訊息會指向登入表單而不是限流。
 */
test.use({ extraHTTPHeaders: { 'X-Forwarded-For': '10.60.1.1' } });

async function login(page: Page, email: string, password = SEED_PASSWORD): Promise<void> {
  await page.goto('/auth/login');
  await fillForm(page, { Email: email, 密碼: password });
  await page.getByRole('button', { name: '登入' }).click();
  await expect(page).not.toHaveURL(/\/auth\/login/);
}

/** 註冊一個全新的、從未開通作者的帳號 */
async function registerReader(page: Page): Promise<void> {
  await page.goto('/auth/register');
  await fillForm(
    page,
    { 暱稱: 'E2E 越權流讀者', Email: NEW_READER_EMAIL, 密碼: NEW_READER_PASSWORD },
    { checkbox: true }
  );
  await page.getByRole('button', { name: '註冊' }).click();
  await page.waitForURL(/\/profile\/bookshelf/);
}

/**
 * 自公開頁面取一個**別人的**章節識別碼。
 *
 * 示範作品的作者都是各自獨立的內容作者 User，登入帳號 `author@novelsite.tw`
 * 名下沒有任何作品 —— 故公開頁面上的任何一章對它而言都是「別人的」。
 * 章節 id MUST 自畫面解析，硬寫一個示範資料的 id 只會在示範資料換內容那天壞掉。
 */
async function foreignChapterId(page: Page): Promise<{ novelId: string; chapterId: string }> {
  await page.goto('/novels');
  const hrefs = await page
    .locator('a[href^="/novels/"]')
    .evaluateAll((links) => links.map((a) => (a as HTMLAnchorElement).getAttribute('href') ?? ''));
  const candidates = [...new Set(hrefs.map((h) => h.split('/')[2]).filter(Boolean))];

  for (const novelId of candidates) {
    const res = await page.goto(`/novels/${novelId}`);
    if (res?.status() !== 200) continue;
    const chapterId = await page
      .locator(`a[href^="/reader/${novelId}/"]`)
      .first()
      .getAttribute('href')
      .then((href) => href?.split('/')[3] ?? '')
      .catch(() => '');
    if (chapterId) return { novelId, chapterId };
  }

  throw new Error('公開列表中找不到任何可用的已上架章節');
}

test.describe('越權流：別人的編輯器網址進不去', () => {
  test('作者 A 直接輸入作者 B 的編輯器網址 → 404（不是 403，也不是編輯器）', async ({ page }) => {
    await login(page, AUTHOR_EMAIL);

    // 正向對照：同一個工作階段進得了**自己的**作者後台。
    // 少了這一步，後面的 404 可能只是因為根本沒登入 —— 那會讓這個測試恆綠而什麼都沒驗到
    const ownArea = await page.goto('/author/novels');
    expect(ownArea?.status(), '作者本人進不了自己的後台，後面的 404 就不具意義').toBe(200);

    const { novelId, chapterId } = await foreignChapterId(page);

    const editor = await page.goto(`/author/editor/${chapterId}`);
    expect(editor?.status(), '別人的章節編輯器回了非 404 的狀態').toBe(404);
    // 狀態碼對了還不夠：畫面上 MUST NOT 出現編輯器的任何控制項
    await expect(page.getByLabel('章節正文')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '發佈章節' })).toHaveCount(0);

    // 作品管理頁走的是另一條擁有權判斷（`assertNovelOwner`），一併驗
    const manage = await page.goto(`/author/novels/${novelId}`);
    expect(manage?.status(), '別人的作品管理頁回了非 404 的狀態').toBe(404);
  });

  test('一般讀者輸入編輯器網址 → 被導離（角色守衛）', async ({ page }) => {
    await registerReader(page);
    const { chapterId } = await foreignChapterId(page);

    await page.goto(`/author/editor/${chapterId}`);
    // `requireAuthor()` 對角色不足者 redirect('/')：判準是**離開了那個網址**
    await expect(page).not.toHaveURL(/\/author\/editor\//);
    await expect(page.getByLabel('章節正文')).toHaveCount(0);

    // 正向對照：同一個帳號進得了不需要作者角色的個人頁 ——
    // 少了這一步，上面的「被導離」可能只是因為根本沒登入
    const profile = await page.goto('/profile/bookshelf');
    expect(profile?.status(), '新註冊的讀者連自己的書架都進不去').toBe(200);
  });
});
