import { NextResponse } from 'next/server';
import { assertSameOrigin, requireUserForAction } from '@/lib/auth/guard';
import { readJsonBody, serviceErrorResponse } from '@/lib/auth/routeHelpers';
import { parseOrThrow } from '@/lib/services/errors';
import { markNotificationReadSchema } from '@/lib/validation/notification';
import { markRead } from '@/lib/services/notificationService';

/**
 * `PATCH /api/notifications/{id}`（contracts/analytics-scheduling-api.md §3）
 * ===========================================================================
 * 單筆標記已讀。入參 `{ read: true }`，回傳 `{ ok: true, unreadCount }` ——
 * 不回未讀數的話，導覽列只能猜或另外發一次請求，而未讀數 MUST 即時且 MUST NOT 快取。
 *
 * **不屬於自己回 404，MUST NOT 回 403**：403 等於告訴呼叫者「這個識別碼是有效的，
 * 只是不是你的」，而通知識別碼可枚舉 —— 那就成了一條確認「某人有幾則通知」的旁通道。
 * 「不存在」與「他人的」因而在服務層匯流成同一個 `NOT_FOUND`。
 */
export const dynamic = 'force-dynamic';

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await requireUserForAction();
    const { id } = await context.params;
    parseOrThrow(markNotificationReadSchema, await readJsonBody(request));
    return NextResponse.json({ ok: true, ...(await markRead(session.uid, id)) });
  } catch (err) {
    return serviceErrorResponse(err);
  }
}
