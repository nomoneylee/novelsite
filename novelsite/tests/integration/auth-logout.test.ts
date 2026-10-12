import { describe, it, expect, beforeAll } from 'vitest';
import { testFetch, loginAs } from '../helpers/client';
import { createUser } from '../helpers/fixtures';
import { resetAuthTables } from '../helpers/resetAuthTables';

beforeAll(async () => {
  await resetAuthTables();
});

describe('POST /api/auth/logout（FR-007、Edge Case 同一帳號多裝置登入）', () => {
  it('登出後該工作階段立即失效，持登出前憑證請求一律視為未登入', async () => {
    const email = 'logout-case-1@example.com';
    const password = 'LogoutPass1';
    await createUser({ email, role: 'reader', password });

    const cookie = await loginAs(email, password, '10.50.1.1');

    const logoutRes = await testFetch('/api/auth/logout', {
      method: 'POST',
      ip: '10.50.1.1',
      cookie,
    });
    expect(logoutRes.status).toBe(200);

    const afterRes = await testFetch('/api/auth/me', { method: 'GET', ip: '10.50.1.1', cookie });
    expect(afterRes.status).toBe(401);
  });

  it('另一裝置（另一次登入）的工作階段不受影響', async () => {
    const email = 'logout-case-2@example.com';
    const password = 'LogoutPass2';
    await createUser({ email, role: 'reader', password });

    const cookieDeviceA = await loginAs(email, password, '10.50.2.1');
    const cookieDeviceB = await loginAs(email, password, '10.50.2.2');

    const logoutRes = await testFetch('/api/auth/logout', {
      method: 'POST',
      ip: '10.50.2.1',
      cookie: cookieDeviceA,
    });
    expect(logoutRes.status).toBe(200);

    const deviceAAfter = await testFetch('/api/auth/me', {
      method: 'GET',
      ip: '10.50.2.1',
      cookie: cookieDeviceA,
    });
    expect(deviceAAfter.status).toBe(401);

    const deviceBAfter = await testFetch('/api/auth/me', {
      method: 'GET',
      ip: '10.50.2.2',
      cookie: cookieDeviceB,
    });
    expect(deviceBAfter.status).toBe(200);
  });
});
