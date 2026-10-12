import { NextResponse } from 'next/server';
import { assertCronSecret, resolveRequestCtx, serviceErrorResponse } from '@/lib/auth/routeHelpers';
import { logSecurityEvent } from '@/lib/auth/audit';
import { recompute } from '@/lib/services/rankingService';

/**
 * `POST /api/cron/rankings` — 排行重算（contracts/analytics-scheduling-api.md §4）
 * ================================================================================
 * 授權為 `Authorization: Bearer <CRON_SECRET>`（`timingSafeEqual` 比對）；
 * 密鑰不符**或 `CRON_SECRET` 未設定**皆回 401 且不執行任何工作。
 *
 * **不適用來源比對**：本入口由外部排程器呼叫，沒有瀏覽器來源可比對（FR-006 的對象是
 * 瀏覽器發起的寫入），其防護就是上述密鑰。
 *
 * 每個 `(period, categoryId)` 組合的單一交易與計分皆位於服務層 —— 本檔只做三件事：
 * 驗密鑰、呼叫、回報（與另兩個 cron 入口同形）。
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const startedAt = Date.now();
  try {
    assertCronSecret(request);

    const result = await recompute(new Date());
    const durationMs = Date.now() - startedAt;

    // 執行事件以單行 JSON 記錄（FR-057 適用三個入口，非只有彙總）
    logSecurityEvent({
      event: 'cron.rankings',
      ip: resolveRequestCtx(request).ip,
      result: `ok combos=${result.combos} entries=${result.entriesWritten} durationMs=${durationMs}`,
    });

    return NextResponse.json({
      ok: true,
      processed: result.entriesWritten,
      durationMs,
      detail: {
        periods: result.periods,
        combos: result.combos,
        entriesWritten: result.entriesWritten,
      },
    });
  } catch (err) {
    return serviceErrorResponse(err);
  }
}
