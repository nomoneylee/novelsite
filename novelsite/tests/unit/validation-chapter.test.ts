import { describe, it, expect } from 'vitest';
import {
  createVolumeSchema,
  updateVolumeSchema,
  createChapterSchema,
  saveChapterDraftSchema,
  setChapterStatusSchema,
  reorderChaptersSchema,
} from '@/lib/validation/chapter';
import { MAX_LENGTH } from '@/lib/validation/common';

/**
 * 卷與章節欄位的驗證規則（FR-006a、FR-003b、data-model.md §7）。
 *
 * 特別注意兩處「入參 MUST NOT 存在」的斷言：卷編號與章節編號皆由系統指派
 * （FR-003a／FR-003d），schema 若放行作者傳入的編號，唯一約束就會變成使用者可觸發的
 * 500，而不是系統自己保證的不變式。
 */

describe('createVolumeSchema：建立卷（FR-003d）', () => {
  it('合法輸入通過', () => {
    expect(createVolumeSchema.safeParse({ novelId: 'n1', title: '第一卷' }).success).toBe(true);
  });

  it('標題非空且 trim 後計算長度', () => {
    expect(createVolumeSchema.safeParse({ novelId: 'n1', title: '  ' }).success).toBe(false);
    expect(
      createVolumeSchema.safeParse({ novelId: 'n1', title: '卷'.repeat(MAX_LENGTH.volumeTitle) })
        .success
    ).toBe(true);
    expect(
      createVolumeSchema.safeParse({
        novelId: 'n1',
        title: '卷'.repeat(MAX_LENGTH.volumeTitle + 1),
      }).success
    ).toBe(false);
  });

  it('MUST NOT 接受作者傳入的卷編號 —— 編號由系統指派（FR-003d）', () => {
    const parsed = createVolumeSchema.safeParse({ novelId: 'n1', title: '第一卷', number: 99 });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect('number' in parsed.data).toBe(false);
  });
});

describe('updateVolumeSchema：更新卷（只能改標題）', () => {
  it('合法輸入通過', () => {
    expect(updateVolumeSchema.safeParse({ volumeId: 'v1', title: '新卷名' }).success).toBe(true);
  });

  it('標題必填非空', () => {
    expect(updateVolumeSchema.safeParse({ volumeId: 'v1', title: '' }).success).toBe(false);
  });

  it('MUST NOT 接受 number —— 卷編號不可編輯（data-model §3）', () => {
    const parsed = updateVolumeSchema.safeParse({ volumeId: 'v1', title: '新卷名', number: 2 });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect('number' in parsed.data).toBe(false);
  });
});

describe('createChapterSchema：建立空白草稿章節（FR-003a）', () => {
  it('novelId 與 volumeId 皆必填', () => {
    expect(createChapterSchema.safeParse({ novelId: 'n1', volumeId: 'v1' }).success).toBe(true);
    expect(createChapterSchema.safeParse({ novelId: 'n1' }).success).toBe(false);
    expect(createChapterSchema.safeParse({ novelId: '', volumeId: 'v1' }).success).toBe(false);
  });

  it('MUST NOT 接受作者傳入的章節編號（FR-003a）', () => {
    const parsed = createChapterSchema.safeParse({ novelId: 'n1', volumeId: 'v1', number: 7 });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect('number' in parsed.data).toBe(false);
  });
});

describe('saveChapterDraftSchema：儲存章節（FR-006a、FR-019）', () => {
  const valid = { chapterId: 'c1', title: '第一章', bodyMarkdown: '正文。' };

  it('合法輸入通過', () => {
    expect(saveChapterDraftSchema.safeParse(valid).success).toBe(true);
  });

  it('章節標題非空且不得超過上限', () => {
    expect(saveChapterDraftSchema.safeParse({ ...valid, title: '  ' }).success).toBe(false);
    expect(
      saveChapterDraftSchema.safeParse({
        ...valid,
        title: '字'.repeat(MAX_LENGTH.chapterTitle),
      }).success
    ).toBe(true);
    expect(
      saveChapterDraftSchema.safeParse({
        ...valid,
        title: '字'.repeat(MAX_LENGTH.chapterTitle + 1),
      }).success
    ).toBe(false);
  });

  it('MUST NOT 接受 status —— 儲存草稿不改變發佈狀態（contracts §2）', () => {
    const parsed = saveChapterDraftSchema.safeParse({ ...valid, status: 'published' });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect('status' in parsed.data).toBe(false);
  });
});

describe('setChapterStatusSchema：發佈／下架（FR-013）', () => {
  it('只接受 draft 與 published', () => {
    expect(setChapterStatusSchema.safeParse({ chapterId: 'c1', status: 'draft' }).success).toBe(
      true
    );
    expect(setChapterStatusSchema.safeParse({ chapterId: 'c1', status: 'published' }).success).toBe(
      true
    );
    expect(setChapterStatusSchema.safeParse({ chapterId: 'c1', status: 'hidden' }).success).toBe(
      false
    );
  });
});

describe('reorderChaptersSchema：卷內排序（FR-003b）', () => {
  it('合法清單通過', () => {
    expect(
      reorderChaptersSchema.safeParse({ volumeId: 'v1', orderedChapterIds: ['c1', 'c2'] }).success
    ).toBe(true);
  });

  it('空清單被拒（沒有章節可排時前端不該送出）', () => {
    expect(reorderChaptersSchema.safeParse({ volumeId: 'v1', orderedChapterIds: [] }).success).toBe(
      false
    );
  });

  it('清單內重複的識別碼在形狀層即被拒（集合相等的其餘部分由服務層核對）', () => {
    expect(
      reorderChaptersSchema.safeParse({ volumeId: 'v1', orderedChapterIds: ['c1', 'c1'] }).success
    ).toBe(false);
  });

  it('非字串陣列被拒', () => {
    expect(
      reorderChaptersSchema.safeParse({ volumeId: 'v1', orderedChapterIds: 'c1' }).success
    ).toBe(false);
    expect(
      reorderChaptersSchema.safeParse({ volumeId: 'v1', orderedChapterIds: ['c1', ''] }).success
    ).toBe(false);
  });
});
