import { NextResponse } from 'next/server';
import { assertSameOrigin, getSession, requireUserForAction } from '@/lib/auth/guard';
import { readJsonBody, searchParamsOf, serviceErrorResponse } from '@/lib/auth/routeHelpers';
import { parseOrThrow } from '@/lib/services/errors';
import { commentInputSchema, commentListQuerySchema } from '@/lib/validation/comment';
import { create, listByChapter } from '@/lib/services/commentService';

/**
 * `GET` / `POST /api/chapters/{chapterId}/comments`（contracts/interaction-api.md §2）
 * ====================================================================================
 * **讀取公開**（FR-026、US2 AC7）：未登入訪客讀得到整個留言區，只有送出需要身分。
 *
 * `cursor` 與 `limit` MUST 經 `validation/comment.ts` 的共用結構，MUST NOT 直接把
 * `searchParams` 的原值交給服務層（FR-005）—— `?limit=100000` 未驗即是一次全表掃描。
 *
 * 成功發表時 `Novel.commentCount` 於**同一交易**內 +1，落點在服務層（T065）。
 */
export const dynamic = 'force-dynamic';

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const query = parseOrThrow(commentListQuerySchema, searchParamsOf(request));
    // 未登入不轉址：訪客視圖要能正常渲染。有身分時才判定得出「哪幾則是自己的」
    const session = await getSession();
    return NextResponse.json(await listByChapter(id, query, session?.uid));
  } catch (err) {
    return serviceErrorResponse(err);
  }
}

export async function POST(request: Request, ctx: Ctx) {
  try {
    assertSameOrigin(request);
    const session = await requireUserForAction();
    const { id } = await ctx.params;
    const input = parseOrThrow(commentInputSchema, await readJsonBody(request));
    return NextResponse.json({ comment: await create(session.uid, id, input) });
  } catch (err) {
    return serviceErrorResponse(err);
  }
}
