import { describe, it, expect } from 'vitest';
import {
  COVER_COLORS,
  createNovelSchema,
  updateNovelSchema,
  setNovelStatusSchema,
} from '@/lib/validation/novel';
import { MAX_LENGTH } from '@/lib/validation/common';

/**
 * 作品欄位的長度上限與必填規則（FR-006a、FR-012c、data-model.md §7）。
 *
 * 上限一律以 `MAX_LENGTH` 常數表達，MUST NOT 在測試裡另寫字面量 ——
 * 測試寫死 100 而實作改成 120 時，測試會繼續通過並掩蓋漂移。
 */

const validCreate = {
  title: '劍影行紀',
  categoryId: 'cat-xuanhuan',
  excerpt: '一個關於劍與影的故事。',
};

describe('createNovelSchema：建立作品（FR-006a）', () => {
  it('合法輸入通過', () => {
    expect(createNovelSchema.safeParse(validCreate).success).toBe(true);
  });

  it('標題非空且 trim 後計算長度', () => {
    expect(createNovelSchema.safeParse({ ...validCreate, title: '   ' }).success).toBe(false);
    expect(
      createNovelSchema.safeParse({
        ...validCreate,
        title: ` ${'字'.repeat(MAX_LENGTH.novelTitle)} `,
      }).success
    ).toBe(true);
    expect(
      createNovelSchema.safeParse({
        ...validCreate,
        title: '字'.repeat(MAX_LENGTH.novelTitle + 1),
      }).success
    ).toBe(false);
  });

  it('簡介非空且不得超過上限', () => {
    expect(createNovelSchema.safeParse({ ...validCreate, excerpt: '' }).success).toBe(false);
    expect(
      createNovelSchema.safeParse({
        ...validCreate,
        excerpt: '字'.repeat(MAX_LENGTH.novelExcerpt),
      }).success
    ).toBe(true);
    expect(
      createNovelSchema.safeParse({
        ...validCreate,
        excerpt: '字'.repeat(MAX_LENGTH.novelExcerpt + 1),
      }).success
    ).toBe(false);
  });

  it('categoryId 必填非空', () => {
    expect(createNovelSchema.safeParse({ ...validCreate, categoryId: '' }).success).toBe(false);
  });

  it('入參 MUST NOT 接受 coverColor —— 建立時由系統指派（FR-012）', () => {
    const parsed = createNovelSchema.safeParse({
      ...validCreate,
      coverColor: COVER_COLORS[0],
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect('coverColor' in parsed.data).toBe(false);
  });

  it('錯誤訊息落在對應欄位，供表單逐欄顯示', () => {
    const parsed = createNovelSchema.safeParse({ ...validCreate, title: '' });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.some((i) => i.path.join('.') === 'title')).toBe(true);
  });
});

describe('updateNovelSchema：更新作品（FR-012c）', () => {
  it('只帶 novelId 即為合法（各欄位皆選填）', () => {
    expect(updateNovelSchema.safeParse({ novelId: 'n1' }).success).toBe(true);
  });

  it('帶入的欄位仍受各自上限約束', () => {
    expect(
      updateNovelSchema.safeParse({ novelId: 'n1', title: '字'.repeat(MAX_LENGTH.novelTitle + 1) })
        .success
    ).toBe(false);
    expect(
      updateNovelSchema.safeParse({
        novelId: 'n1',
        description: '字'.repeat(MAX_LENGTH.novelExcerpt + 1),
      }).success
    ).toBe(false);
  });

  it('description 選填且空字串合法（作者可以清空長版簡介）', () => {
    expect(updateNovelSchema.safeParse({ novelId: 'n1', description: '' }).success).toBe(true);
  });

  it('tagIds 為字串陣列；空陣列合法（清除全部標籤）', () => {
    expect(updateNovelSchema.safeParse({ novelId: 'n1', tagIds: [] }).success).toBe(true);
    expect(updateNovelSchema.safeParse({ novelId: 'n1', tagIds: ['t1', 't2'] }).success).toBe(true);
    expect(updateNovelSchema.safeParse({ novelId: 'n1', tagIds: 't1' }).success).toBe(false);
    expect(updateNovelSchema.safeParse({ novelId: 'n1', tagIds: [''] }).success).toBe(false);
  });

  it('coverColor 只接受既有色票組之一（白名單，非任意 CSS）', () => {
    expect(
      updateNovelSchema.safeParse({ novelId: 'n1', coverColor: COVER_COLORS[0] }).success
    ).toBe(true);
    expect(
      updateNovelSchema.safeParse({ novelId: 'n1', coverColor: 'red; background:url(x)' }).success
    ).toBe(false);
  });

  it('serialStatus 只接受三種連載狀態', () => {
    for (const status of ['ongoing', 'completed', 'hiatus']) {
      expect(updateNovelSchema.safeParse({ novelId: 'n1', serialStatus: status }).success).toBe(
        true
      );
    }
    expect(updateNovelSchema.safeParse({ novelId: 'n1', serialStatus: 'draft' }).success).toBe(
      false
    );
  });
});

describe('setNovelStatusSchema：上架／下架（FR-012）', () => {
  it('只接受 draft 與 published', () => {
    expect(setNovelStatusSchema.safeParse({ novelId: 'n1', status: 'draft' }).success).toBe(true);
    expect(setNovelStatusSchema.safeParse({ novelId: 'n1', status: 'published' }).success).toBe(
      true
    );
    expect(setNovelStatusSchema.safeParse({ novelId: 'n1', status: 'hiatus' }).success).toBe(false);
  });
});

describe('COVER_COLORS：系統指派的色票組', () => {
  it('非空且每一項皆為非空字串', () => {
    expect(COVER_COLORS.length).toBeGreaterThan(0);
    for (const color of COVER_COLORS) {
      expect(typeof color).toBe('string');
      expect(color.length).toBeGreaterThan(0);
    }
  });
});
