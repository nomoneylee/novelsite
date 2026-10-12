import { describe, it, expect, beforeAll } from 'vitest';
import { testFetch } from '../helpers/client';
import { resetAuthTables } from '../helpers/resetAuthTables';

beforeAll(async () => {
  await resetAuthTables();
});

/**
 * 解析登入頁 RSC flight payload 中 LoginForm 的 redirectTo prop 值。
 * MUST NOT 用「body 是否含有外部網址字串」判斷 —— Next.js 的 flight router state 本就會把
 * 當前請求的完整查詢字串（含使用者傳入的原始 next 值）原樣回顯於 "c"/"q" 欄位作為路由狀態，
 * 這只是路由協定的必要回顯、不構成任何信任決策；真正決定「登入完成後導向何處」的是
 * LoginForm 收到的 redirectTo prop，故直接解析該值才是本案例的正確斷言對象（FR-017）。
 */
function extractRedirectTo(body: string): string | undefined {
  const match = body.match(/redirectTo\\?":\\?"([^\\"]*)/);
  return match?.[1];
}

describe('防開放轉址（FR-032 案例 8、FR-017）', () => {
  it('proxy.ts 轉址至登入頁時，Location 的 next 參數指向原始受保護路徑', async () => {
    const res = await testFetch('/author/novels', { ip: '10.40.4.1' });
    expect(res.status).toBe(302);
    const location = res.headers.get('location');
    expect(location).not.toBeNull();
    const url = new URL(location!, 'http://localhost');
    expect(url.pathname).toBe('/auth/login');
    expect(url.searchParams.get('next')).toBe('/author/novels');
  });

  it('登入頁的 next 參數為外部網址時，MUST 被忽略，redirectTo 落回站內預設頁', async () => {
    const res = await testFetch('/auth/login?next=https%3A%2F%2Fevil.example.com', {
      ip: '10.40.4.2',
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(extractRedirectTo(body)).toBe('/');
  });

  it('登入頁的 next 參數為合法站內路徑時，MUST 被保留並傳遞給表單（供完成登入後導向）', async () => {
    const marker = '/internal-redirect-marker-9f8ae2';
    const res = await testFetch(`/auth/login?next=${encodeURIComponent(marker)}`, {
      ip: '10.40.4.3',
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(extractRedirectTo(body)).toBe(marker);
  });

  it('next 參數為協定相對網址（//evil.example.com）同樣被忽略，redirectTo 落回站內預設頁', async () => {
    const res = await testFetch('/auth/login?next=%2F%2Fevil.example.com', { ip: '10.40.4.4' });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(extractRedirectTo(body)).toBe('/');
  });
});
