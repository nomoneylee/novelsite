import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import {
  getFeaturedNovels,
  getNovelsByCategory,
  getCategories,
  deleteNovelOwned,
} from '@/lib/repositories';
import { testFetch } from '../helpers/client';
import { resetAuthTables } from '../helpers/resetAuthTables';
import { createAccount, createPublishedNovel } from '../helpers/fixtures';

/**
 * T093：計數全為 0 時的熱門排序必須確定（FR-043c）
 * ================================================
 * 這條需求的觸發情境不是邊角案例，**它就是示範環境的預設樣貌**：
 * FR-043a 把全站六個計數歸零之後，每一部作品的「熱門度」都一樣。
 * 排序鍵完全相同時，資料庫沒有義務給出穩定的次序 ——
 * 於是首頁重新整理一次，作品的排列就換一種，看起來像頁面壞了或內容在跳動。
 * 兩軌的表現還不一樣（SQLite 與 PostgreSQL 對同分列的回傳順序各憑實作），
 * 所以這也是一個會「在某一軌上偶爾紅」的問題。
 *
 * 解法是既有的決勝鍵：`updatedAt DESC, id ASC`。`id` 是主鍵、必然唯一，
 * 有它才構成**全序** —— 只補 `updatedAt` 仍可能同值（本檔刻意把它們設成同值來驗這件事）。
 *
 * **決定性的斷言是資料存取層那一組**：它每次都真的查一次資料庫，
 * 而且期望值是可獨立算出的 `id ASC`，不是「三次互相比對」。
 * 頁面那一組是端到端的確認（版面經 `getSessionUser()` 讀 Cookie，
 * 每個請求都會重新算，不會被靜態預算掉），但它只驗得出「三次一樣」——
 * 一個恰好穩定的實作也會通過，故 MUST NOT 只留頁面那一組。
 */

/** 六部作品足以讓「偶然順序相同」變得不可能被誤判為正確 */
const NOVEL_COUNT = 6;

/** 全站計數皆為 0 的樣貌；`updatedAt` 亦刻意設為同值，逼出最後一層決勝鍵 `id ASC` */
const FIXED_UPDATED_AT = new Date('2026-07-01T00:00:00.000Z');

let author: { id: string };
let categoryLabel: string;
let ourIds: string[];
/** 依 `id` 遞增排序的期望次序 */
let expectedOrder: string[];

/** 自 HTML 取出我方作品連結的出現次序（只看第一次出現的位置） */
function orderInHtml(html: string): string[] {
  return ourIds
    .map((id) => ({ id, at: html.indexOf(`/novels/${id}`) }))
    .filter((hit) => hit.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((hit) => hit.id);
}

async function loadPage(path: string): Promise<string> {
  const res = await testFetch(path, { method: 'GET', ip: '10.93.5.1' });
  expect(res.status).toBe(200);
  return res.text();
}

/** 只保留我方作品，用以在混有示範作品的清單中比較「相對次序」 */
function ourOrder(ids: string[]): string[] {
  return ids.filter((id) => ourIds.includes(id));
}

beforeAll(async () => {
  await resetAuthTables();
  author = await createAccount('deterministic-author', 'author');

  const categories = await getCategories();
  categoryLabel = categories[0].label;

  ourIds = [];
  for (let i = 0; i < NOVEL_COUNT; i++) {
    const novel = await createPublishedNovel({
      authorId: author.id,
      chapterCount: 1,
      title: `T093 決勝鍵測試作品 ${i}`,
    });
    ourIds.push(novel.novelId);
  }
  expectedOrder = [...ourIds].sort();

  // 全站計數歸零的樣貌 ＋ 精選（首頁熱門區塊的來源）。
  // `publishedAt` 刻意**各不相同**：新書與書庫是依時間排序，讓它們有明確次序，
  // 本檔要驗的才會單純是「熱門度同分時怎麼辦」，而不是兩種排序攪在一起
  for (let i = 0; i < ourIds.length; i++) {
    await prisma.novel.update({
      where: { id: ourIds[i] },
      data: {
        isFeatured: true,
        rating: 0,
        ratingCount: 0,
        totalViews: 0,
        weeklyViews: 0,
        favoriteCount: 0,
        commentCount: 0,
        updatedAt: FIXED_UPDATED_AT,
        publishedAt: new Date(Date.now() - (i + 1) * 3_600_000),
      },
    });
  }
});

afterAll(async () => {
  for (const id of ourIds) await deleteNovelOwned(author.id, id);
  await resetAuthTables();
});

describe('T093-1：資料存取層的熱門排序（決定性斷言）', () => {
  it('前提：六部作品的熱門排序鍵完全相同（同分才有決勝鍵可言）', async () => {
    const rows = await prisma.novel.findMany({
      where: { id: { in: ourIds } },
      select: {
        weeklyViews: true,
        rating: true,
        totalViews: true,
        favoriteCount: true,
        updatedAt: true,
      },
    });
    expect(rows).toHaveLength(NOVEL_COUNT);
    for (const row of rows) {
      expect(row.weeklyViews).toBe(0);
      expect(row.rating).toBe(0);
      expect(row.totalViews).toBe(0);
      expect(row.favoriteCount).toBe(0);
      expect(row.updatedAt.getTime()).toBe(FIXED_UPDATED_AT.getTime());
    }
  });

  it('精選（熱門）清單：同分時以 id 遞增為序', async () => {
    const ids = ourOrder((await getFeaturedNovels()).map((n) => n.id));
    expect(ids).toEqual(expectedOrder);
  });

  it('分類清單（依人氣排序）：同分時以 id 遞增為序', async () => {
    const ids = ourOrder((await getNovelsByCategory(categoryLabel)).map((n) => n.id));
    expect(ids).toEqual(expectedOrder);
  });

  it('連續三次查詢的次序完全相同', async () => {
    const runs: string[][] = [];
    for (let i = 0; i < 3; i++) {
      runs.push(ourOrder((await getFeaturedNovels()).map((n) => n.id)));
    }
    expect(runs[1]).toEqual(runs[0]);
    expect(runs[2]).toEqual(runs[0]);
    expect(runs[0]).toEqual(expectedOrder);
  });
});

describe('T093-2：連續三次載入書庫頁，次序完全相同', () => {
  it('/novels 的作品次序三次一致', async () => {
    const runs: string[][] = [];
    for (let i = 0; i < 3; i++) runs.push(orderInHtml(await loadPage('/novels')));

    // 前提：頁面確實把六部都渲染出來了，否則「次序相同」可能只是因為空陣列相等
    expect(runs[0]).toHaveLength(NOVEL_COUNT);
    expect(runs[1]).toEqual(runs[0]);
    expect(runs[2]).toEqual(runs[0]);
  }, 60_000);
});

describe('T093-3：連續三次載入首頁，熱門區塊次序完全相同', () => {
  it('/ 的作品次序三次一致，且與資料存取層的熱門次序相符', async () => {
    const runs: string[][] = [];
    for (let i = 0; i < 3; i++) runs.push(orderInHtml(await loadPage('/')));

    expect(runs[0].length).toBeGreaterThanOrEqual(2);
    expect(runs[1]).toEqual(runs[0]);
    expect(runs[2]).toEqual(runs[0]);
  }, 60_000);
});
