import { NextResponse } from 'next/server';
import { assertSameOrigin, requireUserForAction } from '@/lib/auth/guard';
import { serviceErrorResponse } from '@/lib/auth/routeHelpers';
import { add, remove } from '@/lib/services/bookshelfService';

/**
 * `POST` / `DELETE /api/bookshelf/{novelId}`（contracts/reader-state-api.md §1）
 * ==============================================================================
 * 兩者皆為寫入，故 MUST 先過 `assertSameOrigin`（FR-006）——
 * Route Handler **沒有**框架內建的來源比對，那只涵蓋 Server Action（研究於 T002 查證）。
 *
 * 回應帶回**當下的** `favoriteCount`：使用者按下收藏後看到的數字必須立刻是對的
 * （FR-038a、SC-019），要前端自己加一等於在客戶端維護第二套真相。
 *
 * `params` 於 Next 16 為 Promise（T002 的隨版文件查證）。
 */
interface Ctx {
  params: Promise<{ novelId: string }>;
}

export async function POST(request: Request, ctx: Ctx) {
  try {
    assertSameOrigin(request);
    const session = await requireUserForAction();
    const { novelId } = await ctx.params;
    return NextResponse.json({ ok: true, ...(await add(session.uid, novelId)) });
  } catch (err) {
    return serviceErrorResponse(err);
  }
}

export async function DELETE(request: Request, ctx: Ctx) {
  try {
    assertSameOrigin(request);
    const session = await requireUserForAction();
    const { novelId } = await ctx.params;
    return NextResponse.json({ ok: true, ...(await remove(session.uid, novelId)) });
  } catch (err) {
    return serviceErrorResponse(err);
  }
}
