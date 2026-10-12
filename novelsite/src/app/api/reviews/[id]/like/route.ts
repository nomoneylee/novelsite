import { NextResponse } from 'next/server';
import { assertSameOrigin, requireUserForAction } from '@/lib/auth/guard';
import { serviceErrorResponse } from '@/lib/auth/routeHelpers';
import { like } from '@/lib/services/reviewService';

/**
 * `POST` / `DELETE /api/reviews/{id}/like`（contracts/interaction-api.md §1）
 * ===========================================================================
 * 回應一律帶回**當下的** `likeCount` 與 `likedByMe`：使用者按下按讚後看到的數字
 * 必須立刻是對的（FR-038a、SC-019），要前端自己加一等於在客戶端維護第二套真相。
 *
 * 同一人重複按讚 MUST NOT 累加（唯一鍵擋下，回應為冪等的目前狀態，FR-024）。
 *
 * 檔名只能是 `route.ts`（App Router 的 Handler 慣例），故「按讚」以一層路徑段表達。
 */
interface Ctx {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, ctx: Ctx) {
  try {
    assertSameOrigin(request);
    const session = await requireUserForAction();
    const { id } = await ctx.params;
    return NextResponse.json(await like(session.uid, id, true));
  } catch (err) {
    return serviceErrorResponse(err);
  }
}

export async function DELETE(request: Request, ctx: Ctx) {
  try {
    assertSameOrigin(request);
    const session = await requireUserForAction();
    const { id } = await ctx.params;
    return NextResponse.json(await like(session.uid, id, false));
  } catch (err) {
    return serviceErrorResponse(err);
  }
}
