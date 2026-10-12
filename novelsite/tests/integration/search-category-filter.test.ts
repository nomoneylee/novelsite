import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { search } from '@/lib/services/searchService';
import { testFetch } from '../helpers/client';
import {
  createAuthor,
  createSearchNovel,
  distinctCategoryIds,
  cleanupAuthoring,
  type TestAuthor,
} from '../helpers/authoring';

/**
 * FR-030b／US2 AC10：分類篩選與關鍵字為 **AND**，且分類可單獨成立。
 *
 * 「變更分類後游標重置回第一頁」在這裡以**伺服器端的保證**表達：
 * `/search` 頁的網址裡根本沒有游標這個參數，首屏永遠是第一頁 ——
 * 游標只存在於用戶端「載入更多」的 fetch 中。這條性質可以直接量測
 * （帶著游標請求頁面，內容仍是第一頁），而「使用者按了下拉選單之後前端有沒有
 * 把游標清掉」則會隨 UI 改寫而失效，測它等於把測試綁在實作細節上。
 */

const TOKEN = 'zcategory';
const IP = '10.66.1.1';

let author: TestAuthor;
let catA: string;
let catB: string;
let inA: string;
let inB: string;
let otherInA: string;

async function idsOf(params: Record<string, unknown>): Promise<string[]> {
  const page = await search({ limit: 50, ...params });
  return page.items.map((n) => n.id);
}

beforeAll(async () => {
  await cleanupAuthoring();
  author = await createAuthor('category');
  [catA, catB] = await distinctCategoryIds(2);

  inA = await createSearchNovel({
    authorId: author.id,
    categoryId: catA,
    title: `${TOKEN} 甲分類作品`,
    updatedAt: new Date('2026-07-20T00:00:00.000Z'),
  });
  inB = await createSearchNovel({
    authorId: author.id,
    categoryId: catB,
    title: `${TOKEN} 乙分類作品`,
    updatedAt: new Date('2026-07-19T00:00:00.000Z'),
  });
  otherInA = await createSearchNovel({
    authorId: author.id,
    categoryId: catA,
    title: 'zcatonly 甲分類但關鍵字不同',
    updatedAt: new Date('2026-07-18T00:00:00.000Z'),
  });
});

afterAll(async () => {
  await cleanupAuthoring();
});

describe('關鍵字與分類為 AND（FR-030b）', () => {
  it('併用時只回同時滿足兩者者', async () => {
    expect(await idsOf({ q: TOKEN, category: catA })).toEqual([inA]);
    expect(await idsOf({ q: TOKEN, category: catB })).toEqual([inB]);
  });

  it('只給關鍵字時兩個分類的作品都回', async () => {
    expect(await idsOf({ q: TOKEN })).toEqual([inA, inB]);
  });

  it('分類可單獨成立（q 為空時仍依分類篩選，US2 AC10）', async () => {
    const ids = await idsOf({ q: '', category: catA });

    expect(ids).toContain(inA);
    expect(ids).toContain(otherInA);
    expect(ids).not.toContain(inB);
  });

  it('清除篩選後回復完整結果', async () => {
    expect(await idsOf({ q: TOKEN, category: catA })).toEqual([inA]);
    expect(await idsOf({ q: TOKEN })).toEqual([inA, inB]);
  });
});

describe('不存在的分類識別碼回空結果而非錯誤（US2 AC10）', () => {
  it('服務層回空陣列', async () => {
    await expect(search({ q: TOKEN, category: 'zz-no-such-category' })).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
  });

  it('API 回 200 與空 data，不是 500', async () => {
    const res = await testFetch(
      `/api/search?q=${encodeURIComponent(TOKEN)}&category=zz-no-such-category`,
      { method: 'GET', ip: IP }
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [], meta: { nextCursor: null } });
  });
});

describe('變更分類回到第一頁（`/search` 頁不吃游標）', () => {
  it('頁面首屏永遠是第一頁：帶著游標請求，內容與不帶時相同', async () => {
    const firstPage = await search({ q: TOKEN, limit: 1 });
    expect(firstPage.nextCursor).not.toBeNull();

    const withoutCursor = await testFetch(`/search?q=${encodeURIComponent(TOKEN)}`, {
      method: 'GET',
      ip: IP,
    });
    const withCursor = await testFetch(
      `/search?q=${encodeURIComponent(TOKEN)}&cursor=${encodeURIComponent(firstPage.nextCursor!)}`,
      { method: 'GET', ip: IP }
    );

    expect(withoutCursor.status).toBe(200);
    expect(withCursor.status).toBe(200);

    const plainHtml = await withoutCursor.text();
    const cursorHtml = await withCursor.text();
    for (const html of [plainHtml, cursorHtml]) {
      expect(html).toContain(inA);
      expect(html).toContain(inB);
    }
  });

  it('切換分類的網址只帶 q 與 category，結果隨之改變', async () => {
    const inCatA = await testFetch(`/search?q=${encodeURIComponent(TOKEN)}&category=${catA}`, {
      method: 'GET',
      ip: IP,
    });
    const html = await inCatA.text();

    expect(inCatA.status).toBe(200);
    expect(html).toContain(inA);
    expect(html).not.toContain(inB);
  });
});
