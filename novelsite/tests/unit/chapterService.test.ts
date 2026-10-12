import { describe, it, expect } from 'vitest';
import { countWords, sanitizeBody } from '@/lib/services/chapterService';
import { saveChapterDraftSchema } from '@/lib/validation/chapter';
import { MAX_LENGTH } from '@/lib/validation/common';

/**
 * US1 章節正文的處理規則（FR-011 字數、FR-019 淨化與長度上限）。
 *
 * 三者皆為**寫入端**的規則：字數是反正規化計數的來源、控制字元過濾與長度上限是
 * 寫進資料庫之前的最後一道。放在讀取端做等於承認資料庫裡可以躺著髒資料。
 *
 * 控制字元一律以 `String.fromCharCode()` 組出，MUST NOT 直接貼入不可見字元 ——
 * 貼進去的那一刻，後續維護者就看不出這個測試在測什麼，diff 也看不出它有沒有被改掉。
 */

/** 依碼位組出控制字元，供測試明確表達「這裡放的是哪一個字元」 */
const ch = (code: number) => String.fromCharCode(code);

describe('countWords：去除所有空白後的字元數（FR-011）', () => {
  it('中文正文以字元計，空白不計入', () => {
    expect(countWords('一二三四五')).toBe(5);
    expect(countWords('一二 三四\t五')).toBe(5);
  });

  it('換行與段落間的空行不計入', () => {
    expect(countWords('第一段。\n\n第二段。')).toBe('第一段。第二段。'.length);
  });

  it('全空白與空字串皆為 0', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   \n\t\r\n  ')).toBe(0);
  });

  it('Markdown 標記本身計入字數（儲存的是原文，不做轉譯後再數）', () => {
    expect(countWords('**粗體**')).toBe('**粗體**'.length);
  });
});

describe('sanitizeBody：控制字元過濾但保留換行與縮排（FR-019）', () => {
  it('移除 NUL（U+0000）與其餘 C0 控制字元', () => {
    for (const code of [0x00, 0x07, 0x08, 0x0b, 0x0c, 0x0e, 0x1f, 0x7f]) {
      expect(sanitizeBody(`前${ch(code)}後`)).toBe('前後');
    }
  });

  it('保留 \\t、\\n、\\r —— 作者寫好的分段與縮排是內容的一部分', () => {
    for (const code of [0x09, 0x0a, 0x0d]) {
      const input = `前${ch(code)}後`;
      expect(sanitizeBody(input)).toBe(input);
    }
    expect(sanitizeBody('第一段。\r\n第二段。')).toBe('第一段。\r\n第二段。');
  });

  it('乾淨的正文原樣通過（不做 trim、不改動內容）', () => {
    const clean = '  首行有空白\n\n  段落二  ';
    expect(sanitizeBody(clean)).toBe(clean);
  });
});

describe('章節正文長度上限：超過 100,000 字元回欄位錯誤（FR-019）', () => {
  it('恰好 100,000 字元通過', () => {
    const parsed = saveChapterDraftSchema.safeParse({
      chapterId: 'c1',
      title: '第一章',
      bodyMarkdown: '字'.repeat(MAX_LENGTH.chapterBody),
    });
    expect(parsed.success).toBe(true);
  });

  it('100,001 字元被拒，且錯誤落在 bodyMarkdown 欄位（非整筆無名錯誤）', () => {
    const parsed = saveChapterDraftSchema.safeParse({
      chapterId: 'c1',
      title: '第一章',
      bodyMarkdown: '字'.repeat(MAX_LENGTH.chapterBody + 1),
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.some((i) => i.path.join('.') === 'bodyMarkdown')).toBe(true);
  });

  it('空正文被拒（章節不得以空白正文送出）', () => {
    const parsed = saveChapterDraftSchema.safeParse({
      chapterId: 'c1',
      title: '第一章',
      bodyMarkdown: '   ',
    });
    expect(parsed.success).toBe(false);
  });
});
