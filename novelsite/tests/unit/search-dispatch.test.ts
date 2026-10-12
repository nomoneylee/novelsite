import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 搜尋的三個純粹判斷（`arch.md` §10.2、FR-027／FR-031／FR-032／FR-034）：
 *
 *  1. **provider dispatch**：SQLite 走 `LIKE`、PostgreSQL 走 `ILIKE`，其餘一字不差。
 *  2. **短路**：空查詢與未達 2 字元的建議，MUST **完全不呼叫資料存取層**
 *     —— 「回空陣列」與「查了之後沒結果」在畫面上一模一樣，只有呼叫次數分得出來。
 *  3. **正規化**：查詢字串於服務層轉小寫後才交給資料存取層（FR-034／SC-005）。
 *
 * 資料存取層以 `vi.mock` 換成間諜，本檔因而**不需要資料庫**；
 * 真實 SQL 的行為由 `tests/integration/search-*.test.ts` 在兩軌上驗證。
 */

vi.mock('@/lib/repositories', () => ({
  searchNovelIds: vi.fn(async () => ({ rows: [], hasMore: false })),
  suggestNovels: vi.fn(async () => []),
  getNovelsByIds: vi.fn(async () => []),
}));

const { searchNovelIds, suggestNovels } = await import('@/lib/repositories');
const { search, suggest, normalize, buildSearchText, SUGGEST_MIN_CHARS, SUGGEST_LIMIT } =
  await import('@/lib/services/searchService');
const { buildSearchSql, DEFAULT_SEARCH_LIMIT } = await import('@/lib/repositories/search');

beforeEach(() => {
  vi.mocked(searchNovelIds).mockClear();
  vi.mocked(suggestNovels).mockClear();
});

describe('provider dispatch：唯一的雙軌分歧點（research R-1）', () => {
  const pattern = '%劍%';
  const opts = { take: 21 };

  it('SQLite 用 LIKE、PostgreSQL 用 ILIKE，兩者皆附 ESCAPE', () => {
    const sqlite = buildSearchSql('sqlite', pattern, opts).sql;
    const postgres = buildSearchSql('postgresql', pattern, opts).sql;

    expect(sqlite).toContain(' LIKE ');
    expect(sqlite).not.toContain(' ILIKE ');
    expect(postgres).toContain(' ILIKE ');

    // ESCAPE 子句缺席時，轉義過的 `\%` 會被當成兩個模式字元（FR-033）
    expect(sqlite).toContain("ESCAPE '\\'");
    expect(postgres).toContain("ESCAPE '\\'");
  });

  it('兩軌的佔位符依 driver 慣例產生（SQLite `?`／PostgreSQL `$n`）', () => {
    expect(buildSearchSql('sqlite', pattern, opts).sql).toContain('?');
    expect(buildSearchSql('sqlite', pattern, opts).sql).not.toContain('$1');
    expect(buildSearchSql('postgresql', pattern, opts).sql).toContain('$1');
  });

  it('兩軌皆只收已發佈作品（FR-035）', () => {
    for (const provider of ['sqlite', 'postgresql'] as const) {
      expect(buildSearchSql(provider, pattern, opts).sql).toContain('"status" = \'published\'');
    }
  });

  it('兩軌的排序鍵完全相同：updatedAt DESC, id ASC（FR-034、SC-005）', () => {
    for (const provider of ['sqlite', 'postgresql'] as const) {
      expect(buildSearchSql(provider, pattern, opts).sql).toContain(
        'ORDER BY "updatedAt" DESC, "id" ASC'
      );
    }
  });

  it('比對值一律走參數，MUST NOT 出現在 SQL 字面上', () => {
    for (const provider of ['sqlite', 'postgresql'] as const) {
      const built = buildSearchSql(provider, pattern, opts);
      expect(built.sql).not.toContain(pattern);
      expect(built.params[0]).toBe(pattern);
    }
  });

  it('分類與游標為選用條件，未帶時不出現於 SQL', () => {
    const plain = buildSearchSql('sqlite', pattern, opts);
    expect(plain.sql).not.toContain('categoryId');
    expect(plain.params).toHaveLength(2); // pattern + LIMIT

    const filtered = buildSearchSql('sqlite', pattern, {
      ...opts,
      categoryId: 'cat-1',
      cursor: { updatedAt: new Date('2026-07-01T00:00:00.000Z'), id: 'n-9' },
    });
    expect(filtered.sql).toContain('"categoryId" =');
    // 游標為 (updatedAt, id) 的複合比較，MUST NOT 退化為只比時間（同秒的兩筆會漏掉或重複）
    expect(filtered.sql).toContain('"updatedAt" <');
    expect(filtered.sql).toContain('"id" >');
    expect(filtered.params).toContain('cat-1');
    expect(filtered.params).toContain('n-9');
  });

  it('預設每頁筆數為 20（`arch.md` §5.1）', () => {
    expect(DEFAULT_SEARCH_LIMIT).toBe(20);
  });
});

describe('短路：空查詢 MUST NOT 觸發任何資料存取（FR-032、SC-004）', () => {
  it('空字串回空結果且不呼叫資料存取層', async () => {
    await expect(search({ q: '' })).resolves.toEqual({ items: [], nextCursor: null });
    expect(searchNovelIds).not.toHaveBeenCalled();
  });

  it('純空白（含全形空白與換行）同樣短路', async () => {
    for (const blank of ['   ', '\n\t', '　']) {
      await expect(search({ q: blank })).resolves.toEqual({ items: [], nextCursor: null });
    }
    expect(searchNovelIds).not.toHaveBeenCalled();
  });

  it('未帶 q 時亦短路（參數缺席與空字串同義）', async () => {
    await expect(search({})).resolves.toEqual({ items: [], nextCursor: null });
    expect(searchNovelIds).not.toHaveBeenCalled();
  });

  it('只帶分類（q 為空）時 MUST 仍然查詢 —— 分類篩選可單獨成立（FR-030b、US2 AC10）', async () => {
    await search({ q: '', category: 'cat-1' });
    expect(searchNovelIds).toHaveBeenCalledTimes(1);
    expect(vi.mocked(searchNovelIds).mock.calls[0][1]).toMatchObject({ categoryId: 'cat-1' });
  });
});

describe('短路：建議模式的觸發長度（FR-031、US2 AC5）', () => {
  it('觸發長度為 2 字元、上限 8 筆', () => {
    expect(SUGGEST_MIN_CHARS).toBe(2);
    expect(SUGGEST_LIMIT).toBe(8);
  });

  it('trim 後僅 1 字元 → 回空且不發查詢', async () => {
    await expect(suggest({ q: '劍' })).resolves.toEqual([]);
    await expect(suggest({ q: ' 劍 ' })).resolves.toEqual([]);
    expect(suggestNovels).not.toHaveBeenCalled();
  });

  it('達 2 字元 → 發出查詢，且筆數上限為 8', async () => {
    await suggest({ q: '劍影' });
    expect(suggestNovels).toHaveBeenCalledTimes(1);
    expect(vi.mocked(suggestNovels).mock.calls[0]).toEqual(['劍影', SUGGEST_LIMIT]);
  });
});

describe('查詢字串 MUST 於服務層轉小寫後才下傳（FR-034、SC-005）', () => {
  it('一般搜尋：大寫輸入下傳為小寫', async () => {
    await search({ q: 'JIAN' });
    expect(vi.mocked(searchNovelIds).mock.calls[0][0]).toBe('jian');
  });

  it('建議模式：同樣以小寫下傳', async () => {
    await suggest({ q: 'JIAN' });
    expect(vi.mocked(suggestNovels).mock.calls[0][0]).toBe('jian');
  });

  it('非 ASCII 亦於本層折疊，MUST NOT 留給資料庫（兩軌折疊規則不同）', async () => {
    await search({ q: 'ÉCLAT' });
    expect(vi.mocked(searchNovelIds).mock.calls[0][0]).toBe('éclat');
  });

  it('特殊字元不擲錯，原樣（小寫化後）下傳，轉義由資料存取層負責', async () => {
    for (const q of ['100%', 'a_b', "O'Brien", '%%%']) {
      await expect(search({ q })).resolves.toBeDefined();
    }
    expect(vi.mocked(searchNovelIds).mock.calls.map((c) => c[0])).toEqual([
      '100%',
      'a_b',
      "o'brien",
      '%%%',
    ]);
  });
});

describe('normalize：trim → 小寫 → 空白收斂 → 512 截斷（data-model §2.1）', () => {
  it('去除前後空白並轉小寫', () => {
    expect(normalize('  Jian Ying  ')).toBe('jian ying');
  });

  it('連續空白（含換行、Tab、全形空白）收斂為單一半形空白', () => {
    expect(normalize('劍影\n\n行紀')).toBe('劍影 行紀');
    expect(normalize('劍影\t \t行紀')).toBe('劍影 行紀');
    expect(normalize('劍影　　行紀')).toBe('劍影 行紀');
  });

  it('非 ASCII 的大小寫一併折疊（重音拉丁字母）', () => {
    expect(normalize('ÉCLAT Ünter')).toBe('éclat ünter');
  });

  it('截斷至 512 字元', () => {
    expect(normalize('字'.repeat(600))).toHaveLength(512);
    expect(normalize('字'.repeat(512))).toHaveLength(512);
  });

  it('空字串與純空白皆回空字串', () => {
    expect(normalize('')).toBe('');
    expect(normalize('   \n ')).toBe('');
  });
});

describe('buildSearchText：搜尋預算的唯一組裝實作（FR-027、data-model §2.1）', () => {
  it('依序組合 標題 + 作者顯示名 + 分類 + 標籤，並套用 normalize', () => {
    expect(
      buildSearchText({
        title: '劍影行紀',
        author: '墨衍',
        category: '玄幻',
        tags: ['熱血', '成長'],
      })
    ).toBe('劍影行紀 墨衍 玄幻 熱血 成長');
  });

  it('組裝結果為小寫（欄位以小寫落庫，查詢端才可能逐字相符）', () => {
    expect(
      buildSearchText({ title: 'Sword', author: 'INK', category: 'Fantasy', tags: ['Hot'] })
    ).toBe('sword ink fantasy hot');
  });

  it('無標籤時不留下多餘空白', () => {
    expect(buildSearchText({ title: '劍影行紀', author: '墨衍', category: '玄幻', tags: [] })).toBe(
      '劍影行紀 墨衍 玄幻'
    );
  });

  it('超長標籤組合截斷至 512 字元（btree 索引列大小限制，data-model §2.1）', () => {
    const built = buildSearchText({
      title: '長'.repeat(200),
      author: '作'.repeat(200),
      category: '類'.repeat(200),
      tags: ['籤'.repeat(200)],
    });
    expect(built).toHaveLength(512);
  });
});
