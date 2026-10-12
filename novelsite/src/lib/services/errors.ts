import 'server-only';
import type { z } from 'zod';
import { fieldErrorsOf } from '@/lib/validation/fieldErrors';

/**
 * 服務層的錯誤語意（contracts/server-actions.md 的通用約定）
 * ===========================================================
 * Action 層把 `ServiceError` 逐一轉成回傳值上的錯誤碼；**其餘任何例外一律轉
 * `INTERNAL_ERROR` 且不外洩訊息與堆疊**（FR-009）。
 *
 * 型別放在獨立檔案而非某個 service 內：`novelService` 與 `chapterService` 都要用，
 * 讓其中一個去 import 另一個只是為了拿一個錯誤類別，會在兩個本來互不相干的模組之間
 * 建立一條假的相依。
 */
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'SUSPENDED'
  /**
   * FEAT-5：重設憑證不存在／已作廢／已使用（FR-015）。
   * **與 `EXPIRED_TOKEN` 是兩個碼而非一個**：FR-015 要求對兩種情況顯示**不同**的說明
   * （「連結已失效」／「連結已過期」），合成一個碼畫面就只能給一句含糊的話。
   * 兩者皆為 400 而非 401 —— 請求本身沒有身分，談不上未認證。
   */
  | 'INVALID_TOKEN'
  /** FEAT-5：重設憑證已逾期（FR-008／FR-015）。見 `INVALID_TOKEN` 的說明 */
  | 'EXPIRED_TOKEN'
  /**
   * FEAT-5：郵件寄送失敗（FR-020）。對外為 **502 而非 500** ——
   * 失敗來自上游郵件服務，不是本站程式錯誤。
   *
   * **這個碼存在的理由是「不得假成功」**：聯絡表單與密碼重設刻意相反，
   * 那一刀吞掉寄送例外（回應一律相同以免洩漏帳號存在性），
   * 這一刀沒有可洩漏的東西，而使用者必須知道訊息到底出去了沒有。
   */
  | 'MAIL_FAILED'
  | 'INTERNAL_ERROR';

export class ServiceError extends Error {
  code: ErrorCode;
  fields?: Record<string, string>;
  retryAfterSeconds?: number;

  constructor(
    code: ErrorCode,
    message: string,
    opts?: { fields?: Record<string, string>; retryAfterSeconds?: number }
  ) {
    super(message);
    this.name = 'ServiceError';
    this.code = code;
    this.fields = opts?.fields;
    this.retryAfterSeconds = opts?.retryAfterSeconds;
  }
}

/**
 * Zod 的 issue 清單 → 逐欄位訊息。
 *
 * 實作已移至 `@/lib/validation/fieldErrors`：本檔標了 `server-only`，而聯絡表單
 * 於 client 端送出前也要做同一份轉換（2026-08-13）。此處僅保留既有匯出名稱。
 */
export const fieldErrors = fieldErrorsOf;

/** 以 schema 驗證入參，失敗即擲出帶欄位訊息的 `VALIDATION_ERROR` */
export function parseOrThrow<T>(
  schema: { safeParse: (v: unknown) => z.ZodSafeParseResult<T> },
  input: unknown
): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new ServiceError('VALIDATION_ERROR', '輸入格式不正確', {
      fields: fieldErrors(parsed.error),
    });
  }
  return parsed.data;
}

/**
 * Prisma 的唯一約束衝突（P2002）→ `CONFLICT`；其餘一律 `INTERNAL_ERROR`（FR-009）。
 *
 * 以「有沒有 `code` 屬性且值為 P2002」判斷，MUST NOT 用 `instanceof
 * Prisma.PrismaClientKnownRequestError` —— 那需要把 Prisma 的執行期型別拉進服務層，
 * 而這一層的存在目的正是不依賴特定資料庫客戶端。
 */
export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'P2002'
  );
}

/**
 * 把資料層例外轉譯為對外的錯誤碼。
 * `ServiceError` 原樣通過（那是我們自己下的判斷，不該被二次包裝）。
 */
export function translateDbError(err: unknown, conflictMessage: string): ServiceError {
  if (err instanceof ServiceError) return err;
  if (isUniqueViolation(err)) return new ServiceError('CONFLICT', conflictMessage);

  console.error('[service] 未預期的資料層錯誤', err);
  return new ServiceError('INTERNAL_ERROR', '系統忙碌中，請稍後再試');
}
