import { describe, expect, it } from 'vitest';
import { BATCH_LIMITS, batchChapterIdsSchema } from '@/lib/validation/chapterBatch';

/**
 * 批次操作的上限與去重（FEAT-8 T006，FR-005、contracts/internal-modules.md §3）
 * ============================================================================
 * **去重 MUST 發生在數量驗證之前**。順序反過來不會有型別錯誤，
 * 症狀是「重複 id 撐爆上限」與「`chapterCount` 與實際影響列數對不上」——
 * 後者會被誤讀成「被排程搶先發佈」（FR-010a）。
 */

/** 產生 n 個互不相同的章節識別碼 */
function ids(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `ch_${i + 1}`);
}

describe('T006 BATCH_LIMITS：上限值鎖死', () => {
  it('maxChapters 為 1000', () => {
    expect(BATCH_LIMITS.maxChapters).toBe(1000);
  });
});

describe('T006 batchChapterIdsSchema：去重先於數量驗證', () => {
  it('`[a, a, b]` 解析後為 2 筆', () => {
    const parsed = batchChapterIdsSchema.parse({
      volumeId: 'vol_1',
      chapterIds: ['ch_a', 'ch_a', 'ch_b'],
    });
    expect(parsed.chapterIds).toEqual(['ch_a', 'ch_b']);
  });

  it('1001 筆**重複值**去重後只剩 1 筆，MUST 通過（不得被判超限）', () => {
    // 先驗數量再去重的寫法會在這裡把「實際只有一章」判成超限
    const parsed = batchChapterIdsSchema.parse({
      volumeId: 'vol_1',
      chapterIds: Array.from({ length: 1001 }, () => 'ch_same'),
    });
    expect(parsed.chapterIds).toEqual(['ch_same']);
  });

  it('去重後保留首次出現的順序', () => {
    const parsed = batchChapterIdsSchema.parse({
      volumeId: 'vol_1',
      chapterIds: ['ch_c', 'ch_a', 'ch_c', 'ch_b'],
    });
    expect(parsed.chapterIds).toEqual(['ch_c', 'ch_a', 'ch_b']);
  });
});

describe('T006 batchChapterIdsSchema：邊界與必填', () => {
  it('空選取被拒', () => {
    const result = batchChapterIdsSchema.safeParse({ volumeId: 'vol_1', chapterIds: [] });
    expect(result.success).toBe(false);
  });

  it('1000 章通過', () => {
    const result = batchChapterIdsSchema.safeParse({ volumeId: 'vol_1', chapterIds: ids(1000) });
    expect(result.success).toBe(true);
  });

  it('1001 章被拒', () => {
    const result = batchChapterIdsSchema.safeParse({ volumeId: 'vol_1', chapterIds: ids(1001) });
    expect(result.success).toBe(false);
  });

  it('volumeId 為空字串或空白時被拒', () => {
    expect(batchChapterIdsSchema.safeParse({ volumeId: '', chapterIds: ids(1) }).success).toBe(
      false
    );
    expect(batchChapterIdsSchema.safeParse({ volumeId: '   ', chapterIds: ids(1) }).success).toBe(
      false
    );
  });
});

describe('T006 超限訊息：MUST 同時含實際值與上限值（FR-005）', () => {
  it('1500 章的訊息同時出現 1500 與 1000', () => {
    // 只說「超過上限」的話，作者不知道要取消勾選幾章才送得出去
    const result = batchChapterIdsSchema.safeParse({ volumeId: 'vol_1', chapterIds: ids(1500) });
    expect(result.success).toBe(false);
    const message = result.error!.issues.map((issue) => issue.message).join('\n');
    expect(message).toContain('1500');
    expect(message).toContain(String(BATCH_LIMITS.maxChapters));
  });

  it('實際值取的是**去重後**的筆數，不是原始陣列長度', () => {
    // 1200 個相異 id ＋ 300 個重複 → 實際是 1200，訊息 MUST NOT 說 1500
    const result = batchChapterIdsSchema.safeParse({
      volumeId: 'vol_1',
      chapterIds: [...ids(1200), ...ids(300)],
    });
    expect(result.success).toBe(false);
    const message = result.error!.issues.map((issue) => issue.message).join('\n');
    expect(message).toContain('1200');
    expect(message).not.toContain('1500');
  });
});
