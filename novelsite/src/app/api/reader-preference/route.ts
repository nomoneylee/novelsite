import { NextResponse } from 'next/server';
import { assertSameOrigin, requireUserForAction } from '@/lib/auth/guard';
import { readJsonBody, serviceErrorResponse } from '@/lib/auth/routeHelpers';
import { get, put } from '@/lib/services/preferenceService';

/**
 * `PUT` / `GET /api/reader-preference`（contracts/reader-state-api.md §4）
 * ========================================================================
 * 同步範圍**只有** `fontSize` 與 `theme`（FR-014）。兩者皆可單獨更新。
 *
 * **`GET` 為 2026-08-07 補入的端點**：原契約 §4 只列了 `PUT`，但 T015a 的跨裝置驗收
 * 是「裝置 A `PUT` → 裝置 B `GET`」，而 T036 的兩個 Hook 在登入態要把伺服器值讀回來
 * 當離線快取——沒有 `GET`，`theme` 有寫入端卻沒有消費端，US1 AC6 與 SC-001 的
 * 主題部分恆假。已同步回寫 `arch.md` §5.4 與本契約。
 *
 * 尚未設定過偏好者回 `{ preference: null }`（**不是 404**）：那不是錯誤，
 * 而是「沿用你本機現在的值」，客戶端據此決定要不要覆寫本地設定。
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await requireUserForAction();
    return NextResponse.json({ preference: await get(session.uid) });
  } catch (err) {
    return serviceErrorResponse(err);
  }
}

export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireUserForAction();
    const preference = await put(session.uid, await readJsonBody(request));
    return NextResponse.json({ preference });
  } catch (err) {
    return serviceErrorResponse(err);
  }
}
