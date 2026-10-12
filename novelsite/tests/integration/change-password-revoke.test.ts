import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '@/lib/db';
import { testFetch } from '../helpers/client';
import { createUser } from '../helpers/fixtures';
import { resetAuthTables } from '../helpers/resetAuthTables';
import { loginAs } from '../helpers/client';
import { callAction, hasErrorCode } from '../helpers/serverAction';
import { changePassword } from '@/lib/services/authService';

beforeAll(async () => {
  await resetAuthTables();
});

describe('changePassword 撤銷全部工作階段（FR-032 案例 8、FR-041）', () => {
  it('呼叫伺服器端改密碼函式後，該使用者先前的工作階段全數失效，持舊 cookie 請求得 401', async () => {
    const email = 'change-password-1@example.com';
    const oldPassword = 'OldPass123';
    const user = await createUser({ email, role: 'reader', password: oldPassword });

    const cookie = await loginAs(email, oldPassword, '10.40.1.1');

    const beforeRes = await testFetch('/api/auth/me', { method: 'GET', ip: '10.40.1.1', cookie });
    expect(beforeRes.status).toBe(200);

    await changePassword(user.id, oldPassword, 'NewPass456');

    const afterRes = await testFetch('/api/auth/me', { method: 'GET', ip: '10.40.1.1', cookie });
    expect(afterRes.status).toBe(401);
  });
});

/**
 * FEAT-3 T080：US3 AC2／AC3 —— 同一條規則走**真正的使用者路徑**（Server Action）。
 *
 * 上面那一則呼叫的是伺服器端函式，證明得了服務層擋得住，證明不了
 * 個人設定頁按下「變更密碼」之後真的發生了同一件事。FEAT-1 的個人設定頁
 * 正是一個「按了有反應但什麼都沒做」的表單，這裡要防的就是那個形狀。
 */
const ROUTE = '/profile/settings';

describe('changePasswordAction：Action 路徑同樣撤銷全部工作階段（US3 AC2）', () => {
  const EMAIL = 'change-password-action@example.com';
  const OLD = 'ActionOld123';
  const NEW = 'ActionNew456';

  let userId: string;
  let deviceA: string;
  let deviceB: string;

  beforeAll(async () => {
    const user = await createUser({ email: EMAIL, role: 'reader', password: OLD });
    userId = user.id;
    deviceA = await loginAs(EMAIL, OLD, '10.40.6.1');
    deviceB = await loginAs(EMAIL, OLD, '10.40.6.2');
  });

  it('改密碼成功後，**含發動的那一台**在內的全部裝置皆失效（不補發）', async () => {
    const res = await callAction(
      'changePasswordAction',
      [{ currentPassword: OLD, newPassword: NEW }],
      { ip: '10.40.6.1', cookie: deviceA, route: ROUTE }
    );

    expect(res.status).toBe(200);
    // 開通作者會補發，改密碼**刻意不補發**（FR-026 的兩段文案因此不得混用）
    expect(res.setCookie).toBeNull();

    for (const [ip, cookie] of [
      ['10.40.6.1', deviceA],
      ['10.40.6.2', deviceB],
    ] as const) {
      const me = await testFetch('/api/auth/me', { method: 'GET', ip, cookie });
      expect(me.status).toBe(401);
    }
    expect(await prisma.session.count({ where: { userId, revokedAt: null } })).toBe(0);
  });

  it('必須以新密碼才能重新登入（舊密碼已不可用）', async () => {
    await expect(loginAs(EMAIL, OLD, '10.40.6.3')).rejects.toThrow();

    const fresh = await loginAs(EMAIL, NEW, '10.40.6.4');
    const me = await testFetch('/api/auth/me', { method: 'GET', ip: '10.40.6.4', cookie: fresh });
    expect(me.status).toBe(200);
  });
});

describe('錯誤的舊密碼不撤銷任何工作階段（US3 AC3）', () => {
  it('回 UNAUTHENTICATED，且原有工作階段照常可用', async () => {
    const email = 'change-password-wrong-old@example.com';
    const password = 'KeepMe1234';
    const user = await createUser({ email, role: 'reader', password });
    const cookie = await loginAs(email, password, '10.40.7.1');

    const res = await callAction(
      'changePasswordAction',
      [{ currentPassword: 'NotMyPassword9', newPassword: 'Whatever1234' }],
      { ip: '10.40.7.1', cookie, route: ROUTE }
    );

    expect(hasErrorCode(res, 'UNAUTHENTICATED')).toBe(true);
    expect(await prisma.session.count({ where: { userId: user.id, revokedAt: null } })).toBe(1);

    const me = await testFetch('/api/auth/me', { method: 'GET', ip: '10.40.7.1', cookie });
    expect(me.status).toBe(200);
  });

  /**
   * 不帶 Cookie 會被 proxy 以 302 攔在 Action 之前（`/profile/*` 在 matcher 內），
   * 那證明的是攔截層而非 Action。改以「JWT 有效但工作階段已撤銷」製造分岔：
   * proxy 只驗簽章會放行，Action 覆核 `Session` 資料列必須自己擋（同 T018a）。
   */
  it('工作階段已撤銷 → UNAUTHENTICATED 且非 302（FR-007，拒絕發生於 Action）', async () => {
    const email = 'change-password-revoked@example.com';
    const password = 'Revoked1234';
    const user = await createUser({ email, role: 'reader', password });
    const cookie = await loginAs(email, password, '10.40.7.2');
    await prisma.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    const res = await callAction(
      'changePasswordAction',
      [{ currentPassword: password, newPassword: 'Whatever1234' }],
      { ip: '10.40.7.2', cookie, route: ROUTE }
    );

    expect(res.status).not.toBe(302);
    expect(hasErrorCode(res, 'UNAUTHENTICATED'), res.text.slice(0, 300)).toBe(true);
  });
});
