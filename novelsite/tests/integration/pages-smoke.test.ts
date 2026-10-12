import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testFetch, loginAs } from '../helpers/client';
import { createUser } from '../helpers/fixtures';
import { resetAuthTables } from '../helpers/resetAuthTables';
import { createNovelWithChapter, cleanupAuthoring } from '../helpers/authoring';

/**
 * 既有 26 頁 smoke 驗收（SC-008、FR-025）。
 *
 * MUST 依存取條件分組，MUST NOT 對 26 頁一律以未登入身分斷言 200 ——
 * `src/proxy.ts:11` 的 PROTECTED_PREFIX_RE 對未登入一律 302 導向登入頁、
 * `:54` 對 reader 角色存取 /author/* 亦 302，未帶 cookie 的斷言必然失敗。
 *
 * 帳號以 fixtures 的 createUser() 自建，MUST NOT 依賴 seed 的示範帳號 ——
 * 每個整合測試檔的 beforeAll 都會呼叫 resetAuthTables() 清空 User 表，
 * 本檔執行時示範帳號早已不在庫（檔案間循序執行，見 vitest.integration.config.mts）。
 *
 * 每角色 MUST 只登入一次並重用 cookie —— 登入端點對來源位址限速 5 次／分鐘
 * （FEAT-1 FR-052），逐頁登入會在第 6 次起被 429。
 */

let authorCookie: string;
let readerCookie: string;

/** 動態路由以示範資料的實際 id 代入（自公開頁面解析，不硬編） */
let novelId: string;
let readerChapterId: string;
let categoryId: string;

/**
 * 作者章節編輯器與作品管理頁所用的 id。
 *
 * **FEAT-3 起改為當場建立**（原為 seed 的固定草稿 `draft-1`）：作者後台的擁有者
 * 已由 `DEMO_AUTHOR_ID` 改為登入的工作階段（T052／T053），而本檔的 smoke 帳號是
 * `createUser()` 現建的，名下本來就沒有任何作品 —— 沿用示範草稿的話這兩頁一律 404。
 */
let authorNovelId: string;
let authorChapterId: string;

/** 未登入即可存取的靜態公開頁（14 個） */
const PUBLIC_STATIC_PAGES = [
  '/',
  '/about',
  '/auth/login',
  '/auth/register',
  '/categories',
  '/contact',
  '/design-system',
  '/help',
  '/new-releases',
  '/novels',
  '/privacy',
  '/ranking',
  '/search',
  '/terms',
];

/** 需 author 角色 cookie 的受保護頁（6 個） */
const AUTHOR_STATIC_PAGES = [
  '/author/create',
  '/author/dashboard',
  '/author/earn',
  '/author/guide',
  '/author/novels',
];

/** 需 reader 角色 cookie 的受保護頁（4 個；`/profile/notifications` 為 FEAT-4 T138 新增） */
const PROFILE_PAGES = [
  '/profile/bookshelf',
  '/profile/history',
  '/profile/notifications',
  '/profile/settings',
];

beforeAll(async () => {
  await resetAuthTables();

  const smokeAuthor = await createUser({
    email: 'smoke-author@example.com',
    role: 'author',
    password: 'Author1234',
  });
  await createUser({ email: 'smoke-reader@example.com', role: 'reader', password: 'Reader1234' });

  const owned = await createNovelWithChapter({ authorId: smokeAuthor.id });
  authorNovelId = owned.novelId;
  authorChapterId = owned.chapterId;

  authorCookie = await loginAs('smoke-author@example.com', 'Author1234', '10.60.1.1');
  readerCookie = await loginAs('smoke-reader@example.com', 'Reader1234', '10.60.1.2');

  // 作品／章節 id：自 /novels 公開頁解析，並逐一驗證該 /reader 連結確實可 200
  // （示範資料中部分作品 volumes 為空、firstChapterId 仍指向不存在的章節）
  const novelsHtml = await testFetch('/novels', { ip: '10.60.2.1' }).then((r) => r.text());
  const candidateIds = [...novelsHtml.matchAll(/\/novels\/([a-zA-Z0-9_-]+)/g)].map((m) => m[1]);

  for (const id of candidateIds) {
    const detailRes = await testFetch(`/novels/${id}`, { ip: '10.60.2.2' });
    if (detailRes.status !== 200) continue;
    const detailHtml = await detailRes.text();
    // novelId 與 chapterId MUST 取自同一個 /reader/ 連結 —— 詳情頁另有相關作品連結，
    // 只抓 chapterId 卻沿用外層迴圈的 id 會兜出不成對的組合而 404。
    const chapterMatch = detailHtml.match(/\/reader\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)/);
    if (!chapterMatch) continue;

    const readerRes = await testFetch(`/reader/${chapterMatch[1]}/${chapterMatch[2]}`, {
      ip: '10.60.2.3',
    });
    if (readerRes.status !== 200) continue;

    novelId = chapterMatch[1];
    readerChapterId = chapterMatch[2];
    break;
  }

  if (!novelId || !readerChapterId) {
    throw new Error('無法自 /novels 公開頁面解析出可用的 novelId／chapterId');
  }

  const categoriesHtml = await testFetch('/categories', { ip: '10.60.2.4' }).then((r) => r.text());
  const categoryMatch = categoriesHtml.match(/\/categories\/([a-zA-Z0-9_-]+)/);
  if (!categoryMatch) {
    throw new Error('無法自 /categories 公開頁面解析出可用的 categoryId');
  }
  categoryId = categoryMatch[1];
});

describe('26 頁 smoke：17 個公開頁（未登入 → 200）', () => {
  it.each(PUBLIC_STATIC_PAGES)('%s', async (path) => {
    const res = await testFetch(path, { ip: '10.60.3.1' });
    expect(res.status).toBe(200);
  });

  it('/novels/{novelId}', async () => {
    const res = await testFetch(`/novels/${novelId}`, { ip: '10.60.3.2' });
    expect(res.status).toBe(200);
  });

  it('/categories/{categoryId}', async () => {
    const res = await testFetch(`/categories/${categoryId}`, { ip: '10.60.3.3' });
    expect(res.status).toBe(200);
  });

  it('/reader/{novelId}/{chapterId}', async () => {
    const res = await testFetch(`/reader/${novelId}/${readerChapterId}`, { ip: '10.60.3.4' });
    expect(res.status).toBe(200);
  });
});

afterAll(async () => {
  await cleanupAuthoring();
});

describe('26 頁 smoke：9 個受保護頁（帶對應角色 cookie → 200）', () => {
  it.each(AUTHOR_STATIC_PAGES)('%s（author cookie）', async (path) => {
    const res = await testFetch(path, { ip: '10.60.4.1', cookie: authorCookie });
    expect(res.status).toBe(200);
  });

  it('/author/editor/{chapterId}（author cookie）', async () => {
    const res = await testFetch(`/author/editor/${authorChapterId}`, {
      ip: '10.60.4.2',
      cookie: authorCookie,
    });
    expect(res.status).toBe(200);
  });

  it('/author/novels/{novelId}（author cookie，FEAT-3 新增的作品管理頁）', async () => {
    const res = await testFetch(`/author/novels/${authorNovelId}`, {
      ip: '10.60.4.3',
      cookie: authorCookie,
    });
    expect(res.status).toBe(200);
  });

  it.each(PROFILE_PAGES)('%s（reader cookie）', async (path) => {
    const res = await testFetch(path, { ip: '10.60.4.3', cookie: readerCookie });
    expect(res.status).toBe(200);
  });
});
