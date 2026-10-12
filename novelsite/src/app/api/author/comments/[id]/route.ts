import { NextResponse } from 'next/server';
import { assertSameOrigin, requireAuthorForAction } from '@/lib/auth/guard';
import { readJsonBody, serviceErrorResponse } from '@/lib/auth/routeHelpers';
import { parseOrThrow } from '@/lib/services/errors';
import { commentHiddenSchema } from '@/lib/validation/comment';
import { setHidden } from '@/lib/services/commentService';

/**
 * `PATCH /api/author/comments/{id}`（contracts/interaction-api.md §3）
 * ====================================================================
 * **隱藏，不是竄改**（FR-031）：本端點只寫 `status`，
 * **MUST NOT 提供任何可改動 `content` 的入參** —— `commentHiddenSchema` 只有
 * `hidden` 一欄，Zod 的預設剝除行為會把挾帶進來的 `content` 濾掉，
 * 而服務層的簽章裡根本沒有那個參數可以接。
 *
 * 對他人作品下的留言執行管理操作回 403 且資料未變更（FR-032、US2 AC10）。
 */
interface Ctx {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, ctx: Ctx) {
  try {
    assertSameOrigin(request);
    const session = await requireAuthorForAction();
    const { id } = await ctx.params;
    const { hidden } = parseOrThrow(commentHiddenSchema, await readJsonBody(request));
    await setHidden(session.uid, id, hidden);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return serviceErrorResponse(err);
  }
}
