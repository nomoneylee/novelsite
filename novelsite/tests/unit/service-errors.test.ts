import { describe, it, expect } from 'vitest';
import {
  ServiceError,
  translateDbError,
  isUniqueViolation,
  fieldErrors,
} from '@/lib/services/errors';
import { z } from 'zod';

/**
 * 資料層例外 → 對外錯誤碼的轉譯規則（FR-009）。
 *
 * 這一組刻意以**確定性**的方式驗證：`chapter-number-conflict.test.ts` 只能在真的
 * 撞號時才走到 CONFLICT 分支，而併發會不會重疊取決於資料庫與連線池
 * （PostgreSQL 上兩個請求常常就串行掉了）。轉譯規則本身不該靠運氣才被測到。
 */

/** Prisma 唯一約束衝突的形狀（`code: 'P2002'`） */
const p2002 = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });

describe('isUniqueViolation：只認 P2002', () => {
  it('P2002 為真', () => {
    expect(isUniqueViolation(p2002)).toBe(true);
  });

  it('其他錯誤碼、一般 Error、null 皆為假', () => {
    expect(isUniqueViolation(Object.assign(new Error('x'), { code: 'P2025' }))).toBe(false);
    expect(isUniqueViolation(new Error('x'))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation('P2002')).toBe(false);
  });
});

describe('translateDbError：唯一衝突 → CONFLICT，其餘 → INTERNAL_ERROR（FR-009）', () => {
  it('P2002 轉為 CONFLICT，並帶上呼叫端提供的可理解訊息', () => {
    const err = translateDbError(p2002, '章節編號重複，請重試');
    expect(err).toBeInstanceOf(ServiceError);
    expect(err.code).toBe('CONFLICT');
    expect(err.message).toBe('章節編號重複，請重試');
  });

  it('未預期的例外轉為 INTERNAL_ERROR，且訊息 MUST NOT 洩漏原始內容', () => {
    const raw = new Error('connect ECONNREFUSED 127.0.0.1:5432 · table "Chapter"');
    const err = translateDbError(raw, '不該用到的訊息');
    expect(err.code).toBe('INTERNAL_ERROR');
    expect(err.message).not.toContain('ECONNREFUSED');
    expect(err.message).not.toContain('Chapter');
  });

  it('已經是 ServiceError 的一律原樣通過（那是我們自己下的判斷，不該被二次包裝）', () => {
    const original = new ServiceError('VALIDATION_ERROR', '輸入格式不正確', {
      fields: { title: '請輸入作品標題' },
    });
    const err = translateDbError(original, '不該用到的訊息');
    expect(err).toBe(original);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.fields).toEqual({ title: '請輸入作品標題' });
  });
});

describe('fieldErrors：Zod issue → 逐欄位訊息', () => {
  const schema = z.object({
    title: z.string().min(1, '請輸入作品標題'),
    excerpt: z.string().min(1, '請輸入作品簡介'),
  });

  it('每個欄位取第一則訊息', () => {
    const parsed = schema.safeParse({ title: '', excerpt: '' });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(fieldErrors(parsed.error)).toEqual({
      title: '請輸入作品標題',
      excerpt: '請輸入作品簡介',
    });
  });
});
