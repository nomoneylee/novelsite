import { NextResponse } from 'next/server';
import { assertSameOrigin, getSession, requireUserForAction } from '@/lib/auth/guard';
import { readJsonBody, searchParamsOf, serviceErrorResponse } from '@/lib/auth/routeHelpers';
import { parseOrThrow } from '@/lib/services/errors';
import { reviewInputSchema, reviewListQuerySchema } from '@/lib/validation/review';
import { create, list } from '@/lib/services/reviewService';

/**
 * `GET` / `POST /api/novels/{novelId}/reviews`（contracts/interaction-api.md §1）
 * ===============================================================================
 * **讀取公開、寫入需登入**（FR-026）：未登入訪客讀得到全部評論，只有送出需要身分。
 * 把讀取一併關起來是最容易「順手」做出來的錯誤，而它會讓訪客連評論區都看不到。
 *
 * 排序由**伺服器**承擔（`?sort=hot|latest`，FR-023a）：客戶端只拿得到當前這一頁，
 * 對它排序等於只排了 20 則裡的 20 則。
 *
 * `params` 於 Next 16 為 Promise（T002 的隨版文件查證）。
 */
export const dynamic = 'force-dynamic';

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const query = parseOrThrow(reviewListQuerySchema, searchParamsOf(request));
    // 未登入即無 `likedByMe` 可言；`getSession` 不轉址，公開頁面要在訪客狀態下正常渲染
    const session = await getSession();
    return NextResponse.json(await list(id, query, session?.uid));
  } catch (err) {
    return serviceErrorResponse(err);
  }
}

export async function POST(request: Request, ctx: Ctx) {
  try {
    assertSameOrigin(request);
    const session = await requireUserForAction();
    const { id } = await ctx.params;
    const input = parseOrThrow(reviewInputSchema, await readJsonBody(request));
    return NextResponse.json({ review: await create(session.uid, id, input) });
  } catch (err) {
    return serviceErrorResponse(err);
  }
}
