import { describe, it, expect, inject } from 'vitest';
import { createUser } from '../helpers/fixtures';
import { resetAuthTables } from '../helpers/resetAuthTables';

/**
 * 第五套測試：子路徑（`basePath`）相容（FEAT-6 T028、FR-078）
 * ==============================================================
 * `deploy/deployment.md` §9 實測出**五處框架管不到的地方**。本套只驗那五處，
 * **MUST 精簡至「框架管不到的部分」**：MUST NOT 在此重驗登入邏輯、限流或內容渲染 ——
 * 那些既有四套已涵蓋，重複一次只會讓本套變慢、變脆，而且壞掉時指不出原因。
 *
 * **兩項失效模式會把使用者送去別的網站**（轉址目的地、頁面資料請求），
 * 而畫面上只呈現為「怪怪的」—— 這正是本套存在的理由：它們在畫面上都看不出來。
 *
 * `baseUrl` 由 `basepathSetup.ts` 提供且**不含前綴**，前綴由本檔自行拼接 ——
 * 若 `baseUrl` 就含前綴，即使前綴完全失效，下面四個案例仍會全綠。
 */

const BASE_PATH = '/novelsite';

function baseUrl(): string {
  return inject('baseUrl');
}

/** 本檔自帶最小 fetch，MUST NOT 改 `helpers/client.ts`（那是既有四套的，SC-019） */
function raw(path: string, init: RequestInit & { ip: string; cookie?: string }): Promise<Response> {
  const { ip, cookie, headers, ...rest } = init;
  const finalHeaders = new Headers(headers);
  finalHeaders.set('X-Forwarded-For', ip);
  if (cookie) finalHeaders.set('Cookie', cookie);
  if (!finalHeaders.has('origin')) finalHeaders.set('Origin', baseUrl());
  return fetch(`${baseUrl()}${path}`, { ...rest, headers: finalHeaders, redirect: 'manual' });
}

describe('FR-078：站台部署於子路徑下，框架管不到的五處', () => {
  /**
   * *裁示（2026-08-15）*：契約 §5 的案例寫 `GET {base}/novelsite/ → 200`，
   * 但**帶尾斜線的實測結果是 308**（Next 的尾斜線正規化：`/novelsite/` → `/novelsite`）。
   * 站台本身是好的，錯的是期望值。故本案例改打**不帶尾斜線**的 `/novelsite` ——
   * 那才是首頁的實際位址。
   *
   * 尾斜線那一版一併保留為第二個斷言：它證明 308 的目的地**帶前綴**
   * （轉址掉前綴正是 FR-073 要抓的失效，而正規化轉址同樣經過那條路徑）。
   */
  it('首頁可達：帶前綴的根路徑回 200，尾斜線正規化的目的地亦帶前綴', async () => {
    const res = await raw(BASE_PATH, { method: 'GET', ip: '10.78.1.1' });
    expect(res.status).toBe(200);

    const trailing = await raw(`${BASE_PATH}/`, { method: 'GET', ip: '10.78.1.2' });
    expect(trailing.status).toBe(308);
    const location = new URL(trailing.headers.get('location')!, baseUrl());
    expect(location.pathname).toBe(BASE_PATH);
  });

  /**
   * `proxy.ts` 的兩處轉址（FR-073）。`new URL('/auth/login', request.url)` 會從 **origin**
   * 重新解析，前綴就掉了 —— 使用者被送去網域根目錄下的**別的站**，而本站看起來一切正常。
   *
   * `next` 參數**不含**前綴：`nextUrl.pathname` 本身已被 Next 剝除前綴，
   * 登入後由框架加回去。這裡一併斷言，是因為「把前綴補進 next」是修這個 bug 時
   * 最容易順手做錯的事，而做錯的結果是登入後跳到 `/novelsite/novelsite/author/dashboard`。
   */
  it('轉址目的地帶前綴，且 next 參數不含前綴', async () => {
    const res = await raw(`${BASE_PATH}/author/dashboard`, { method: 'GET', ip: '10.78.2.1' });
    expect(res.status).toBe(302);

    const location = res.headers.get('location');
    expect(location, '未登入存取受保護頁面應轉址至登入頁').toBeTruthy();

    const url = new URL(location!, baseUrl());
    expect(url.pathname.startsWith(`${BASE_PATH}/auth/login`)).toBe(true);
    expect(url.searchParams.get('next')).toBe('/author/dashboard');
  });

  /**
   * 頁面資料請求（FR-074）。**兩個方向都要驗**：
   * 只驗「帶前綴回 200」時，一個根本沒套用 `basePath` 的建置也會通過
   * （那時兩個路徑都是 200），而那正是要抓的失敗。
   */
  it('API 端點只在前綴之下可達，網域根目錄下為 404', async () => {
    const withPrefix = await raw(`${BASE_PATH}/api/health`, { method: 'GET', ip: '10.78.3.1' });
    expect(withPrefix.status).toBe(200);

    const withoutPrefix = await raw('/api/health', { method: 'GET', ip: '10.78.3.2' });
    expect(withoutPrefix.status, '不帶前綴仍可達，代表 basePath 根本沒生效').toBe(404);
  });

  /**
   * 工作階段憑證的範圍（FR-076）。**簽發與清除 MUST 是同一個 `Path`**：
   * 兩者不同時瀏覽器會當成兩個 Cookie，**使用者按了登出卻沒登出**，
   * 而畫面上登出是成功的（伺服器端確實回 200）。
   */
  it('登入與登出的 Cookie 為同一個帶前綴的 Path', async () => {
    await resetAuthTables();
    const email = 'basepath-cookie@example.com';
    const password = 'BasePath1';
    await createUser({ email, role: 'reader', password });

    const loginRes = await raw(`${BASE_PATH}/api/auth/login`, {
      method: 'POST',
      ip: '10.78.4.1',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    expect(loginRes.status).toBe(200);

    const setCookie = loginRes.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();
    expect(setCookie!).toContain(`Path=${BASE_PATH}`);

    const logoutRes = await raw(`${BASE_PATH}/api/auth/logout`, {
      method: 'POST',
      ip: '10.78.4.1',
      cookie: setCookie!.split(';')[0],
    });
    expect(logoutRes.status).toBe(200);

    const clearCookie = logoutRes.headers.get('set-cookie');
    expect(clearCookie).toBeTruthy();
    expect(clearCookie!, '清除時的 Path 與簽發不同，瀏覽器會當成兩個 Cookie').toContain(
      `Path=${BASE_PATH}`
    );
  });
});
