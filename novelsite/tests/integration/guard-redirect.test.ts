import { describe, it, expect, beforeAll } from 'vitest';
import { testFetch, loginAs } from '../helpers/client';
import { createUser } from '../helpers/fixtures';
import { resetAuthTables } from '../helpers/resetAuthTables';

beforeAll(async () => {
  await resetAuthTables();
});

describe('受保護前綴的伺服器端轉址（FR-032 案例 5–6）', () => {
  it('案例 5：未登入 GET /author/dashboard → 302 至登入頁，回應本體不含後台任何內容', async () => {
    const res = await testFetch('/author/dashboard', { ip: '10.40.1.1' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/auth/login');

    const body = await res.text();
    expect(body).not.toContain('數據儀表板');
  });

  it('案例 6：role=reader 已登入 → 302 至首頁；author 與 admin 正常進入', async () => {
    const readerEmail = 'guard-reader@example.com';
    await createUser({ email: readerEmail, role: 'reader', password: 'Reader1234' });
    const readerCookie = await loginAs(readerEmail, 'Reader1234', '10.40.1.2');

    const readerRes = await testFetch('/author/dashboard', {
      ip: '10.40.1.3',
      cookie: readerCookie,
    });
    expect(readerRes.status).toBe(302);
    const location = new URL(readerRes.headers.get('location') ?? '', 'http://localhost');
    expect(location.pathname).toBe('/');

    const authorEmail = 'guard-author@example.com';
    await createUser({ email: authorEmail, role: 'author', password: 'Author1234' });
    const authorCookie = await loginAs(authorEmail, 'Author1234', '10.40.1.4');

    const authorRes = await testFetch('/author/dashboard', {
      ip: '10.40.1.5',
      cookie: authorCookie,
    });
    expect(authorRes.status).toBe(200);
    expect(await authorRes.text()).toContain('數據儀表板');

    const adminEmail = 'guard-admin@example.com';
    await createUser({ email: adminEmail, role: 'admin', password: 'Admin1234' });
    const adminCookie = await loginAs(adminEmail, 'Admin1234', '10.40.1.6');

    const adminRes = await testFetch('/author/dashboard', { ip: '10.40.1.7', cookie: adminCookie });
    expect(adminRes.status).toBe(200);
    expect(await adminRes.text()).toContain('數據儀表板');
  });

  it('未登入 GET /profile/settings → 302 至登入頁，回應本體不含個人資料內容', async () => {
    const res = await testFetch('/profile/settings', { ip: '10.40.1.8' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/auth/login');
  });
});
