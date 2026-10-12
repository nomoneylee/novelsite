import { NextResponse } from 'next/server';
import { assertSameOrigin, requireUserForAction } from '@/lib/auth/guard';
import { serviceErrorResponse } from '@/lib/auth/routeHelpers';
import { softDelete } from '@/lib/services/commentService';

/**
 * `DELETE /api/comments/{id}`（contracts/interaction-api.md §2）
 * ==============================================================
 * 刪除留言留下**墓碑**（`status='deleted'`，保留該列），並於同一交易內
 * `Novel.commentCount` −1。**MUST NOT 硬刪除** —— `Comment.parent` 為級聯刪除，
 * 硬刪除會連坐刪光他人掛在下面的回覆，等於用「刪除自己的內容」抹掉別人說過的話
 * （FR-027、US2 AC11）。
 *
 * 非擁有者回 **403 而非 404**（FR-004，與評論同一條規則）。
 */
interface Ctx {
  params: Promise<{ id: string }>;
}

export async function DELETE(request: Request, ctx: Ctx) {
  try {
    assertSameOrigin(request);
    const session = await requireUserForAction();
    const { id } = await ctx.params;
    await softDelete(session.uid, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return serviceErrorResponse(err);
  }
}
