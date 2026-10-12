import { NextResponse } from 'next/server';
import { requireUserForAction } from '@/lib/auth/guard';
import { searchParamsOf, serviceErrorResponse } from '@/lib/auth/routeHelpers';
import { parseOrThrow } from '@/lib/services/errors';
import { listQuerySchema } from '@/lib/validation/reader';
import { list, listIds } from '@/lib/services/bookshelfService';

/**
 * `GET /api/bookshelf`（contracts/reader-state-api.md §1）
 * =========================================================
 * 需登入的游標分頁列表（`createdAt DESC, id ASC`，預設 20 筆）。
 *
 * `cursor` 與 `limit` **MUST 經共用驗證結構**，MUST NOT 直接把 `searchParams` 的原值
 * 交給服務層（FR-005）—— `?limit=100000` 未驗即是一次全表掃描，
 * 而 400 是比逾時更好的失敗方式。
 *
 * 逐請求求值：書架隨使用者的每一次收藏而變，被快取住的書架等於顯示別人的收藏。
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await requireUserForAction();
    const params = searchParamsOf(request);

    // `?view=ids`：只回識別碼集合，供 `useBookshelf`／`useBookshelfIds` 一次取得。
    // 客戶端要回答的是「這一部在不在書架」與「整份清單是哪些」，兩者都需要完整集合；
    // 用游標分頁去湊，收藏 500 部的人得打 25 次請求才知道當前這一部有沒有被收藏。
    // （2026-08-07 補入的端點形態，已同步回寫 contracts/reader-state-api.md §1 與 arch.md §5.4）
    if (params.view === 'ids') {
      return NextResponse.json({ ids: await listIds(session.uid) });
    }

    const query = parseOrThrow(listQuerySchema, params);
    return NextResponse.json(await list(session.uid, query));
  } catch (err) {
    return serviceErrorResponse(err);
  }
}
