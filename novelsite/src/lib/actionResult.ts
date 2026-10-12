import 'server-only';
import { ServiceError } from '@/lib/services/errors';

/**
 * Server Action 的回傳形狀（contracts/server-actions.md 的通用約定）
 * =================================================================
 * 作者寫入流（`app/author/actions.ts`）與個人設定（`app/profile/actions.ts`）
 * **共用同一份定義**。
 *
 * **為何不讓兩個 Action 檔各留一份**：契約要求兩者的錯誤碼集合完全相同，
 * 而兩份各自演化的型別最後一定會有一邊多出或少掉一個碼 —— 前端的錯誤處理
 * 因此在其中一邊會有一條永遠走不到的分支，或一條沒人處理的錯誤。
 *
 * 本檔不含任何 `'use server'`：它是型別與純函式，不是 Action。
 */

/**
 * **就是 `ServiceError` 的碼集合**，不是另一份清單（FEAT-5 T031 改為別名）。
 *
 * 原本是一份逐項抄寫的副本，而 `errorResult()` 直接把 `err.code` 填進回傳值 ——
 * 服務層新增任何一個碼（本階段的 `INVALID_TOKEN`／`EXPIRED_TOKEN`）都會讓那一行紅燈，
 * 而修法只有兩種：抄一次，或讓它別再是副本。抄寫正是本檔開頭那段註解說要避免的事
 * （兩份各自演化的型別最後一定會有一邊多出或少掉一個碼）。
 */
export type { ErrorCode } from '@/lib/services/errors';
import type { ErrorCode } from '@/lib/services/errors';

export type ActionResult<T = void> =
  | (T extends void ? { success: true } : { success: true; data: T })
  | {
      success: false;
      error: {
        code: ErrorCode;
        message: string;
        fields?: Record<string, string>;
        retryAfterSeconds?: number;
      };
    };

export type Failure = Extract<ActionResult<unknown>, { success: false }>;

export const ok = { success: true } as const;

/**
 * 服務層例外 → 回傳值上的錯誤碼。
 * 非 `ServiceError` 一律 `INTERNAL_ERROR`，且**只把訊息寫進伺服器記錄**（FR-009）——
 * 把原始例外轉給前端就等於把資料庫的表名與約束名一起送出去。
 *
 * `scope` 只影響記錄前綴，讓兩個 Action 檔的錯誤在同一份 log 裡分得出來源。
 */
export function errorResult(scope: string, err: unknown): Failure {
  if (err instanceof ServiceError) {
    return {
      success: false,
      error: {
        code: err.code,
        message: err.message,
        ...(err.fields ? { fields: err.fields } : {}),
        ...(err.retryAfterSeconds !== undefined
          ? { retryAfterSeconds: err.retryAfterSeconds }
          : {}),
      },
    };
  }
  console.error(`[${scope}] 未預期錯誤`, err);
  return { success: false, error: { code: 'INTERNAL_ERROR', message: '系統忙碌中，請稍後再試' } };
}
