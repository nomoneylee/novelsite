import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { search, suggest } from '@/lib/services/searchService';
import {
  createAuthor,
  createSearchNovel,
  distinctCategoryIds,
  cleanupAuthoring,
  type TestAuthor,
} from '../helpers/authoring';

/**
 * `arch.md` §10.3 案例 20 與 SC-004：**空白搜尋不載入任何作品列**。
 *
 * 判準刻意是「有沒有發出查詢」而不是「回傳陣列是不是空的」——
 * 被廢除的 `searchNovels()` 全表載入在空查詢時也回空陣列（它先 `trim` 再判斷），
 * 兩者在回傳值上完全分不出來。真正的差別只有一個：查詢有沒有送到資料庫。
 *
 * 計數方式為包住 Prisma 客戶端的兩個入口（raw 查詢與 `novel.findMany`），
 * 而非 `vi.spyOn` —— 客戶端的屬性由 Proxy 提供，`getOwnPropertyDescriptor`
 * 取不到原始函式，spy 會包到 `undefined` 上。
 */

const TOKEN = 'zemptyscan';

let author: TestAuthor;
let categoryId: string;

interface Counters {
  raw: number;
  findMany: number;
  total(): number;
}

const counters: Counters = {
  raw: 0,
  findMany: 0,
  total() {
    return this.raw + this.findMany;
  },
};

/* eslint-disable @typescript-eslint/no-explicit-any */
const client = prisma as any;
let restore: (() => void) | null = null;

beforeAll(async () => {
  await cleanupAuthoring();
  author = await createAuthor('emptyscan');
  [categoryId] = await distinctCategoryIds(1);
  await createSearchNovel({
    authorId: author.id,
    title: `${TOKEN} 有內容的作品`,
    categoryId,
  });

  const originalRaw = client.$queryRawUnsafe.bind(client);
  const originalFindMany = client.novel.findMany.bind(client.novel);

  client.$queryRawUnsafe = (...args: unknown[]) => {
    counters.raw += 1;
    return originalRaw(...args);
  };
  client.novel.findMany = (...args: unknown[]) => {
    counters.findMany += 1;
    return originalFindMany(...args);
  };

  restore = () => {
    client.$queryRawUnsafe = originalRaw;
    client.novel.findMany = originalFindMany;
  };
});

afterAll(async () => {
  restore?.();
  await cleanupAuthoring();
});

beforeEach(() => {
  counters.raw = 0;
  counters.findMany = 0;
});

describe('計數器本身是有效的（沒有這一則，下面全部的「0 次」都可能是假的）', () => {
  it('有內容的查詢 MUST 使計數器增加', async () => {
    const page = await search({ q: TOKEN });

    expect(page.items.length).toBeGreaterThan(0);
    expect(counters.raw).toBeGreaterThan(0);
    expect(counters.findMany).toBeGreaterThan(0);
  });
});

describe('空查詢不對 Novel 表發出任何查詢（案例 20、SC-004、FR-032）', () => {
  it('空字串', async () => {
    await expect(search({ q: '' })).resolves.toEqual({ items: [], nextCursor: null });
    expect(counters.total()).toBe(0);
  });

  it('純空白', async () => {
    await expect(search({ q: '   \n\t' })).resolves.toEqual({ items: [], nextCursor: null });
    expect(counters.total()).toBe(0);
  });

  it('未帶 q 參數', async () => {
    await expect(search({})).resolves.toEqual({ items: [], nextCursor: null });
    expect(counters.total()).toBe(0);
  });

  it('帶了游標與筆數但 q 為空 —— 仍然不查詢', async () => {
    await expect(search({ q: '', cursor: 'anything', limit: 50 })).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
    expect(counters.total()).toBe(0);
  });
});

describe('建議模式未達 2 字元不發查詢（FR-031、US2 AC5）', () => {
  it('0 字元與 1 字元皆不查詢', async () => {
    await expect(suggest({ q: '' })).resolves.toEqual([]);
    await expect(suggest({ q: '劍' })).resolves.toEqual([]);
    await expect(suggest({ q: '  劍  ' })).resolves.toEqual([]);
    expect(counters.total()).toBe(0);
  });

  it('達 2 字元才查詢', async () => {
    await suggest({ q: TOKEN });
    expect(counters.total()).toBeGreaterThan(0);
  });
});

describe('查無資料時不做第二步取回（兩步查詢的第二步以第一步的結果為前提）', () => {
  it('第一步無命中 → MUST NOT 呼叫 novel.findMany', async () => {
    await expect(search({ q: 'zz-絕不存在的關鍵字-zz' })).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
    expect(counters.raw).toBe(1);
    expect(counters.findMany).toBe(0);
  });
});
