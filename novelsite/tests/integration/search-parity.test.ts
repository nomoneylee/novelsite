import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { search } from '@/lib/services/searchService';
import {
  createAuthor,
  createSearchNovel,
  distinctCategoryIds,
  cleanupAuthoring,
  type TestAuthor,
} from '../helpers/authoring';

/**
 * `arch.md` §10.3 案例 15／16 與 SC-005：萬用字元不誤配、大小寫不敏感且**兩軌完全一致**。
 *
 * 本檔在兩軌上跑的是**同一組斷言**（`DATABASE_PROVIDER` 決定實作走 `LIKE` 或 `ILIKE`），
 * 故「兩軌一致」不是靠比對兩份輸出，而是靠同一組期望值在兩軌都成立 ——
 * 前者需要把某一軌的結果存成基準檔，而基準檔會在資料變動時默默過期。
 *
 * **非 ASCII 案例是必要的而非加碼**：純 ASCII 的大小寫測試無法區分
 * 「查詢字串已在服務層轉小寫」與「靠資料庫自己折疊」兩種實作，
 * 而後者在兩軌的行為不同（SQLite 的 `LIKE` 只折疊 ASCII）。
 */

const TOKEN = 'zparity';

let author: TestAuthor;
let categoryId: string;
let percentNovel: string;
let underscoreNovel: string;
let quoteNovel: string;
let accentNovel: string;
const caseNovels: string[] = [];

async function idsOf(q: string): Promise<string[]> {
  const page = await search({ q, limit: 50 });
  return page.items.map((n) => n.id);
}

beforeAll(async () => {
  await cleanupAuthoring();
  author = await createAuthor('parity');
  [categoryId] = await distinctCategoryIds(1);

  const at = (iso: string) => new Date(iso);

  percentNovel = await createSearchNovel({
    authorId: author.id,
    title: `${TOKEN} 100%折扣`,
    categoryId,
    updatedAt: at('2026-07-10T00:00:00.000Z'),
  });
  underscoreNovel = await createSearchNovel({
    authorId: author.id,
    title: `${TOKEN} under_score`,
    categoryId,
    updatedAt: at('2026-07-09T00:00:00.000Z'),
  });
  quoteNovel = await createSearchNovel({
    authorId: author.id,
    title: `${TOKEN} O'Brien 之書`,
    categoryId,
    updatedAt: at('2026-07-08T00:00:00.000Z'),
  });
  accentNovel = await createSearchNovel({
    authorId: author.id,
    title: `${TOKEN} Éclat 之刃`,
    categoryId,
    updatedAt: at('2026-07-07T00:00:00.000Z'),
  });

  // 大小寫案例：三部作品的標題以不同大小寫寫同一個詞，排序鍵刻意分開
  caseNovels.push(
    await createSearchNovel({
      authorId: author.id,
      title: `${TOKEN} JIANYING 甲`,
      categoryId,
      updatedAt: at('2026-07-06T00:00:00.000Z'),
    }),
    await createSearchNovel({
      authorId: author.id,
      title: `${TOKEN} JianYing 乙`,
      categoryId,
      updatedAt: at('2026-07-05T00:00:00.000Z'),
    }),
    await createSearchNovel({
      authorId: author.id,
      title: `${TOKEN} jianying 丙`,
      categoryId,
      updatedAt: at('2026-07-04T00:00:00.000Z'),
    })
  );
});

afterAll(async () => {
  await cleanupAuthoring();
});

describe('萬用字元與引號視為字面字元（案例 15、FR-033、US2 AC3）', () => {
  it('搜 `%` 只命中標題真的含 `%` 者，MUST NOT 命中全部', async () => {
    const ids = await idsOf('%');
    expect(ids).toContain(percentNovel);
    expect(ids).not.toContain(underscoreNovel);
    expect(ids).not.toContain(quoteNovel);
  });

  it('搜 `_` 只命中標題真的含 `_` 者（`_` 未轉義時會匹配任意單一字元）', async () => {
    const ids = await idsOf('_');
    expect(ids).toContain(underscoreNovel);
    expect(ids).not.toContain(percentNovel);
    expect(ids).not.toContain(quoteNovel);
  });

  it('搜含單引號的詞正常回應（參數化查詢，不擲錯亦不誤配）', async () => {
    const ids = await idsOf("o'brien");
    expect(ids).toEqual([quoteNovel]);
  });

  it('含轉義字元的完整詞仍可精確命中', async () => {
    expect(await idsOf('100%折扣')).toEqual([percentNovel]);
    expect(await idsOf('under_score')).toEqual([underscoreNovel]);
  });
});

describe('大小寫不敏感且結果與排序完全一致（案例 16、SC-005）', () => {
  it('`JIAN` 與 `jian` 各查兩次，四次結果的內容與排序完全相同', async () => {
    const runs = await Promise.all([idsOf('JIAN'), idsOf('jian'), idsOf('JIAN'), idsOf('jian')]);

    expect(runs[0]).toEqual(caseNovels); // updatedAt DESC → 甲、乙、丙
    for (const run of runs) {
      expect(run).toEqual(runs[0]);
    }
  });

  it('混合大小寫的查詢詞（`JiAnYiNg`）得到同一組結果', async () => {
    expect(await idsOf('JiAnYiNg')).toEqual(caseNovels);
  });

  it('非 ASCII 的大小寫折疊：`ÉCLAT` 與 `éclat` 結果相同且非空', async () => {
    const upper = await idsOf('ÉCLAT');
    const lower = await idsOf('éclat');

    expect(upper).toEqual([accentNovel]);
    expect(lower).toEqual(upper);
  });
});

describe('極端輸入正常回應（spec Edge Cases）', () => {
  it('超長搜尋詞（≥512 字元）回空結果，不逾時不報錯', async () => {
    const page = await search({ q: '長'.repeat(600) });
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });

  it('全符號搜尋詞回空結果（每一個符號都被當字面字元）', async () => {
    for (const q of ['%%%', '___', '%_%_', '\\\\']) {
      const page = await search({ q });
      expect(page.items).toEqual([]);
    }
  });

  it('查無資料不是錯誤：回空陣列且 nextCursor 為 null', async () => {
    const page = await search({ q: 'zz-絕不存在的關鍵字-zz' });
    expect(page).toEqual({ items: [], nextCursor: null });
  });
});
