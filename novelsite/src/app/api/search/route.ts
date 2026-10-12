import { NextResponse } from 'next/server';
import { search, suggest } from '@/lib/services/searchService';
import { ServiceError } from '@/lib/services/errors';

/**
 * `GET /api/search`（contracts/search-api.md）
 * =============================================
 * 唯讀端點，**公開且不做 CSRF／Origin 檢查**（research R-6）——
 * Origin 比對防的是「別人的網站借使用者的憑證改資料」，這裡沒有資料可改。
 *
 * 判斷與短路一律在 `searchService`，本檔只負責 HTTP 這一層：
 * 讀查詢字串、選模式、把 `ServiceError` 換成狀態碼。
 * 若在這裡再寫一次「q 為空就回空」，`/search` 頁與本端點就有兩份規則了（FR-032）。
 *
 * 逐請求求值：搜尋結果隨作品的建立、上下架與更新而變，被快取住的搜尋
 * 會讓作者剛發佈的作品在網址上存在、在搜尋裡卻不存在。
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams);

  try {
    if (params.suggest === '1') {
      return NextResponse.json({ data: await suggest(params) });
    }

    const page = await search(params);
    return NextResponse.json({ data: page.items, meta: { nextCursor: page.nextCursor } });
  } catch (err) {
    if (err instanceof ServiceError && err.code === 'VALIDATION_ERROR') {
      return NextResponse.json(
        { error: { code: err.code, fields: err.fields ?? {} } },
        { status: 400 }
      );
    }

    // 未預期錯誤：記錄在伺服器端，對外只給一句話（FR-009，不外洩堆疊）
    console.error('[api/search] 未預期錯誤', err);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: '搜尋暫時無法使用，請稍後再試' } },
      { status: 500 }
    );
  }
}
