import { NextResponse } from 'next/server';
import { assertCronSecret, resolveRequestCtx, serviceErrorResponse } from '@/lib/auth/routeHelpers';
import { logSecurityEvent } from '@/lib/auth/audit';
import { publishDueScheduled } from '@/lib/services/chapterService';

/**
 * `POST /api/cron/publish-scheduled` — 排程發佈（contracts/analytics-scheduling-api.md §4）
 * =========================================================================================
 * **本檔只做三件事**：`assertCronSecret` → `chapterService.publishDueScheduled(new Date())`
 * → 回報結果。掃描、逐章交易、計數回填與 group by 後的通知合併 **MUST 全部位於服務層**
 * （與另兩個 cron 入口同形）——照字面把那段編排寫進 Route Handler 的話，
 * 「一次作業發 M 章仍只發一則通知」這條規則就住在一個沒有任何單元測試搆得到的地方。
 *
 * **不適用來源比對**：由外部排程器呼叫，無瀏覽器來源；其防護為 `CRON_SECRET`。
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const startedAt = Date.now();
  try {
    assertCronSecret(request);

    const result = await publishDueScheduled(new Date());
    const durationMs = Date.now() - startedAt;

    // 執行事件以單行 JSON 記錄（FR-057）
    logSecurityEvent({
      event: 'cron.publish-scheduled',
      ip: resolveRequestCtx(request).ip,
      result:
        `ok chapters=${result.chaptersPublished} novels=${result.novelsAffected} ` +
        `notifications=${result.notificationsCreated} durationMs=${durationMs}`,
    });

    return NextResponse.json({
      ok: true,
      processed: result.chaptersPublished,
      durationMs,
      detail: {
        chaptersPublished: result.chaptersPublished,
        novelsAffected: result.novelsAffected,
        notificationsCreated: result.notificationsCreated,
      },
    });
  } catch (err) {
    return serviceErrorResponse(err);
  }
}
