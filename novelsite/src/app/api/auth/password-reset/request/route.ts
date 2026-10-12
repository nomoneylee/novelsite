import { after, NextResponse } from 'next/server';
import { assertSameOrigin } from '@/lib/auth/origin';
import { requestPasswordReset } from '@/lib/services/passwordResetService';
import { readJsonBody, resolveRequestCtx, serviceErrorResponse } from '@/lib/auth/routeHelpers';

/**
 * 申請密碼重設（FEAT-5 T030，contracts/password-reset-api.md §1）
 * ==============================================================
 * 執行順序**不可調換**：`assertSameOrigin` → 位址鍵 → 帳號鍵 → Zod → 先回 200 →
 * `after(deliver)`。
 *
 * **`after()` 而非 `await`**：不存在的帳號會跳過「查使用者、發憑證、寄信」，
 * 其中寄信是一次對外 HTTPS 呼叫。同步執行時兩條路徑的時間差是結構性的且遠大於雜訊，
 * 而那個時間差本身就是一條枚舉管道（FR-006a）。
 *
 * `deliver()` 內部吞掉一切例外，故此處 MUST NOT 對它 try/catch —— 也不該有東西可接。
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const ctx = resolveRequestCtx(request);
    const body = await readJsonBody(request);

    const { deliver } = await requestPasswordReset(body, ctx);

    // 回應在此組好；以下的一切都發生在它送出之後
    after(deliver);

    return NextResponse.json({ data: { ok: true } }, { status: 200 });
  } catch (err) {
    // `SameOriginError` → 403、`RATE_LIMITED` → 429、`VALIDATION_ERROR` → 400
    return serviceErrorResponse(err);
  }
}
