import { describe, it, expect, beforeAll } from 'vitest';
import {
  getAllNovels,
  getNewNovels,
  getNovelsByCategory,
  getCategoryCounts,
  getCategories,
} from '@/lib/repositories';
import type { Novel, Category } from '@/lib/types';

/**
 * US1（2-A）冗餘欄位移除後的推導欄位（FR-007、research R-5）。
 *
 * 1. `Novel.isNew` 欄位移除後，「新書」改由 `publishedAt` 近 30 天推導 ——
 *    結果 MUST 與改造前（`where isNew: true`）一致。
 * 2. `Novel.category`（label 字串）改 `categoryId` FK 後，`getNovelsByCategory`
 *    改為「先查 Category by label → 以 categoryId 過濾」，結果 MUST 與 label 查詢一致，
 *    且與 `getCategoryCounts`（groupBy categoryId 後映射回 label）自洽。
 */

/**
 * 改造前 seed 標記 isNew=true 的 6 部作品（src/lib/mockData.ts 的 NEW_NOVELS）。
 *
 * 註：seed 的上架時間**以執行當日 UTC 午夜為基準**回推（`prisma/seed.ts` 的 `baseDate`），
 * 六部新書恆為 3～8 天前、其餘恆為 30 天以上，故本斷言不再有保鮮期。
 * **原文的固定基準日 `2026-07-21` 已於 2026-08-14 移除**：它替示範資料設下 22 天保鮮期，
 * 過期後本案例轉紅（實際發生過一次，少了 `new-5`／`new-6`），而錯的是資料不是推導邏輯——
 * 換一個固定日期只會把同一顆引信往後推 22 天。
 */
const EXPECTED_NEW_NOVEL_IDS = ['new-1', 'new-2', 'new-3', 'new-4', 'new-5', 'new-6'];

let allNovels: Novel[];
let categories: Category[];

beforeAll(async () => {
  allNovels = await getAllNovels();
  categories = await getCategories();
});

describe('isNew 改由 publishedAt 近 30 天推導（FR-007）', () => {
  it('getNewNovels() 的結果集合與改造前 isNew=true 的 6 部一致', async () => {
    const ids = (await getNewNovels()).map((n) => n.id).sort();
    expect(ids).toEqual([...EXPECTED_NEW_NOVEL_IDS].sort());
  });

  it('領域欄位 isNew 與 getNewNovels() 自洽：在清單內為 true、不在清單內為 falsy', async () => {
    const newIds = new Set((await getNewNovels()).map((n) => n.id));
    expect(newIds.size).toBeGreaterThan(0);
    for (const novel of allNovels) {
      if (newIds.has(novel.id)) {
        expect(novel.isNew).toBe(true);
      } else {
        expect(novel.isNew).toBeFalsy();
      }
    }
  });

  it('limit 參數仍生效（依上架時間新→舊取前 N 筆）', async () => {
    const full = await getNewNovels();
    const limited = await getNewNovels(2);
    expect(limited.map((n) => n.id)).toEqual(full.slice(0, 2).map((n) => n.id));
  });
});

describe('分類查詢改經 categoryId（FR-002）', () => {
  it('每個分類 label 的查詢結果與「作品清單依 category 過濾」一致', async () => {
    for (const category of categories) {
      const byQuery = (await getNovelsByCategory(category.label)).map((n) => n.id).sort();
      const byFilter = allNovels
        .filter((n) => n.category === category.label)
        .map((n) => n.id)
        .sort();
      expect(byQuery).toEqual(byFilter);
    }
  });

  it('getCategoryCounts() 以 label 為鍵，數量與分類查詢一致', async () => {
    const counts = await getCategoryCounts();
    let matched = 0;
    for (const category of categories) {
      const list = await getNovelsByCategory(category.label);
      if (list.length === 0) {
        // 無作品的分類不會出現在 groupBy 結果中
        expect(counts[category.label] ?? 0).toBe(0);
        continue;
      }
      expect(counts[category.label]).toBe(list.length);
      matched++;
    }
    expect(matched).toBeGreaterThan(0);
  });

  it('不存在的分類 label 回傳空陣列（不擲錯）', async () => {
    await expect(getNovelsByCategory('這個分類不存在')).resolves.toEqual([]);
  });
});
