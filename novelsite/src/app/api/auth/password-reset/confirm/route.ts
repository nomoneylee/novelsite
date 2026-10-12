import { NextResponse } from 'next/server';
import { assertSameOrigin } from '@/lib/auth/origin';
import { confirmPasswordReset } from '@/lib/services/passwordResetService';
import { readJsonBody, serviceErrorResponse } from '@/lib/auth/routeHelpers';

/**
 * 以憑證設定新密碼（FEAT-5 T031，contracts/password-reset-api.md §2）
 * =================================================================
 * `INVALID_TOKEN` 與 `EXPIRED_TOKEN` 各自轉為 **400**（FR-015：兩個碼而非一個，
 * 因為兩種失效在畫面上是不同的說明訊息）。轉譯表在 `routeHelpers`
 * 的 `STATUS_BY_SERVICE_CODE` —— 與 `ErrorCode` 是同一個聯集型別的兩半。
 *
 * 兩者皆為 400 而非 401：請求本身沒有身分，談不上未認證。
 *
 * **成功 MUST NOT 附上工作階段 Cookie**：服務層剛剛才撤銷該使用者的全部 session
 * （FR-012），當下立刻簽發一張新的與那個意圖相左。
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = await readJsonBody(request);
    await confirmPasswordReset(body);
    return NextResponse.json({ data: { ok: true } }, { status: 200 });
  } catch (err) {
    return serviceErrorResponse(err);
  }
}
