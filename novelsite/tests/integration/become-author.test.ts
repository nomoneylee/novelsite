import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '@/lib/db';
import { testFetch, loginAs } from '../helpers/client';
import { callAction, hasErrorCode } from '../helpers/serverAction';
import { createUser } from '../helpers/fixtures';
import { resetAuthTables } from '../helpers/resetAuthTables';

/**
 * US3 AC4／AC5、FR-023、research R-12：自助開通作者。
 *
 * 三件事必須同時成立，少一件這個功能就是壞的：
 *   1. **其他裝置的舊憑證失效** —— 角色升級是身分變更，舊憑證帶的是過期的角色快照
 *   2. **當前裝置無須重新登入** —— 撤銷之後 MUST 立刻補發，否則使用者按下「成為作者」
 *      的結果是被登出，那看起來像操作失敗
 *   3. 已是作者／管理員再次呼叫回 `CONFLICT`，且角色與工作階段**不變**
 *
 * 第 2 點只能靠回應的 `Set-Cookie` 驗證 —— 這也是 `callAction` 要回傳該標頭的原因。
 */

const ROUTE = '/profile/settings';
const EMAIL = 'become-author-1@example.com';
const PASSWORD = 'Become1234';
const ADMIN_EMAIL = 'become-author-admin@example.com';

let userId: string;
/** 裝置 A（發動升級的那一台）與裝置 B（其他裝置） */
let cookieA: string;
let cookieB: string;
let reissued: string;

async function role(): Promise<string> {
  const row = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { role: true },
  });
  return row.role;
}

async function liveSessionCount(): Promise<number> {
  return prisma.session.count({ where: { userId, revokedAt: null } });
}

beforeAll(async () => {
  await resetAuthTables();
  const user = await createUser({ email: EMAIL, role: 'reader', password: PASSWORD });
  userId = user.id;

  cookieA = await loginAs(EMAIL, PASSWORD, '10.71.1.1');
  cookieB = await loginAs(EMAIL, PASSWORD, '10.71.1.2');
});

describe('前置：升級前是讀者，兩台裝置皆可用', () => {
  it('角色為 reader，且 /author/* 對兩台裝置皆轉址', async () => {
    expect(await role()).toBe('reader');

    for (const cookie of [cookieA, cookieB]) {
      const res = await testFetch('/author/dashboard', { method: 'GET', ip: '10.71.1.3', cookie });
      expect(res.status).toBe(302);
    }
    expect(await liveSessionCount()).toBe(2);
  });
});

describe('開通作者（US3 AC4／AC5、FR-023）', () => {
  it('成功後角色變為 author，且回應帶補發的工作階段 Cookie', async () => {
    const res = await callAction('becomeAuthorAction', [{ penName: '新科作者' }], {
      ip: '10.71.1.1',
      cookie: cookieA,
      route: ROUTE,
    });

    expect(res.status).toBe(200);
    expect(res.setCookie).toBeTruthy();
    reissued = res.setCookie!;

    const row = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { role: true, penName: true },
    });
    expect(row.role).toBe('author');
    expect(row.penName).toBe('新科作者');
  });

  it('**當前裝置無須重新登入**：以補發的 Cookie 可直接進 /author/*', async () => {
    const res = await testFetch('/author/dashboard', {
      method: 'GET',
      ip: '10.71.1.1',
      cookie: reissued,
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toContain('數據儀表板');
  });

  /**
   * 判準是 `/api/auth/me` 的 401（該路徑不在 proxy matcher 內，故驗到的是**工作階段本身**）。
   * 拿 `/author/dashboard` 當判準會誤導：裝置 B 的 JWT 帶的是升級前的 `reader` 角色快照，
   * proxy 會先以「角色不足」把它導向 `/`，看起來像被擋下了 ——
   * 但那證明的是舊快照，不是憑證已被撤銷。
   */
  it('**其他裝置的舊 Cookie 失效**：裝置 B 的憑證不再被承認', async () => {
    const me = await testFetch('/api/auth/me', { method: 'GET', ip: '10.71.1.2', cookie: cookieB });
    expect(me.status).toBe(401);

    const guarded = await testFetch('/author/dashboard', {
      method: 'GET',
      ip: '10.71.1.2',
      cookie: cookieB,
    });
    expect(guarded.status).not.toBe(200);
  });

  it('發動升級的那一台**舊** Cookie 同樣失效（撤銷是全部，補發是另一份憑證）', async () => {
    const res = await testFetch('/api/auth/me', {
      method: 'GET',
      ip: '10.71.1.1',
      cookie: cookieA,
    });
    expect(res.status).toBe(401);

    // 撤銷全部後只補發一份 → 有效工作階段恰為 1
    expect(await liveSessionCount()).toBe(1);
  });
});

describe('已具作者／管理員身分者回 CONFLICT 且不改變任何狀態（FR-023）', () => {
  it('作者再次呼叫回 CONFLICT，角色、筆名與工作階段皆不變', async () => {
    const before = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { role: true, penName: true },
    });
    const sessionsBefore = await liveSessionCount();

    const res = await callAction('becomeAuthorAction', [{ penName: '想再改一次的筆名' }], {
      ip: '10.71.1.1',
      cookie: reissued,
      route: ROUTE,
    });

    expect(hasErrorCode(res, 'CONFLICT')).toBe(true);
    expect(
      await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { role: true, penName: true },
      })
    ).toEqual(before);
    expect(await liveSessionCount()).toBe(sessionsBefore);
  });

  it('管理員呼叫同樣回 CONFLICT（MUST NOT 被降級為 author）', async () => {
    const admin = await createUser({ email: ADMIN_EMAIL, role: 'admin', password: PASSWORD });
    const adminCookie = await loginAs(ADMIN_EMAIL, PASSWORD, '10.71.1.4');

    const res = await callAction('becomeAuthorAction', [{ penName: '管理員筆名' }], {
      ip: '10.71.1.4',
      cookie: adminCookie,
      route: ROUTE,
    });

    expect(hasErrorCode(res, 'CONFLICT')).toBe(true);
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: admin.id },
      select: { role: true, penName: true },
    });
    expect(row.role).toBe('admin');
    expect(row.penName).toBeNull();
  });
});

describe('授權與驗證（FR-007、FR-023）', () => {
  /**
   * 不帶 Cookie 會被 proxy 以 302 攔在 Action 之前（`/profile/*` 在 matcher 內），
   * 那證明不了「Action 自己會擋」。改以「JWT 有效但工作階段已撤銷」製造
   * proxy 放行、Action 必須自驗的狀態（同 T018a）。
   */
  it('工作階段已撤銷 → UNAUTHENTICATED 且非 302（拒絕發生於 Action）', async () => {
    const email = 'become-author-revoked@example.com';
    const user = await createUser({ email, role: 'reader', password: PASSWORD });
    const cookie = await loginAs(email, PASSWORD, '10.71.1.5');
    await prisma.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    const res = await callAction('becomeAuthorAction', [{ penName: '路人甲' }], {
      ip: '10.71.1.5',
      cookie,
      route: ROUTE,
    });

    expect(res.status).not.toBe(302);
    expect(hasErrorCode(res, 'UNAUTHENTICATED'), res.text.slice(0, 300)).toBe(true);
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { role: true },
    });
    expect(row.role).toBe('reader');
  });

  it('筆名為空回 VALIDATION_ERROR，角色不變', async () => {
    const email = 'become-author-blank@example.com';
    const user = await createUser({ email, role: 'reader', password: PASSWORD });
    const cookie = await loginAs(email, PASSWORD, '10.71.1.6');

    const res = await callAction('becomeAuthorAction', [{ penName: '   ' }], {
      ip: '10.71.1.6',
      cookie,
      route: ROUTE,
    });

    expect(hasErrorCode(res, 'VALIDATION_ERROR')).toBe(true);
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { role: true },
    });
    expect(row.role).toBe('reader');
  });
});
