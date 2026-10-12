import { NextResponse } from 'next/server';
import { assertSameOrigin } from '@/lib/auth/origin';
import { readJsonBody, resolveRequestCtx, serviceErrorResponse } from '@/lib/auth/routeHelpers';
import { sendContactMessage } from '@/lib/services/contactService';

/**
 * 聯絡表單送出（FEAT-5 T052，contracts/contact-api.md §1）
 * ======================================================
 * 未登入可用。**成功與失敗 MUST 明確不同**（FR-020）——
 * 與密碼重設那兩個端點刻意相反，理由見 `contactService`。
 *
 * 回應轉譯一律走既有的 `serviceErrorResponse()`：
 * `SameOriginError` → 403、`VALIDATION_ERROR`（**含 honeypot 命中**）→ 400、
 * `RATE_LIMITED` → 429 + `Retry-After`、`MAIL_FAILED` → **502**。
 * **MUST NOT 自行 try/catch 拼回應** —— 那會讓狀態碼在兩個地方各有一份。
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const ctx = resolveRequestCtx(request);
    const body = await readJsonBody(request);

    // 同步等待寄送：回 200 的當下，信**已經**寄出去了
    await sendContactMessage(body, ctx);

    return NextResponse.json({ data: { ok: true } }, { status: 200 });
  } catch (err) {
    return serviceErrorResponse(err);
  }
}
