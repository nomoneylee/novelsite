import { describe, it, expect } from 'vitest';
import {
  reviewInputSchema,
  reviewPatchSchema,
  reviewListQuerySchema,
} from '@/lib/validation/review';
import {
  commentInputSchema,
  commentListQuerySchema,
  authorCommentListQuerySchema,
} from '@/lib/validation/comment';
import { MAX_LENGTH } from '@/lib/validation/common';

/**
 * T053：評論與留言的內容驗證（FR-029、FR-005）
 * ================================================
 * 邊界一律取**四個點**：0（空）、1（下界）、上限、上限 +1。
 * 只測「太長被拒」而不測「恰好上限通過」的話，一個把 `<=` 寫成 `<` 的實作也會全綠，
 * 症狀是使用者寫滿字數卻被退件，而那不會有人回報成 bug。
 *
 * 長度以**字元數**計而非位元組數，故本檔的填充字元刻意取中日文字：
 * 用 ASCII 填充時，一個以位元組計長度的實作也會通過。
 */

/** 填充字元取 U+3042（BMP 內，`String.length` 恰為 1），MUST NOT 用會佔兩個碼元的表情符號 */
const fill = (n: number): string => 'あ'.repeat(n);

const REVIEW_MAX = 1000;
const COMMENT_MAX = 500;

describe('T053：長度上限集中於 MAX_LENGTH（T057、FR-029）', () => {
  it('兩個上限值存在且為契約所訂的 1000 與 500', () => {
    expect(MAX_LENGTH.reviewContent).toBe(REVIEW_MAX);
    expect(MAX_LENGTH.commentContent).toBe(COMMENT_MAX);
  });
});

describe('T053：評論內容 trim 後 1–1000 字', () => {
  const parse = (content: string) => reviewInputSchema.safeParse({ rating: 5, content });

  it.each([1, REVIEW_MAX])('%i 字通過', (n) => {
    expect(parse(fill(n)).success).toBe(true);
  });

  it('0 字（空字串）被拒', () => {
    expect(parse('').success).toBe(false);
  });

  it(`${REVIEW_MAX + 1} 字被拒`, () => {
    expect(parse(fill(REVIEW_MAX + 1)).success).toBe(false);
  });

  it.each(['   ', '\t\t', '\n\n', ' \t\n ', '　　'])(
    '純空白字元 %j 視為空 → 被拒（含全形空白 U+3000）',
    (blank) => {
      expect(parse(blank).success).toBe(false);
    }
  );

  it('長度以 trim 後計：兩側加空白的 1000 字通過，1001 字仍被拒', () => {
    expect(parse(`  ${fill(REVIEW_MAX)}  `).success).toBe(true);
    expect(parse(`  ${fill(REVIEW_MAX + 1)}  `).success).toBe(false);
  });

  it('通過時輸出已 trim —— 存進資料庫的是 trim 後的內容，而非原字串', () => {
    const parsed = parse('  有意見要說  ');
    expect(parsed.success && parsed.data.content).toBe('有意見要說');
  });
});

describe('T053：評分為 1–5 的整數', () => {
  const parse = (rating: unknown) => reviewInputSchema.safeParse({ rating, content: '還可以' });

  it.each([1, 2, 3, 4, 5])('rating=%i 通過', (rating) => {
    expect(parse(rating).success).toBe(true);
  });

  it.each([0, 6, -1, 3.5, '5', null, undefined, NaN])('rating=%p 被拒', (rating) => {
    expect(parse(rating).success).toBe(false);
  });
});

describe('T053：編輯評論的部分更新（PATCH 語意）', () => {
  it('兩個欄位皆可省略，但省略不等於放寬 —— 有給值時仍走同一套規則', () => {
    expect(reviewPatchSchema.safeParse({}).success).toBe(true);
    expect(reviewPatchSchema.safeParse({ rating: 3 }).success).toBe(true);
    expect(reviewPatchSchema.safeParse({ content: fill(REVIEW_MAX) }).success).toBe(true);
    expect(reviewPatchSchema.safeParse({ content: '   ' }).success).toBe(false);
    expect(reviewPatchSchema.safeParse({ content: fill(REVIEW_MAX + 1) }).success).toBe(false);
    expect(reviewPatchSchema.safeParse({ rating: 0 }).success).toBe(false);
  });
});

describe('T053：留言內容 trim 後 1–500 字', () => {
  const parse = (content: string) => commentInputSchema.safeParse({ content });

  it.each([1, COMMENT_MAX])('%i 字通過', (n) => {
    expect(parse(fill(n)).success).toBe(true);
  });

  it('0 字（空字串）被拒', () => {
    expect(parse('').success).toBe(false);
  });

  it(`${COMMENT_MAX + 1} 字被拒`, () => {
    expect(parse(fill(COMMENT_MAX + 1)).success).toBe(false);
  });

  it.each(['   ', '\t\t', '\n\n', ' \t\n ', '　　'])('純空白字元 %j 視為空 → 被拒', (blank) => {
    expect(parse(blank).success).toBe(false);
  });

  it('長度以 trim 後計：兩側加空白的 500 字通過，501 字仍被拒', () => {
    expect(parse(`  ${fill(COMMENT_MAX)}  `).success).toBe(true);
    expect(parse(`  ${fill(COMMENT_MAX + 1)}  `).success).toBe(false);
  });

  it('通過時輸出已 trim', () => {
    const parsed = parse('  這章好看  ');
    expect(parsed.success && parsed.data.content).toBe('這章好看');
  });

  it('評論與留言是兩個不同的上限 —— 501 字的留言被拒，同一段字當評論則通過', () => {
    expect(parse(fill(COMMENT_MAX + 1)).success).toBe(false);
    expect(reviewInputSchema.safeParse({ rating: 4, content: fill(COMMENT_MAX + 1) }).success).toBe(
      true
    );
  });

  it('parentId 可省略；給了就不得為空字串（空字串會被誤讀為「頂層留言」）', () => {
    expect(commentInputSchema.safeParse({ content: '回覆' }).success).toBe(true);
    expect(commentInputSchema.safeParse({ content: '回覆', parentId: 'c1' }).success).toBe(true);
    expect(commentInputSchema.safeParse({ content: '回覆', parentId: '' }).success).toBe(false);
  });
});

describe('T053：列表查詢字串（FR-005）', () => {
  it.each(['hot', 'latest'])('評論列表 sort=%s 通過', (sort) => {
    expect(reviewListQuerySchema.safeParse({ sort }).success).toBe(true);
  });

  it.each(['best', '', ' hot', 'HOT'])('評論列表 sort=%j 被拒', (sort) => {
    expect(reviewListQuerySchema.safeParse({ sort }).success).toBe(false);
  });

  it('sort 省略時預設 hot', () => {
    const parsed = reviewListQuerySchema.safeParse({});
    expect(parsed.success && parsed.data.sort).toBe('hot');
  });

  /**
   * 三個列表共用同一套 `limit` 規則。以小型轉接器攤平後再逐一驗，
   * 而不是把三個 schema 直接丟進 `it.each` —— 三者的推導型別不同，
   * 直接丟進去只是把測試寫成一則型別謎題。
   */
  const limitParsers: [
    string,
    (input: Record<string, string>) => { ok: boolean; limit?: number },
  ][] = [
    [
      '評論列表',
      (input) => {
        const p = reviewListQuerySchema.safeParse(input);
        return { ok: p.success, limit: p.success ? p.data.limit : undefined };
      },
    ],
    [
      '章節留言列表',
      (input) => {
        const p = commentListQuerySchema.safeParse(input);
        return { ok: p.success, limit: p.success ? p.data.limit : undefined };
      },
    ],
    [
      '作者留言管理',
      (input) => {
        const p = authorCommentListQuerySchema.safeParse(input);
        return { ok: p.success, limit: p.success ? p.data.limit : undefined };
      },
    ],
  ];

  it.each(limitParsers)(
    '%s 的 limit：1–20 通過、越界與非整數被拒、省略時預設 20',
    (_label, parse) => {
      for (const limit of ['1', '20']) {
        expect(parse({ limit }).ok, `limit=${limit} 應通過`).toBe(true);
      }
      for (const limit of ['0', '21', '-1', 'abc', '1.5', '', '100000']) {
        expect(parse({ limit }).ok, `limit=${limit} 應被拒`).toBe(false);
      }
      expect(parse({}).limit).toBe(20);
    }
  );

  it('作者留言管理的 novelId 與 hidden 兩個篩選 MUST 同時具備（T059）', () => {
    expect(authorCommentListQuerySchema.safeParse({}).success).toBe(true);
    expect(authorCommentListQuerySchema.safeParse({ novelId: 'n1' }).success).toBe(true);
    expect(authorCommentListQuerySchema.safeParse({ hidden: 'true' }).success).toBe(true);
    expect(authorCommentListQuerySchema.safeParse({ novelId: 'n1', hidden: 'false' }).success).toBe(
      true
    );
  });

  it.each(['yes', '1', '', 'True'])('hidden=%j 被拒（只接受 true／false 字面值）', (hidden) => {
    expect(authorCommentListQuerySchema.safeParse({ hidden }).success).toBe(false);
  });

  it('novelId 空字串被拒 —— `?novelId=` 會被誤讀為「不篩選」', () => {
    expect(authorCommentListQuerySchema.safeParse({ novelId: '' }).success).toBe(false);
  });
});
