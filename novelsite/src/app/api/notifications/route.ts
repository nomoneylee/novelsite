import { NextResponse } from 'next/server';
import { assertSameOrigin, requireUserForAction } from '@/lib/auth/guard';
import { searchParamsOf, serviceErrorResponse } from '@/lib/auth/routeHelpers';
import { parseOrThrow } from '@/lib/services/errors';
import { notificationListQuerySchema } from '@/lib/validation/notification';
import { list, markRead } from '@/lib/services/notificationService';

/**
 * `GET` / `PATCH /api/notifications`（contracts/analytics-scheduling-api.md §3）
 * ==============================================================================
 * 列表排序 `createdAt DESC, id ASC`，游標分頁每頁至多 20 筆。
 *
 * 查詢字串 MUST 經共用驗證結構，**MUST NOT 直接讀 `searchParams` 原值**（FR-005）——
 * `limit` 不驗時 `?limit=100000` 直接就是一次全表掃描。
 *
 * `PATCH` 為「全部標記已讀」，範圍是**自己名下**：回傳的 `unreadCount` 恆為 0，
 * 但仍由服務層實算而非寫死 —— 寫死的話，某天多了一種不該被一次清掉的通知時，
 * 導覽列會與資料庫說法不一。
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await requireUserForAction();
    const query = parseOrThrow(notificationListQuerySchema, searchParamsOf(request));
    return NextResponse.json(
      await list(session.uid, {
        unreadOnly: query.unread,
        cursor: query.cursor,
        limit: query.limit,
      })
    );
  } catch (err) {
    return serviceErrorResponse(err);
  }
}

export async function PATCH(request: Request) {
  try {
    // 寫入入口一律先比對來源（FR-006）；順序 MUST 為來源 → 身分，
    // 反過來寫會讓跨站請求先觸發一次工作階段查詢
    assertSameOrigin(request);
    const session = await requireUserForAction();
    return NextResponse.json({ ok: true, ...(await markRead(session.uid)) });
  } catch (err) {
    return serviceErrorResponse(err);
  }
}
