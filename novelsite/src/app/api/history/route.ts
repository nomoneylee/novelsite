import { NextResponse } from 'next/server';
import { assertSameOrigin, requireUserForAction } from '@/lib/auth/guard';
import { searchParamsOf, serviceErrorResponse } from '@/lib/auth/routeHelpers';
import { parseOrThrow } from '@/lib/services/errors';
import { historyDeleteQuerySchema, listQuerySchema } from '@/lib/validation/reader';
import { clearHistory, listHistory } from '@/lib/services/readingService';

/**
 * `GET` / `DELETE /api/history`（contracts/reader-state-api.md §3）
 * =================================================================
 * 列表為**每部作品一筆**（`@@unique([userId, novelId])` 使再次閱讀成為 upsert），
 * 排序 `readAt DESC, id ASC`。
 *
 * 兩者的查詢字串 MUST 經共用驗證結構，MUST NOT 直接讀 `searchParams` 原值（FR-005）。
 * `DELETE` 省略 `novelId` 即清空全部 —— 故空字串在 schema 被拒：
 * `?novelId=` 若被當成「省略」，一個壞掉的連結就會清光使用者的整份歷史。
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await requireUserForAction();
    const query = parseOrThrow(listQuerySchema, searchParamsOf(request));
    return NextResponse.json(await listHistory(session.uid, query));
  } catch (err) {
    return serviceErrorResponse(err);
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireUserForAction();
    const { novelId } = parseOrThrow(historyDeleteQuerySchema, searchParamsOf(request));
    return NextResponse.json({ deleted: await clearHistory(session.uid, novelId) });
  } catch (err) {
    return serviceErrorResponse(err);
  }
}
