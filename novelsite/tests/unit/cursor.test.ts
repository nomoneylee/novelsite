import { describe, expect, it } from 'vitest';
import { encodeCursor, decodeCursor } from '@/lib/pagination/cursor';

/**
 * 複合游標的編解碼（T007，contracts/internal-modules.md §3）
 * ==========================================================
 * 兩件事要守住：
 *  1. **往返**：主鍵無論是字串、數值或 `Date`，解回來都是可直接放進 where 條件的字串。
 *  2. **無效輸入回 `null` 而非擲出**：游標來自查詢字串，是使用者可控的輸入。
 *     擲出未捕捉的例外會讓 `?cursor=%%%` 變成 500，而它該是 400（FR-005）。
 */

/** 編碼前的明文分隔符（與實作一致，供「刻意做出壞游標」的案例使用） */
const SEP = '\u0000';

function rawCursor(plain: string): string {
  return Buffer.from(plain, 'utf8').toString('base64url');
}

describe('encodeCursor / decodeCursor', () => {
  it('字串主鍵往返後不變', () => {
    const raw = encodeCursor('2026-08-07T00:00:00.000Z', 'novel-1');
    expect(decodeCursor(raw)).toEqual({ primary: '2026-08-07T00:00:00.000Z', id: 'novel-1' });
  });

  it('數值主鍵往返後為其十進位字串（讚數排序用）', () => {
    const raw = encodeCursor(42, 'review-1');
    expect(decodeCursor(raw)).toEqual({ primary: '42', id: 'review-1' });
  });

  it('Date 主鍵往返後為 ISO 8601 字串（毫秒不遺失）', () => {
    const at = new Date('2026-08-07T12:34:56.789Z');
    const raw = encodeCursor(at, 'history-1');
    const decoded = decodeCursor(raw);
    expect(decoded).toEqual({ primary: '2026-08-07T12:34:56.789Z', id: 'history-1' });
    // 還原成 Date 後與原值同一時刻 —— 呼叫端就是這樣用它的
    expect(new Date(decoded!.primary).getTime()).toBe(at.getTime());
  });

  it('編碼結果為 base64url 字元集，可直接放進查詢字串而不必再轉義', () => {
    const raw = encodeCursor(new Date('2026-08-07T00:00:00.000Z'), 'novel-1');
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('非法 base64 回 null', () => {
    expect(decodeCursor('!!!not-base64!!!')).toBeNull();
    expect(decodeCursor('有中文的游標')).toBeNull();
  });

  it('空字串回 null', () => {
    expect(decodeCursor('')).toBeNull();
  });

  it('缺分隔符回 null（合法 base64url，但內容不是複合游標）', () => {
    expect(decodeCursor(rawCursor('只有主鍵沒有識別碼'))).toBeNull();
  });

  it('主鍵或識別碼任一為空回 null（半截游標 MUST NOT 被當成有效輸入）', () => {
    expect(decodeCursor(rawCursor(`42${SEP}`))).toBeNull();
    expect(decodeCursor(rawCursor(`${SEP}review-1`))).toBeNull();
  });
});
