import { test, expect, type Page } from '@playwright/test';
import { fillForm } from './formFill';

/**
 * 端對端：讀者流（FR-059、SC-013、`arch.md` §10.4 流程 1）
 * ========================================================
 * 註冊 → 閱讀 → 加書架 → 換章 → **重新登入**後書架與續讀位置仍在。
 *
 * 最後一段是這條流程唯一無法被整合測試取代的部分。書架寫入與續讀上報各自都有
 * 整合測試，但「這兩件事真的跟著帳號走，而不是跟著這台瀏覽器的 localStorage 走」
 * 只有在**清掉 Cookie 之後重新登入**時才會露出真相 —— FEAT-4 之前它們正是存在本機的，
 * 而本機資料在同一個瀏覽器情境裡永遠會給出「有保留」這個假答案。
 *
 * 本檔是三種引擎（chromium／firefox／webkit）皆須跑過的唯一一條（FR-059）：
 * 其餘流程維持 chromium。跨引擎要驗的是排版與互動的基礎相容性，
 * 三條流程各跑三次只是把建置時間乘三。
 *
 * **一切識別碼皆自畫面解析**，除了示範帳號的密碼（來自 `.env.test`）。
 */

/**
 * 本檔的帳號由測試自己註冊，故密碼**不取自** `.env.test` 的 `SEED_USER_PASSWORD` ——
 * 那是示範帳號的密碼，與一個全新註冊的帳號無關。值須符合註冊規則（≥ 8 字元、含英數）。
 */
const PASSWORD = 'E2eReader1234';

/** 每次執行都用不同的帳號，避免同一個 e2e.db 連跑兩次時撞上唯一鍵 */
const RUN_ID = Date.now().toString(36);

interface ReaderProgressCall {
  chapterId: string;
  ok: boolean;
}

/** 攔截 `PUT /api/reading-progress` 的**回應**（送出 ≠ 伺服器寫入完成） */
function watchProgressCalls(page: Page): ReaderProgressCall[] {
  const calls: ReaderProgressCall[] = [];
  page.on('response', (res) => {
    const req = res.request();
    if (req.method() !== 'PUT' || !res.url().includes('/api/reading-progress')) return;
    const body = req.postData() ?? '';
    const chapterId = (JSON.parse(body || '{}') as { chapterId?: string }).chapterId ?? '';
    calls.push({ chapterId, ok: res.ok() });
  });
  return calls;
}

async function login(page: Page, email: string): Promise<void> {
  await page.goto('/auth/login');
  await fillForm(page, { Email: email, 密碼: PASSWORD });
  await page.getByRole('button', { name: '登入' }).click();
  await expect(page).not.toHaveURL(/\/auth\/login/);
}

/**
 * 自公開列表挑一部**至少有兩章**的作品。
 *
 * 換章是本流程的一環，挑到單章作品會讓「下一章」是停用狀態，
 * 而測試會紅在一個沒問題的按鈕上。示範資料每部都有三章，
 * 但那是資料的現況而非契約 —— 故實際檢查而非假設。
 */
async function pickNovelWithTwoChapters(page: Page): Promise<string> {
  await page.goto('/novels');
  const hrefs = await page
    .locator('a[href^="/novels/"]')
    .evaluateAll((links) => links.map((a) => (a as HTMLAnchorElement).getAttribute('href') ?? ''));
  const candidates = [...new Set(hrefs.map((h) => h.split('/')[2]).filter(Boolean))];

  for (const novelId of candidates) {
    const res = await page.goto(`/novels/${novelId}`);
    if (res?.status() !== 200) continue;
    const chapterIds = await page
      .locator(`a[href^="/reader/${novelId}/"]`)
      .evaluateAll((links) =>
        links.map((a) => ((a as HTMLAnchorElement).getAttribute('href') ?? '').split('/')[3])
      );
    if (new Set(chapterIds.filter(Boolean)).size >= 2) return novelId;
  }

  throw new Error('公開列表中找不到任何具備兩章以上的已上架作品');
}

/** 自閱讀頁標題解析章號（`第 N 章：標題`） */
async function currentChapterNumber(page: Page): Promise<number> {
  const heading = await page.locator('#reader-content h1').first().textContent();
  const matched = /第\s*(\d+)\s*章/.exec(heading ?? '');
  if (!matched) throw new Error(`閱讀頁標題解析不出章號：${heading}`);
  return Number(matched[1]);
}

test.describe('讀者流：註冊、閱讀、書架與續讀位置跟著帳號走', () => {
  test('註冊 → 加書架 → 換章 → 重新登入後書架與續讀位置保留', async ({ page }, testInfo) => {
    // 帳號帶上引擎名稱：三個 project 共用同一台伺服器與同一個 e2e.db
    const email = `e2e-reader-${testInfo.project.name}-${RUN_ID}@example.com`;
    const progressCalls = watchProgressCalls(page);

    // ── 1. 註冊（FR-059 的起點：一個全新的帳號，沒有任何既有資料）──
    await page.goto('/auth/register');
    await fillForm(
      page,
      { 暱稱: `E2E 讀者 ${RUN_ID}`, Email: email, 密碼: PASSWORD },
      { checkbox: true }
    );
    await page.getByRole('button', { name: '註冊' }).click();

    // 註冊成功後由表單導向書架；空狀態是新帳號的正確樣貌（FR-043b 第 7 項）
    await page.waitForURL(/\/profile\/bookshelf/);
    await expect(page.getByText('書架目前是空的')).toBeVisible();

    // ── 2. 挑一部有兩章以上的作品並加入書架（FR-017）──
    const novelId = await pickNovelWithTwoChapters(page);
    await page.goto(`/novels/${novelId}`);

    const shelfBtn = page.locator('#add-shelf-btn');
    await expect(shelfBtn).toHaveText(/加入書架/);
    // 樂觀更新會讓畫面**先**變成「已入書架」；等伺服器那一筆真的回來再往下走，
    // 否則後面的重新登入可能搶在寫入之前，測到的是一個還沒發生的事實
    const shelfWrite = page.waitForResponse(
      (res) => res.request().method() === 'POST' && res.url().includes(`/api/bookshelf/${novelId}`)
    );
    await shelfBtn.click();
    expect((await shelfWrite).ok(), '加入書架的伺服器寫入未成功').toBe(true);
    await expect(shelfBtn).toHaveText(/已入書架/);

    // ── 3. 進入閱讀頁並換到下一章（FR-011）──
    await page.locator('#read-now-btn').click();
    await page.waitForURL(new RegExp(`/reader/${novelId}/`));
    await expect(page.locator('#reader-content')).toBeVisible();
    const firstChapterNumber = await currentChapterNumber(page);

    // 頂部導覽列與章末各有一顆「下一章」；以 aria-label 定位只會命中前者
    // （章末那顆沒有 aria-label），角色＋名稱則會同時命中兩顆而觸發 strict mode
    const nextBtn = page.getByLabel('下一章');
    await expect(nextBtn).toBeEnabled();
    await nextBtn.click();

    await expect
      .poll(async () => currentChapterNumber(page), { timeout: 15_000 })
      .toBe(firstChapterNumber + 1);
    const secondChapterId = new URL(page.url()).pathname.split('/').pop()!;
    const secondChapterNumber = firstChapterNumber + 1;

    // 續讀點的伺服器寫入由閱讀頁載入時的那一次上報完成（ReaderView 的首次上報）。
    // 等它回來，理由同書架那一步
    await expect
      .poll(() => progressCalls.some((c) => c.chapterId === secondChapterId && c.ok), {
        timeout: 15_000,
      })
      .toBe(true);

    // ── 4. 重新登入：清掉整個瀏覽器情境的 Cookie 與本機資料 ──
    // MUST 一併清 localStorage —— 只清 Cookie 的話，書架仍可能是未登入時的本機副本
    // 給出的答案，而那正是 FEAT-4 要換掉的東西
    await page.context().clearCookies();
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await login(page, email);

    // ── 5. 書架保留（跟著帳號，不是跟著這台瀏覽器）──
    await page.goto('/profile/bookshelf');
    await expect(page.getByText('書架目前是空的')).toHaveCount(0);
    // 以 href 而非標題比對：標題含《》等字元，轉成正規表示式只會多一層失敗來源
    await expect(page.locator(`a[href="/novels/${novelId}"]`).first()).toBeVisible();

    // ── 6. 續讀位置保留：詳情頁的主要入口變成「繼續閱讀・第 N 章」──
    await page.goto(`/novels/${novelId}`);
    const resumeBtn = page.locator('#resume-reading-btn');
    await expect(resumeBtn).toBeVisible();
    await expect(resumeBtn).toHaveText(new RegExp(`第\\s*${secondChapterNumber}\\s*章`));

    // 而且它真的按得下去、真的回到那一章（顯示入口與回到位置是兩件事）
    await resumeBtn.click();
    await page.waitForURL(new RegExp(`/reader/${novelId}/${secondChapterId}`));
    await expect
      .poll(async () => currentChapterNumber(page), { timeout: 15_000 })
      .toBe(secondChapterNumber);
  });
});
