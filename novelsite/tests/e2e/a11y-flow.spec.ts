import os from 'node:os';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { loadTestEnv } from '../testEnv';

/**
 * 端對端：無障礙與偏好流（FR-059、`arch.md` §10.4 流程 4）
 * ========================================================
 * 兩件只有真的鍵盤與真的重新載入才能證明的事：
 *   1. Skip Link **按得到**（Tab 進得去、Enter 真的把焦點送到 `<main>`）
 *   2. 閱讀頁的字級與主題**切換後重載仍保留**
 *
 * 靜態稽核（axe）看得到 Skip Link 存在、看不到它按下去有沒有反應；
 * 單元測試驗得了 `useReaderPrefs` 的讀寫、驗不了瀏覽器重載後那個值真的回到畫面上
 * —— 主題還牽涉到 `layout.tsx` 首繪前的內聯腳本，那段程式碼在 jsdom 裡根本不執行。
 *
 * **以未登入訪客執行**：字級與主題對未登入者存在本機、對登入者存在伺服器，
 * 前者是「重載後保留」這句話最弱的一環（本機值本來就可能被 hydration 蓋掉），
 * 驗弱的那一邊才有意義。跨裝置同步那一半由 `reader-flow` 與整合測試覆蓋。
 */

/** 自公開頁面解析一組可用的 novelId／chapterId（識別碼 MUST NOT 硬寫） */
async function findReadablePath(page: Page): Promise<string> {
  await page.goto('/novels');
  const hrefs = await page
    .locator('a[href^="/novels/"]')
    .evaluateAll((links) => links.map((a) => (a as HTMLAnchorElement).getAttribute('href') ?? ''));
  const candidates = [...new Set(hrefs.map((h) => h.split('/')[2]).filter(Boolean))];

  for (const novelId of candidates) {
    const res = await page.goto(`/novels/${novelId}`);
    if (res?.status() !== 200) continue;
    const href = await page
      .locator(`a[href^="/reader/${novelId}/"]`)
      .first()
      .getAttribute('href')
      .catch(() => null);
    if (!href) continue;
    const readerRes = await page.goto(href);
    if (readerRes?.status() === 200) return href;
  }

  throw new Error('公開列表中找不到任何可讀的章節');
}

test.describe('無障礙流：Skip Link 與閱讀偏好', () => {
  test('Skip Link 可由鍵盤觸發，焦點落到主要內容', async ({ page }) => {
    await page.goto('/');

    // 頁面內第一個可聚焦元素即 Skip Link（它 MUST 在導覽之前，否則略過導覽就沒有意義）
    await page.keyboard.press('Tab');
    const focusedText = await page.evaluate(() => document.activeElement?.textContent?.trim());
    expect(focusedText, '第一個 Tab 沒有停在 Skip Link 上').toBe('跳至主要內容');

    // 隱藏的連結在 focus 時 MUST 看得見 —— 看不見的話，看得見鍵盤焦點的人也不知道按了什麼
    await expect(page.getByRole('link', { name: '跳至主要內容' })).toBeVisible();

    await page.keyboard.press('Enter');
    const focusedTag = await page.evaluate(() => document.activeElement?.tagName);
    expect(focusedTag, 'Enter 之後焦點沒有落到 <main>').toBe('MAIN');
  });

  test('閱讀頁字級與主題切換後重新載入仍保留', async ({ page }) => {
    const readerPath = await findReadablePath(page);
    await page.goto(readerPath);
    await expect(page.locator('#reader-content')).toBeVisible();

    const reader = page.locator('[data-reader-font]');
    const html = page.locator('html');

    // 兩者都先讀出**當下**的值再比對變化：斷言成固定的 'md'／'light'
    // 會在預設值改變的那天壞在一個與本流程無關的地方
    const fontBefore = await reader.getAttribute('data-reader-font');
    const themeBefore = await html.getAttribute('data-theme');

    await page.getByRole('button', { name: /^字體大小：/ }).click();
    await expect(reader).not.toHaveAttribute('data-reader-font', fontBefore!);
    const fontAfter = await reader.getAttribute('data-reader-font');

    await page.getByRole('button', { name: '切換主題' }).click();
    await expect(html).not.toHaveAttribute('data-theme', themeBefore!);
    const themeAfter = await html.getAttribute('data-theme');

    // ── 重新載入：這一步才是這個測試的全部意義 ──
    await page.reload();
    await expect(page.locator('#reader-content')).toBeVisible();

    // 字級在 mount 後才自本機讀回（兩段式初始化），故用會重試的 toHaveAttribute
    await expect(reader).toHaveAttribute('data-reader-font', fontAfter!);
    await expect(html).toHaveAttribute('data-theme', themeAfter!);
  });
});

// ───────────────────────────────────────────────────────────────────
// FEAT-8 T048a：鍵盤 only 走完 SC-010 的兩條完整路徑
//
// **為什麼元件層的斷言不夠**：`tests/a11y/batch-actions.test.tsx` 驗的是
// 核取方塊有沒有名稱、選取數在不在即時區域內、警語在不在 `aria-describedby` 目標裡 ——
// 那三件事全部成立，整條路徑仍可能**走不完**（焦點逸出對話框、二次確認按不到、
// 停用的按鈕擋在中間）。三條批次 E2E 都以點擊操作，證明不了這件事。
//
// **資料前置（建作品、建卷、匯入）以一般操作完成**，受測的是兩條批次路徑本身。
// ───────────────────────────────────────────────────────────────────

const SEED_PASSWORD = loadTestEnv().SEED_USER_PASSWORD;
/** 種子資料裡本來就是作者的帳號 —— 本檔在 `author-flow` **之前**執行，不能靠它升級誰 */
const AUTHOR_EMAIL = 'author@novelsite.tw';
const A11Y_RUN_ID = Date.now().toString(36);
const A11Y_AUTHOR_STATE = path.join(os.tmpdir(), 'novelsite-e2e-a11y-author-state.json');

interface FocusInfo {
  tag: string;
  type: string;
  name: string;
}

/** 目前焦點所在元素的可辨識資訊（核取方塊的名稱來自 `label[for]`，與螢幕閱讀器同一個來源） */
async function focusInfo(page: Page): Promise<FocusInfo> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return { tag: '', type: '', name: '' };
    const labelled = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
    const name = el.getAttribute('aria-label') ?? labelled?.textContent ?? el.textContent ?? '';
    return {
      tag: el.tagName,
      type: (el as HTMLInputElement).type ?? '',
      name: name.replace(/\s+/g, ' ').trim(),
    };
  });
}

/**
 * **只按 Tab**，直到焦點落在符合條件的元素上。
 * 走不到就拋，訊息帶上最後停在哪裡 —— 焦點逸出或被卡住時，
 * 「Tab 200 次還在同一顆按鈕上」比「等待逾時」看得出原因。
 */
async function tabUntil(
  page: Page,
  match: (info: FocusInfo) => boolean,
  what: string,
  limit = 200
): Promise<void> {
  let info = await focusInfo(page);
  for (let i = 0; i < limit; i++) {
    if (match(info)) return;
    await page.keyboard.press('Tab');
    info = await focusInfo(page);
  }
  throw new Error(`按 Tab ${limit} 次仍未走到「${what}」，最後停在：${info.tag}／${info.name}`);
}

test.describe('無障礙流：批次操作的鍵盤 only 全路徑（SC-010）', () => {
  test.use({ storageState: A11Y_AUTHOR_STATE });

  test.beforeAll(async ({ browser }) => {
    // `storageState: undefined` 是必要的：`browser.newContext()` 會沿用上方 `test.use`
    // 的設定，而那個檔案正是本 hook 要產生的
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();
    await page.goto('/auth/login');
    await page.getByLabel('Email').fill(AUTHOR_EMAIL);
    await page.getByLabel('密碼').fill(SEED_PASSWORD);
    await page.getByRole('button', { name: '登入' }).click();
    await expect(page).not.toHaveURL(/\/auth\/login/);
    await context.storageState({ path: A11Y_AUTHOR_STATE });
    await context.close();
  });

  test('T048a 僅以 Tab／Space／Enter 完成「選取 → 批次發佈 → 確認」與「選取 → 批次刪除 → 二次確認」', async ({
    page,
  }) => {
    test.setTimeout(120_000);

    // ── 資料前置（一般操作）：一卷、兩章草稿 ──
    await page.goto('/author/create');
    await page.getByLabel('作品名稱').fill(`E2E 鍵盤批次操作 ${A11Y_RUN_ID}`);
    await page.getByLabel('作品簡介').fill('由端對端測試建立，用於驗證鍵盤 only 的批次操作路徑。');
    await page.getByRole('button', { name: '建立作品' }).click();
    await page.waitForURL(/\/author\/novels\/[^/]+$/);
    const managePath = new URL(page.url()).pathname;

    await page.getByLabel('新增卷（編號由系統指派）').fill('第一卷 鍵盤篇');
    await page.getByRole('button', { name: '新增卷' }).click();
    await expect(page.getByRole('button', { name: '批次上傳' })).toBeVisible();

    await page.getByRole('button', { name: '批次上傳' }).click();
    await page.getByLabel('選擇章節檔（可多選）').setInputFiles(
      [1, 2].map((n) => ({
        name: `第${n}章_鍵盤章${n}-${A11Y_RUN_ID}.md`,
        mimeType: 'text/markdown',
        buffer: Buffer.from(`第 ${n} 章的正文（${A11Y_RUN_ID}）。`, 'utf8'),
      }))
    );
    await expect(page.getByText('可匯入 2 章')).toBeVisible();
    await page.getByRole('button', { name: '確認匯入' }).click();
    await expect(page.getByText('已建立 2 章')).toBeVisible({ timeout: 30_000 });

    // 選取數 MUST 取自即時區域 —— 看得見的數字對讀螢幕的作者不算數（FR-031）
    const liveRegion = page.locator('[aria-live="polite"]').filter({ hasText: '已選' });

    // ═══ 路徑一（SC-010）：選取 → 批次發佈 → 確認。這裡開始不再使用滑鼠 ═══
    await page.goto(managePath);
    await expect(page.getByRole('link', { name: `鍵盤章1-${A11Y_RUN_ID}` })).toBeVisible();

    // 核取方塊的名稱含章號與標題，鍵盤使用者因此分得出是哪一章（FR-030）
    await tabUntil(
      page,
      (info) => info.type === 'checkbox' && info.name.startsWith('選取第 1 章'),
      '第 1 章的選取核取方塊'
    );
    await page.keyboard.press('Space');
    await expect(liveRegion).toContainText('已選 1 章');

    await tabUntil(page, (info) => info.name === '批次發佈', '批次發佈按鈕');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();

    await tabUntil(page, (info) => info.name === '確認發佈', '確認發佈按鈕');
    await page.keyboard.press('Enter');
    await expect(page.getByText('已發佈 1 章')).toBeVisible({ timeout: 30_000 });

    // ═══ 路徑二（SC-010）：選取 → 批次刪除 → 二次確認 ═══
    // 重新載入只是把焦點送回文件開頭，好讓下一條路徑從同一個起點走 ——
    // 兩條路徑各自獨立，MUST NOT 借用前一條殘留的焦點位置
    await page.goto(managePath);
    await expect(page.getByText('已發佈').first()).toBeVisible();

    // 1. 選取第 1 章（**現在是已發佈章節**，故下一步 MUST 出現二次確認）
    await tabUntil(
      page,
      (info) => info.type === 'checkbox' && info.name.startsWith('選取第 1 章'),
      '第 1 章的選取核取方塊'
    );
    await page.keyboard.press('Space');
    await expect(liveRegion).toContainText('已選 1 章');

    // 2. 觸發批次刪除
    await tabUntil(page, (info) => info.name === '批次刪除', '批次刪除按鈕');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();

    // 3. 對話的**可及描述**含「其中 M 章已發佈」——
    //    聽不到那句話，這道加強確認對讀螢幕的作者就等於不存在（FR-032）
    const description = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      const ids = dialog?.getAttribute('aria-describedby')?.split(/\s+/) ?? [];
      return ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
    });
    expect(description).toContain('其中 1 章已發佈');

    // 4. 二次確認（FR-016）：勾選 → 確認刪除。焦點鎖在對話框內，Tab 走得到這兩個控制項
    await tabUntil(
      page,
      (info) => info.type === 'checkbox' && info.name.includes('我了解'),
      '二次確認核取方塊'
    );
    await page.keyboard.press('Space');

    await tabUntil(page, (info) => info.name === '確認刪除', '確認刪除按鈕');
    await page.keyboard.press('Enter');

    // 5. 整條路徑真的走完了：第 1 章不見、第 2 章還在、章號未被重排（FR-020）
    await expect(page.getByText('已刪除 1 章。剩餘章節的章號未變動。')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole('link', { name: `鍵盤章1-${A11Y_RUN_ID}` })).toHaveCount(0);
    await expect(page.getByRole('link', { name: `鍵盤章2-${A11Y_RUN_ID}` })).toBeVisible();
    // `exact` 是必要的：章節列的可及名稱「選取第 2 章〈…〉」也含這四個字
    await expect(page.getByText('第 2 章', { exact: true })).toBeVisible();
  });
});
