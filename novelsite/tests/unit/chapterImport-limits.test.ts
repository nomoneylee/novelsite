import { describe, expect, it } from 'vitest';
import { IMPORT_LIMITS, importChapterRowSchema } from '@/lib/validation/chapterImport';
import {
  gradePreview,
  isValidChapterNumber,
  parseChapterFilename,
  type ParsedChapterFile,
} from '@/lib/chapterImport/parse';
import { MAX_LENGTH } from '@/lib/validation/common';

/**
 * 三項上限與章號範圍（FEAT-7 T008，FR-017／FR-017c／FR-020／FR-021）
 * ==================================================================
 * 上限值本身在 `IMPORT_LIMITS`；**判定**一律在 `gradePreview()`，
 * 故邊界值以「常數本身」與「判定結果」兩面各鎖一次。
 */

function row(overrides: Partial<ParsedChapterFile> & { filename: string }): ParsedChapterFile {
  const named = parseChapterFilename(overrides.filename);
  return {
    relativePath: '',
    byteSize: 100,
    number: named?.number ?? null,
    title: named?.title ?? null,
    body: '正文內容',
    wordCount: 4,
    ...overrides,
  };
}

describe('T008 isValidChapterNumber：章號範圍 1–9999（FR-017c）', () => {
  it('0、負數、非整數皆無效', () => {
    expect(isValidChapterNumber(0)).toBe(false);
    expect(isValidChapterNumber(-1)).toBe(false);
    expect(isValidChapterNumber(1.5)).toBe(false);
  });

  it('下界 1 與上界 9999 有效，10000 無效', () => {
    expect(isValidChapterNumber(1)).toBe(true);
    expect(isValidChapterNumber(9999)).toBe(true);
    expect(isValidChapterNumber(10000)).toBe(false);
  });
});

describe('T008 IMPORT_LIMITS：三項上限的值與邊界判定（FR-017）', () => {
  it('三項數值鎖死', () => {
    expect(IMPORT_LIMITS.maxFiles).toBe(1000);
    expect(IMPORT_LIMITS.maxFileBytes).toBe(1_048_576);
    expect(IMPORT_LIMITS.maxTotalBytes).toBe(52_428_800);
  });

  it('總大小 MUST NOT 由檔案數乘以單檔上限推導（1000 × 1 MB = 1 GB）', () => {
    // 它是獨立的護欄，存在目的正是擋下「每一檔都貼著單檔上限」（FR-017a(c)）
    expect(IMPORT_LIMITS.maxTotalBytes).not.toBe(
      IMPORT_LIMITS.maxFiles * IMPORT_LIMITS.maxFileBytes
    );
  });

  it('單檔 1 MB 通過、1 MB + 1 位元組判為 FILE_TOO_LARGE', () => {
    const atLimit = row({ filename: '第1章_甲.md', byteSize: IMPORT_LIMITS.maxFileBytes });
    const overLimit = row({ filename: '第1章_甲.md', byteSize: IMPORT_LIMITS.maxFileBytes + 1 });

    expect(gradePreview([atLimit], [], 'files').rows[0].verdict).toBe('OK');
    expect(gradePreview([overLimit], [], 'files').rows[0].verdict).toBe('FILE_TOO_LARGE');
  });

  it('檔案數 1000 可送出、1001 不可', () => {
    const files = Array.from({ length: IMPORT_LIMITS.maxFiles + 1 }, (_, i) =>
      row({ filename: `第${i + 1}章_甲.md` })
    );

    expect(gradePreview(files.slice(0, IMPORT_LIMITS.maxFiles), [], 'files').canSubmit).toBe(true);
    expect(gradePreview(files, [], 'files').canSubmit).toBe(false);
  });

  it('總大小 50 MB 可送出、50 MB + 1 位元組不可', () => {
    const atLimit = Array.from({ length: 50 }, (_, i) =>
      row({ filename: `第${i + 1}章_甲.md`, byteSize: IMPORT_LIMITS.maxFileBytes })
    );
    const overLimit = [...atLimit, row({ filename: '第51章_乙.md', byteSize: 1 })];

    expect(gradePreview(atLimit, [], 'files').summary.totalBytes).toBe(IMPORT_LIMITS.maxTotalBytes);
    expect(gradePreview(atLimit, [], 'files').canSubmit).toBe(true);
    expect(gradePreview(overLimit, [], 'files').summary.totalBytes).toBe(
      IMPORT_LIMITS.maxTotalBytes + 1
    );
    expect(gradePreview(overLimit, [], 'files').canSubmit).toBe(false);
  });
});

describe('T008 importChapterRowSchema：只驗形狀與型別', () => {
  const base = { filename: '第1章_甲.md', number: 1, title: '甲', bodyMarkdown: '正文' };

  it('接受空字串正文（FR-021：空正文是警告不是錯誤）', () => {
    expect(importChapterRowSchema.safeParse({ ...base, bodyMarkdown: '' }).success).toBe(true);
  });

  it('缺 filename 不成立 —— 逐檔錯誤訊息要靠它指名來源檔（FR-019）', () => {
    expect(
      importChapterRowSchema.safeParse({ number: 1, title: '甲', bodyMarkdown: '正文' }).success
    ).toBe(false);
  });

  it('number 非整數不成立', () => {
    expect(importChapterRowSchema.safeParse({ ...base, number: 1.5 }).success).toBe(false);
  });

  it('**長度不在本 schema 判定**：超長標題與超長正文由 gradePreview 產出 verdict', () => {
    // 第五輪 analyze 裁示（2026-08-21）：同一件事有兩份判定時，一份回 Zod issue
    // （手上只有陣列索引 rows[7]）、一份回 verdict（帶 filename），
    // 而先跑的那一份決定作者看到什麼。上限值不變，改的只是「在哪裡判」
    const longTitle = 'あ'.repeat(MAX_LENGTH.chapterTitle + 1);
    const longBody = 'あ'.repeat(MAX_LENGTH.chapterBody + 1);

    expect(importChapterRowSchema.safeParse({ ...base, title: longTitle }).success).toBe(true);
    expect(importChapterRowSchema.safeParse({ ...base, bodyMarkdown: longBody }).success).toBe(
      true
    );

    expect(
      gradePreview([row({ filename: `第1章_${longTitle}.md` })], [], 'files').rows[0].verdict
    ).toBe('TITLE_TOO_LONG');
    expect(
      gradePreview(
        [row({ filename: '第1章_甲.md', body: longBody, wordCount: longBody.length })],
        [],
        'files'
      ).rows[0].verdict
    ).toBe('BODY_TOO_LONG');
  });
});

describe('T044 章號範圍的端到端串接：0 與 10000 於預覽標示為無效章號（FR-017c）', () => {
  /**
   * **與上方 `isValidChapterNumber` 的邊界案不重複**：那一組驗的是判定函式本身，
   * 這一組驗的是「檔名 → 解析 → 分級」整條串起來之後，作者在預覽裡看到的是哪一個代碼。
   * 中間任何一環（`CHAPTER_FILE_RE` 解不出 0、`verdictOf` 把章號判在檔名之前）
   * 都會讓作者看到 `FILENAME_MISMATCH` —— 對一個檔名完全合乎慣例的檔案而言，
   * 那句話會讓他反覆改檔名而永遠改不對。
   */
  it('第0章 與 第10000章 皆判為 INVALID_NUMBER，且整批不可送出', () => {
    for (const filename of ['第0章_序章.md', '第10000章_終章.md']) {
      const preview = gradePreview([row({ filename })], [], 'files');
      expect(preview.rows[0].verdict, filename).toBe('INVALID_NUMBER');
      expect(preview.summary.errors, filename).toBe(1);
      expect(preview.canSubmit, filename).toBe(false);
    }
  });

  it('下界 1 與上界 9999 照常可匯入 —— 邊界本身 MUST NOT 被誤擋', () => {
    const preview = gradePreview(
      [row({ filename: '第1章_起.md' }), row({ filename: '第9999章_終.md' })],
      [],
      'files'
    );
    expect(preview.rows.map((r) => r.verdict)).toEqual(['OK', 'OK']);
    expect(preview.canSubmit).toBe(true);
  });
});
