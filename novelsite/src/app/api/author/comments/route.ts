import { NextResponse } from 'next/server';
import { requireAuthorForAction } from '@/lib/auth/guard';
import { searchParamsOf, serviceErrorResponse } from '@/lib/auth/routeHelpers';
import { parseOrThrow } from '@/lib/services/errors';
import { authorCommentListQuerySchema } from '@/lib/validation/comment';
import { listForAuthor } from '@/lib/services/commentService';

/**
 * `GET /api/author/comments`（contracts/interaction-api.md §3）
 * =============================================================
 * 作者向資源，**不公開**：未登入 401、角色不足 403。
 * `novel.authorId = session.uid` 由**資料層強制帶入**（T061）——
 * 即使本檔忘了檢查，資料層仍查不到他人作品下的留言。
 *
 * 四個查詢參數（`cursor`／`limit`／`novelId`／`hidden`）MUST 經
 * `validation/comment.ts` 的共用結構，MUST NOT 直接讀 `searchParams` 原值（FR-005）。
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await requireAuthorForAction();
    const query = parseOrThrow(authorCommentListQuerySchema, searchParamsOf(request));
    return NextResponse.json(await listForAuthor(session.uid, query));
  } catch (err) {
    return serviceErrorResponse(err);
  }
}
