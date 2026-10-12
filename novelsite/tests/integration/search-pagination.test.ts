import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { search, suggest } from '@/lib/services/searchService';
import {
  createAuthor,
  createSearchNovel,
  distinctCategoryIds,
  cleanupAuthoring,
  TEST_PREFIX,
  type TestAuthor,
} from '../helpers/authoring';

/**
 * US2 AC6／AC9、FR-030a、FR-035：游標翻頁不重複不遺漏，草稿不外洩。
 *
 * **同一時刻的兩筆是這一組真正的重點**：只以 `updatedAt` 當游標的實作，
 * 在排序鍵相同的兩筆之間會二選一 —— 不是漏掉一筆就是重複一筆，
 * 而且只在「剛好同秒建立」時出錯，測不到就會一路帶進正式環境。
 * 故固定安排一組時間完全相同的作品，靠 `id` 做決勝鍵（FR-034）。
 */

const TOKEN = 'zpaging';

let author: TestAuthor;
let categoryId: string;
/** 期望順序（updatedAt DESC, id ASC） */
let expectedOrder: string[];
let draftNovelId: string;

/** 依游標逐頁取完，回傳走訪到的 id 序列 */
async function walkAllPages(pageSize: number): Promise<string[]> {
  const visited: string[] = [];
  let cursor: string | undefined;
  let guard = 0;

  for (;;) {
    const page = await search({ q: TOKEN, limit: pageSize, ...(cursor ? { cursor } : {}) });
    visited.push(...page.items.map((n) => n.id));
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
    if (++guard > 20) throw new Error('翻頁未終止：nextCursor 一直不為 null');
  }

  return visited;
}

beforeAll(async () => {
  await cleanupAuthoring();
  author = await createAuthor('paging');
  [categoryId] = await distinctCategoryIds(1);

  // 三個不同時刻 + 一組時刻完全相同的兩筆（決勝鍵為 id ASC）
  const distinct = [
    { title: `${TOKEN} 甲`, updatedAt: new Date('2026-07-20T00:00:00.000Z') },
    { title: `${TOKEN} 乙`, updatedAt: new Date('2026-07-19T00:00:00.000Z') },
    { title: `${TOKEN} 丙`, updatedAt: new Date('2026-07-18T00:00:00.000Z') },
  ];
  const created: Array<{ id: string; updatedAt: Date }> = [];
  for (const item of distinct) {
    created.push({
      id: await createSearchNovel({ authorId: author.id, categoryId, ...item }),
      updatedAt: item.updatedAt,
    });
  }

  const tie = new Date('2026-07-17T00:00:00.000Z');
  // 平手組的識別碼刻意寫死且只差一個英文字母：自動產生的序號（…-9 與 …-10）
  // 在不同資料庫 collation 下的大小關係未必一致，那會讓期望值本身變成不確定的
  for (const [suffix, id] of [
    ['丁', `${TEST_PREFIX}novel-tie-a`],
    ['戊', `${TEST_PREFIX}novel-tie-b`],
  ] as const) {
    created.push({
      id: await createSearchNovel({
        authorId: author.id,
        categoryId,
        title: `${TOKEN} ${suffix}`,
        updatedAt: tie,
        id,
      }),
      updatedAt: tie,
    });
  }

  expectedOrder = [...created]
    .sort(
      (a, b) =>
        b.updatedAt.getTime() - a.updatedAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    )
    .map((c) => c.id);

  // 草稿作品：標題含同一個關鍵字，MUST NOT 出現在結果與建議中
  draftNovelId = await createSearchNovel({
    authorId: author.id,
    categoryId,
    title: `${TOKEN} 未上架的草稿`,
    status: 'draft',
    updatedAt: new Date('2026-07-21T00:00:00.000Z'),
  });
});

afterAll(async () => {
  await cleanupAuthoring();
});

describe('游標翻頁不重複、不遺漏（US2 AC9）', () => {
  it('每頁 2 筆走完全部，序列與單頁取回完全相同', async () => {
    const visited = await walkAllPages(2);

    expect(visited).toEqual(expectedOrder);
    expect(new Set(visited).size).toBe(visited.length);
  });

  it('每頁 1 筆（最小頁）同樣不重複不遺漏', async () => {
    expect(await walkAllPages(1)).toEqual(expectedOrder);
  });

  it('排序鍵相同的兩筆以 id ASC 決勝，跨頁邊界不吞不重（FR-034）', async () => {
    // 前三筆時刻各異，第 4／5 筆時刻相同：每頁 4 筆會讓那組平手筆數落在頁邊界上
    const visited = await walkAllPages(4);
    expect(visited).toEqual(expectedOrder);
  });

  it('最後一頁的 nextCursor 為 null，且頁數符合預期', async () => {
    const first = await search({ q: TOKEN, limit: 3 });
    expect(first.items).toHaveLength(3);
    expect(first.nextCursor).not.toBeNull();

    const second = await search({ q: TOKEN, limit: 3, cursor: first.nextCursor! });
    expect(second.items).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
  });

  it('筆數剛好等於一頁時即無下一頁（MUST NOT 回一個指向空頁的游標）', async () => {
    const page = await search({ q: TOKEN, limit: expectedOrder.length });
    expect(page.items.map((n) => n.id)).toEqual(expectedOrder);
    expect(page.nextCursor).toBeNull();
  });

  it('無效游標視為無游標，回第一頁而非錯誤（FR-030）', async () => {
    const page = await search({ q: TOKEN, limit: 2, cursor: '這不是-base64-游標' });
    expect(page.items.map((n) => n.id)).toEqual(expectedOrder.slice(0, 2));
  });
});

describe('草稿作品不進結果與建議（US2 AC6、FR-035）', () => {
  it('搜尋結果不含草稿作品', async () => {
    const visited = await walkAllPages(2);
    expect(visited).not.toContain(draftNovelId);
  });

  it('即時建議不含草稿作品', async () => {
    const suggestions = await suggest({ q: TOKEN });
    expect(suggestions.map((s) => s.id)).not.toContain(draftNovelId);
    expect(suggestions.length).toBeGreaterThan(0);
  });

  it('建議每筆含標題與作者顯示名，上限 8 筆（FR-031）', async () => {
    const suggestions = await suggest({ q: TOKEN });
    expect(suggestions.length).toBeLessThanOrEqual(8);
    for (const item of suggestions) {
      expect(item.title).toBeTruthy();
      expect(item.author).toBeTruthy();
      // 搜尋預算與更新時間是內部實作，MUST NOT 對外曝露（data-model §9）
      expect(Object.keys(item).sort()).toEqual(['author', 'id', 'title']);
    }
  });
});
