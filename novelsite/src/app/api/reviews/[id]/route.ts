import { NextResponse } from 'next/server';
import { assertSameOrigin, requireUserForAction } from '@/lib/auth/guard';
import { readJsonBody, serviceErrorResponse } from '@/lib/auth/routeHelpers';
import { parseOrThrow } from '@/lib/services/errors';
import { reviewPatchSchema } from '@/lib/validation/review';
import { remove, update } from '@/lib/services/reviewService';

/**
 * `PATCH` / `DELETE /api/reviews/{id}`（contracts/interaction-api.md §1）
 * =======================================================================
 * 非擁有者回 **403 而非 404**（FR-004）：評論是公開可見的資源，它的存在性本來就
 * 不是秘密，用 404 假裝「查無此物」只會讓真正的 404（識別碼根本不存在）不再有
 * 任何資訊量。此與作者向資源的「非擁有者一律 404」規則刻意相反、兩者並存。
 *
 * `DELETE` 為**硬刪除**（FR-023）：唯一鍵自然釋放，刪除後可對同一作品重新發表。
 */
interface Ctx {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, ctx: Ctx) {
  try {
    assertSameOrigin(request);
    const session = await requireUserForAction();
    const { id } = await ctx.params;
    const patch = parseOrThrow(reviewPatchSchema, await readJsonBody(request));
    return NextResponse.json({ review: await update(session.uid, id, patch) });
  } catch (err) {
    return serviceErrorResponse(err);
  }
}

export async function DELETE(request: Request, ctx: Ctx) {
  try {
    assertSameOrigin(request);
    const session = await requireUserForAction();
    const { id } = await ctx.params;
    await remove(session.uid, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return serviceErrorResponse(err);
  }
}
