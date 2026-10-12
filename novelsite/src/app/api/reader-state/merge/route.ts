import { NextResponse } from 'next/server';
import { assertSameOrigin, requireUserForAction } from '@/lib/auth/guard';
import { readJsonBody, serviceErrorResponse } from '@/lib/auth/routeHelpers';
import { mergeLocalState } from '@/lib/services/readingService';

/**
 * `POST /api/reader-state/merge`（contracts/reader-state-api.md §5）
 * ==================================================================
 * 把未登入期間累積在該瀏覽器的書架、閱讀歷史與偏好帶進帳號。
 *
 * **冪等**（FR-015b）：重複執行不產生重複項目，也不重複累計 `favoriteCount`。
 * 客戶端於**回應 2xx 後**才清除本機的書架與歷史兩個鍵；
 * 偏好與主題兩鍵不清除（登入態仍被 Hook 回寫，見契約 §5 的兩類劃分）。
 *
 * 回傳的 `truncated` 是把客戶端在請求中標示的截斷旗標原樣送回，
 * 供前端明確告知使用者有部分未同步（FR-016a：MUST NOT 靜默捨棄）。
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireUserForAction();
    return NextResponse.json(await mergeLocalState(session.uid, await readJsonBody(request)));
  } catch (err) {
    return serviceErrorResponse(err);
  }
}
