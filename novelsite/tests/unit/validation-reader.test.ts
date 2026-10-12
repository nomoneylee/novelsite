import { describe, it, expect } from 'vitest';
import {
  progressReportSchema,
  readerPreferenceSchema,
  listQuerySchema,
  historyDeleteQuerySchema,
  makeMergePayloadSchema,
} from '@/lib/validation/reader';
import { encodeCursor } from '@/lib/pagination/cursor';

/**
 * T015：讀者狀態的入參驗證（FR-005）
 * ====================================
 * 含**列表查詢字串** —— `limit` 未驗時 `?limit=100000` 就是一次全表掃描，
 * 而 400 是比逾時更好的失敗方式。
 */

describe('T015：percent（0–100 整數）', () => {
  it.each([0, 1, 50, 100])('%p 通過', (percent) => {
    const parsed = progressReportSchema.safeParse({ novelId: 'n1', chapterId: 'c1', percent });
    expect(parsed.success).toBe(true);
  });

  it.each([101, -1, 3.5, '80', null, undefined, NaN])('%p 被拒', (percent) => {
    const parsed = progressReportSchema.safeParse({ novelId: 'n1', chapterId: 'c1', percent });
    expect(parsed.success).toBe(false);
  });

  it('缺 novelId 或 chapterId 一律被拒（識別碼由客戶端提供，MUST 驗）', () => {
    expect(progressReportSchema.safeParse({ chapterId: 'c1', percent: 1 }).success).toBe(false);
    expect(progressReportSchema.safeParse({ novelId: 'n1', percent: 1 }).success).toBe(false);
    expect(
      progressReportSchema.safeParse({ novelId: '', chapterId: 'c1', percent: 1 }).success
    ).toBe(false);
  });
});

describe('T015：fontSize 與 theme 的值域（FR-014）', () => {
  it.each(['sm', 'md', 'lg'])('fontSize=%s 通過', (fontSize) => {
    expect(readerPreferenceSchema.safeParse({ fontSize }).success).toBe(true);
  });

  it.each(['light', 'dark', 'eyecare'])('theme=%s 通過', (theme) => {
    expect(readerPreferenceSchema.safeParse({ theme }).success).toBe(true);
  });

  it.each(['xl', 'XS', '', 'medium'])('fontSize=%p 被拒', (fontSize) => {
    expect(readerPreferenceSchema.safeParse({ fontSize }).success).toBe(false);
  });

  it.each(['sepia', 'night', ''])('theme=%p 被拒', (theme) => {
    expect(readerPreferenceSchema.safeParse({ theme }).success).toBe(false);
  });

  it('兩者皆可省略（PATCH 語意），但 lineHeight 等未定義欄位不得挾帶進來', () => {
    expect(readerPreferenceSchema.safeParse({}).success).toBe(true);
    const parsed = readerPreferenceSchema.safeParse({ fontSize: 'lg', lineHeight: 2 });
    expect(parsed.success && 'lineHeight' in parsed.data).toBe(false);
  });
});

describe('T015：列表查詢字串（limit 1–20、cursor 必為可解游標）', () => {
  it.each([1, 20])('limit=%p 通過', (limit) => {
    expect(listQuerySchema.safeParse({ limit: String(limit) }).success).toBe(true);
  });

  it.each(['0', '21', '-1', 'abc', '1.5', ''])('limit=%p 被拒', (limit) => {
    expect(listQuerySchema.safeParse({ limit }).success).toBe(false);
  });

  it('limit 省略時預設 20', () => {
    const parsed = listQuerySchema.safeParse({});
    expect(parsed.success && parsed.data.limit).toBe(20);
  });

  it('合法游標通過並原樣保留', () => {
    const cursor = encodeCursor(new Date('2026-08-01T00:00:00.000Z'), 'abc');
    const parsed = listQuerySchema.safeParse({ cursor });
    expect(parsed.success && parsed.data.cursor).toBe(cursor);
  });

  it.each(['!!!', 'not base64', 'YWJj'])(
    '無效游標 %p 被拒（呼叫端轉 400，MUST NOT 擲錯）',
    (cursor) => {
      expect(() => listQuerySchema.safeParse({ cursor })).not.toThrow();
      expect(listQuerySchema.safeParse({ cursor }).success).toBe(false);
    }
  );
});

describe('T015：DELETE /api/history 的可選 novelId', () => {
  it('省略 → 通過（語意為清空全部）', () => {
    const parsed = historyDeleteQuerySchema.safeParse({});
    expect(parsed.success && parsed.data.novelId).toBeUndefined();
  });

  it('給值 → 通過；空字串 → 被拒（空字串會被誤讀為「清空全部」）', () => {
    expect(historyDeleteQuerySchema.safeParse({ novelId: 'n1' }).success).toBe(true);
    expect(historyDeleteQuerySchema.safeParse({ novelId: '' }).success).toBe(false);
  });
});

describe('T015：合併酬載長度上限', () => {
  const schema = makeMergePayloadSchema(200);
  const entry = (i: number) => ({
    novelId: `n-${i}`,
    chapterId: `c-${i}`,
    readAt: '2026-08-01T00:00:00.000Z',
  });

  it('恰好 200 筆通過', () => {
    const parsed = schema.safeParse({
      bookshelf: Array.from({ length: 200 }, (_, i) => `n-${i}`),
      history: Array.from({ length: 200 }, (_, i) => entry(i)),
    });
    expect(parsed.success).toBe(true);
  });

  it('書架 201 筆被拒', () => {
    expect(
      schema.safeParse({
        bookshelf: Array.from({ length: 201 }, (_, i) => `n-${i}`),
        history: [],
      }).success
    ).toBe(false);
  });

  it('歷史 201 筆被拒', () => {
    expect(
      schema.safeParse({
        bookshelf: [],
        history: Array.from({ length: 201 }, (_, i) => entry(i)),
      }).success
    ).toBe(false);
  });

  it('歷史項目的 readAt MUST 為可解析的時間字串', () => {
    expect(
      schema.safeParse({
        bookshelf: [],
        history: [{ novelId: 'n', chapterId: 'c', readAt: 'yesterday' }],
      }).success
    ).toBe(false);
  });

  it('偏好與截斷旗標皆為可選', () => {
    expect(schema.safeParse({ bookshelf: [], history: [] }).success).toBe(true);
    expect(
      schema.safeParse({
        bookshelf: [],
        history: [],
        preference: { fontSize: 'lg' },
        truncated: { bookshelf: true },
      }).success
    ).toBe(true);
  });

  it('上限可調（設定值來自 env，MUST NOT 在 schema 內硬編）', () => {
    const tight = makeMergePayloadSchema(1);
    expect(tight.safeParse({ bookshelf: ['a'], history: [] }).success).toBe(true);
    expect(tight.safeParse({ bookshelf: ['a', 'b'], history: [] }).success).toBe(false);
  });
});
