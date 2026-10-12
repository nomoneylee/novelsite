import { NextResponse } from 'next/server';
import { assertSameOrigin, requireUserForAction } from '@/lib/auth/guard';
import { readJsonBody, searchParamsOf, serviceErrorResponse } from '@/lib/auth/routeHelpers';
import { parseOrThrow } from '@/lib/services/errors';
import { progressReportSchema } from '@/lib/validation/reader';
import { getProgress, reportProgress, touchHistory } from '@/lib/services/readingService';

/**
 * `PUT` / `GET /api/reading-progress`（contracts/reader-state-api.md §2、§3）
 * ===========================================================================
 * **本端點是 `ReadingHistory` 的唯一寫入落點**：契約中歷史沒有獨立端點，
 * 由本處理程序於寫入進度後一併 upsert（§3）。不在這裡呼叫的話，
 * `touchHistory` 會有定義卻無人呼叫，登入者的歷史永遠是空的，
 * 而 `GET /api/history` 回空清單這件事沒有任何測試看得出來。
 *
 * 歷史寫入為「盡力而為」：失敗 **MUST 被吞掉**，MUST NOT 讓閱讀因此中斷（FR-012）。
 */
export const dynamic = 'force-dynamic';

export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireUserForAction();
    const input = parseOrThrow(progressReportSchema, await readJsonBody(request));

    await reportProgress(session.uid, input);

    try {
      await touchHistory(session.uid, input.novelId, input.chapterId);
    } catch (historyErr) {
      // 記錄但不外顯：歷史是附帶效果，讓它把一次成功的進度上報變成 500 沒有道理
      console.error('[api/reading-progress] 閱讀歷史寫入失敗（已吞掉）', historyErr);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return serviceErrorResponse(err);
  }
}

export async function GET(request: Request) {
  try {
    const session = await requireUserForAction();
    const { novelId } = searchParamsOf(request);
    if (!novelId) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: '缺少 novelId' } },
        { status: 400 }
      );
    }
    return NextResponse.json(await getProgress(session.uid, novelId));
  } catch (err) {
    return serviceErrorResponse(err);
  }
}
