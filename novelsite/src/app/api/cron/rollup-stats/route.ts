import { NextResponse } from 'next/server';
import { assertCronSecret, resolveRequestCtx, serviceErrorResponse } from '@/lib/auth/routeHelpers';
import { logSecurityEvent } from '@/lib/auth/audit';
import { rollupDaily } from '@/lib/services/statsService';

/**
 * `POST /api/cron/rollup-stats` — 每日統計彙總（contracts/analytics-scheduling-api.md §4）
 * =======================================================================================
 * 授權為 `Authorization: Bearer <CRON_SECRET>`（`timingSafeEqual` 比對）；
 * 密鑰不符**或 `CRON_SECRET` 未設定**皆回 401 且不執行任何工作。
 *
 * **不適用來源比對**：本入口由外部排程器呼叫，沒有瀏覽器來源可比對，
 * 其防護就是上述密鑰（FR-006 的對象是瀏覽器發起的寫入）。
 *
 * `detail` MUST 逐一回報各清理對象的刪除筆數 —— 清理是無聲的破壞性動作，
 * 只回一個總數或完全不回，保留期設錯時沒有任何人看得出來。
 * （`notificationsPurged` 於 4-D 一併接上：`Notification` 在該刀才建表，T127a。）
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const startedAt = Date.now();
  try {
    assertCronSecret(request);

    const result = await rollupDaily(new Date());
    const durationMs = Date.now() - startedAt;

    // 執行事件以單行 JSON 記錄（沿用 logSecurityEvent 的形狀，FR-057）
    logSecurityEvent({
      event: 'cron.rollup-stats',
      ip: resolveRequestCtx(request).ip,
      result: `ok days=${result.daysProcessed} novels=${result.novelsTouched} durationMs=${durationMs}`,
    });

    return NextResponse.json({
      ok: true,
      processed: result.daysProcessed,
      durationMs,
      detail: {
        daysProcessed: result.daysProcessed,
        novelsTouched: result.novelsTouched,
        viewsPurged: result.viewsPurged,
        bookshelfEventsPurged: result.bookshelfEventsPurged,
        notificationsPurged: result.notificationsPurged,
      },
    });
  } catch (err) {
    return serviceErrorResponse(err);
  }
}
