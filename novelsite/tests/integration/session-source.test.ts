import { describe, it, expect, beforeAll } from 'vitest';
import { testFetch, loginAs } from '../helpers/client';
import { createUser } from '../helpers/fixtures';
import { resetAuthTables } from '../helpers/resetAuthTables';

beforeAll(async () => {
  await resetAuthTables();
});

/**
 * User Story 2 情境 7 的等價命題：伺服器端工作階段（簽章驗證 + DB 查詢）是唯一信任來源，
 * 任何客戶端可自行操縱的資料（自訂標頭、無關 Cookie、竄改過的憑證）一律不構成登入證明。
 * MUST NOT 寫成操作 localStorage 的測試 —— 整合測試發真實 HTTP 請求、無瀏覽器亦無本機儲存
 * （FR-014，見 tasks.md T053）。
 */
describe('伺服器端工作階段為唯一信任來源（FR-032 案例對應 User Story 2 情境 7）', () => {
  it('不帶任何 Cookie，即使夾帶宣稱已登入的自訂標頭，仍視為未登入', async () => {
    const res = await testFetch('/author/dashboard', {
      ip: '10.40.5.1',
      headers: { 'X-User-Role': 'admin', 'X-Authenticated': 'true', 'X-User-Id': 'fake-admin' },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/auth/login');
  });

  it('帶無關的 Cookie（非 novelsite_session）仍視為未登入', async () => {
    const res = await testFetch('/author/dashboard', {
      ip: '10.40.5.2',
      cookie: 'some_unrelated_cookie=admin; theme=dark',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/auth/login');
  });

  it('竄改過的憑證（簽章被破壞）視為未登入，即使結構仍是三段式 JWT', async () => {
    const email = 'session-source-tamper@example.com';
    await createUser({ email, role: 'admin', password: 'Admin12345' });
    const validCookie = await loginAs(email, 'Admin12345', '10.40.5.3');

    const [cookiePair] = validCookie.split(';');
    const [name, token] = cookiePair.split('=');
    const segments = token.split('.');
    // 竄改簽章段落中段字元，使驗簽必然失敗（保留三段式結構本身不構成信任依據）。
    // MUST NOT 竄改最後一個字元 —— base64url 編碼的簽章（32 bytes）最後一個字元只承載 4
    // 有效位元，部分字元置換後解碼結果不變，會使竄改「意外」通過驗簽（曾在此踩坑）。
    const lastSeg = segments[2];
    const idx = Math.floor(lastSeg.length / 2);
    const tamperedChar = lastSeg[idx] === 'A' ? 'B' : 'A';
    segments[2] = lastSeg.slice(0, idx) + tamperedChar + lastSeg.slice(idx + 1);
    const tamperedCookie = `${name}=${segments.join('.')}`;

    const res = await testFetch('/author/dashboard', { ip: '10.40.5.4', cookie: tamperedCookie });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/auth/login');
  });

  it('對照組：真正持有效憑證時可正常進入（證明前三案並非攔截層一律拒絕）', async () => {
    const email = 'session-source-valid@example.com';
    await createUser({ email, role: 'admin', password: 'Admin12345' });
    const cookie = await loginAs(email, 'Admin12345', '10.40.5.5');

    const res = await testFetch('/author/dashboard', { ip: '10.40.5.6', cookie });
    expect(res.status).toBe(200);
  });
});
