import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '@/lib/db';
import { testFetch, loginAs } from '../helpers/client';
import { callAction, hasErrorCode } from '../helpers/serverAction';
import { createUser } from '../helpers/fixtures';
import { resetAuthTables } from '../helpers/resetAuthTables';

/**
 * FR-024、US3 AC6：「登出所有裝置」。
 *
 * **三台裝置是必要的而非誇張**：兩台的話，「撤銷全部」與「撤銷當前以外」
 * 在結果上分不出來（前者剩 0、後者剩 1，但兩者都會讓「另一台」失效）。
 * 三台加上「發動的那一台自己也要失效」才能把兩種實作區分開。
 */

const ROUTE = '/profile/settings';
const EMAIL = 'revoke-all-1@example.com';
const PASSWORD = 'Revoke1234';

let userId: string;
let cookies: string[];

async function liveSessionCount(): Promise<number> {
  return prisma.session.count({ where: { userId, revokedAt: null } });
}

beforeAll(async () => {
  await resetAuthTables();
  const user = await createUser({ email: EMAIL, role: 'reader', password: PASSWORD });
  userId = user.id;

  cookies = [
    await loginAs(EMAIL, PASSWORD, '10.72.1.1'),
    await loginAs(EMAIL, PASSWORD, '10.72.1.2'),
    await loginAs(EMAIL, PASSWORD, '10.72.1.3'),
  ];
});

describe('前置：三台裝置皆登入且皆可用', () => {
  it('三份憑證都能通過受保護路由', async () => {
    for (const cookie of cookies) {
      const res = await testFetch('/api/auth/me', { method: 'GET', ip: '10.72.1.9', cookie });
      expect(res.status).toBe(200);
    }
    expect(await liveSessionCount()).toBe(3);
  });
});

describe('revokeSessionsAction 撤銷全部裝置（FR-024、US3 AC6）', () => {
  it('呼叫成功', async () => {
    const res = await callAction('revokeSessionsAction', [], {
      ip: '10.72.1.1',
      cookie: cookies[0],
      route: ROUTE,
    });
    expect(res.status).toBe(200);
  });

  it('**全部三份**憑證皆失效（含發動的那一台）', async () => {
    for (const cookie of cookies) {
      const me = await testFetch('/api/auth/me', { method: 'GET', ip: '10.72.1.9', cookie });
      expect(me.status).toBe(401);

      const guarded = await testFetch('/profile/settings', {
        method: 'GET',
        ip: '10.72.1.9',
        cookie,
      });
      // proxy 只驗 JWT 簽章（撤銷是資料列上的事，它看不到），故放行；
      // 擋下它的是頁面的 `requireUser()`，Server Component 的 redirect() 回 307 而非 302。
      // 判準是「有沒有被導向登入頁」，不是哪一個狀態碼 —— 綁死碼會把
      // 「被誰擋下的」寫進斷言，而那不是這一則要驗的事。
      expect([302, 307], `未轉址：${guarded.status}`).toContain(guarded.status);
      expect(guarded.headers.get('location')).toContain('/auth/login');
    }
  });

  it('`Session` 表無該使用者的有效列', async () => {
    expect(await liveSessionCount()).toBe(0);
  });

  it('以新密碼重新登入後可再次使用（撤銷不是封鎖帳號）', async () => {
    const fresh = await loginAs(EMAIL, PASSWORD, '10.72.1.4');
    const res = await testFetch('/api/auth/me', { method: 'GET', ip: '10.72.1.4', cookie: fresh });
    expect(res.status).toBe(200);
    expect(await liveSessionCount()).toBe(1);
  });
});

describe('授權（FR-007）', () => {
  /**
   * 不帶 Cookie 會被 proxy 以 302 攔在 Action 之前（`/profile/*` 在 matcher 內）。
   * 改以「JWT 有效但工作階段已撤銷」製造 proxy 放行、Action 必須自驗的狀態（同 T018a）。
   */
  it('工作階段已撤銷 → UNAUTHENTICATED 且非 302，不影響任何人的工作階段', async () => {
    const email = 'revoke-all-revoked@example.com';
    const victim = await createUser({ email, role: 'reader', password: PASSWORD });
    const cookie = await loginAs(email, PASSWORD, '10.72.1.5');
    await prisma.session.updateMany({
      where: { userId: victim.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    const before = await liveSessionCount();
    const res = await callAction('revokeSessionsAction', [], {
      ip: '10.72.1.5',
      cookie,
      route: ROUTE,
    });

    expect(res.status).not.toBe(302);
    expect(hasErrorCode(res, 'UNAUTHENTICATED'), res.text.slice(0, 300)).toBe(true);
    expect(await liveSessionCount()).toBe(before);
  });

  it('只撤銷呼叫者自己的工作階段，不波及其他使用者', async () => {
    const otherEmail = 'revoke-all-other@example.com';
    const other = await createUser({ email: otherEmail, role: 'reader', password: PASSWORD });
    const otherCookie = await loginAs(otherEmail, PASSWORD, '10.72.1.6');
    const mine = await loginAs(EMAIL, PASSWORD, '10.72.1.7');

    await callAction('revokeSessionsAction', [], {
      ip: '10.72.1.7',
      cookie: mine,
      route: ROUTE,
    });

    expect(await liveSessionCount()).toBe(0);
    expect(await prisma.session.count({ where: { userId: other.id, revokedAt: null } })).toBe(1);

    const stillOk = await testFetch('/api/auth/me', {
      method: 'GET',
      ip: '10.72.1.6',
      cookie: otherCookie,
    });
    expect(stillOk.status).toBe(200);
  });
});
