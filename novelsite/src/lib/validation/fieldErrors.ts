import type { z } from 'zod';

/**
 * Zod 的 issue 清單 → 逐欄位訊息（同一欄位只取第一則，表單一次顯示一句就夠）。
 *
 * **放在 `validation/` 而非 `services/errors.ts`**：後者標了 `server-only`，
 * 而聯絡表單（client component）送出前要以同一份 schema 先驗一次，
 * 必須拿得到同一個轉換 —— 在 client 端另寫一份的必然結果是兩邊訊息漂移
 * （2026-08-13，T054 修正欄位錯誤顯示時拆出）。`services/errors.ts` 改為 re-export。
 */
export function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!(key in fields)) fields[key] = issue.message;
  }
  return fields;
}
