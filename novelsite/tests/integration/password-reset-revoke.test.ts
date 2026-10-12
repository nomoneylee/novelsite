/**
 * 重設與既有工作階段／既有憑證的互相作廢（FEAT-5 T021，SC-004／FR-011／FR-012）
 * ==========================================================================
 * 兩個方向，兩者都是「一把還能用的鑰匙留在外面」的形狀：
 *   (a) **重設成功 → 既有 Cookie 全數失效**（FR-012／SC-004）。
 *       帳號被盜用時，重設密碼的意義就是把入侵者踢出去；不撤銷 session 的話
 *       入侵者手上那張 Cookie 照樣能用，重設等於沒做。
 *   (b) **使用者自行改密碼 → 其未使用的重設憑證一併作廢**（FR-011）。
 *       少了這一條，一封還在有效期內的舊重設信可以**覆寫使用者剛改好的新密碼**。
 *
 * 本檔專屬位址前綴：`10.114.*`
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { changePassword } from '@/lib/services/authService';
import { testFetch, loginAs } from '../helpers/client';
import { createUser } from '../helpers/fixtures';
import { resetAuthTables } from '../helpers/resetAuthTables';
import { clearOutbox, waitForMail, extractResetToken } from '../helpers/outbox';

const RESET_USER = 'feat5-revoke-reset@example.com';
const CHANGE_USER = 'feat5-revoke-change@example.com';
const PASSWORD = 'RevokePass123';

let changeUserId: string;

function requestReset(email: string, ip: string) {
  return testFetch('/api/auth/password-reset/request', {
    method: 'POST',
    ip,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
}

function confirmReset(token: string, password: string, ip: string) {
  return testFetch('/api/auth/password-reset/confirm', {
    method: 'POST',
    ip,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password }),
  });
}

/**
 * 申請一次並取回該封信中的憑證明碼。
 *
 * `previous` MUST 在同一個信箱申請第二次時傳入：`waitForMail` 只認第一封符合條件的信，
 * 不排除舊的那一封時它會立刻命中舊憑證，而舊憑證已經作廢 ——
 * 測試會紅在一個與被測規則無關的地方。
 */
async function requestAndGetToken(email: string, ip: string, previous?: string): Promise<string> {
  const res = await requestReset(email, ip);
  expect(res.status).toBe(200);
  const mail = await waitForMail(
    (entry) =>
      entry.to.toLowerCase() === email &&
      (previous === undefined || extractResetToken(entry.text) !== previous)
  );
  return extractResetToken(mail.text);
}

beforeAll(async () => {
  await resetAuthTables();
  await clearOutbox();
  await createUser({ email: RESET_USER, role: 'reader', password: PASSWORD });
  const changeUser = await createUser({ email: CHANGE_USER, role: 'reader', password: PASSWORD });
  changeUserId = changeUser.id;
});

/** (a) 第一則用掉的憑證；第二則要靠它辨認「新的那一封」 */
let firstResetToken: string;

describe('(a) 重設成功後既有工作階段全數失效（SC-004／FR-012）', () => {
  it('重設前可用的 Cookie，重設後回 401', async () => {
    const cookie = await loginAs(RESET_USER, PASSWORD, '10.114.1.1');
    const before = await testFetch('/api/auth/me', { method: 'GET', ip: '10.114.1.1', cookie });
    expect(before.status).toBe(200);

    const token = await requestAndGetToken(RESET_USER, '10.114.1.2');
    firstResetToken = token;
    const confirmed = await confirmReset(token, 'RevokeNew456', '10.114.1.3');
    expect(confirmed.status).toBe(200);

    const after = await testFetch('/api/auth/me', { method: 'GET', ip: '10.114.1.1', cookie });
    expect(after.status).toBe(401);
  });

  it('重設後 MUST NOT 自動登入（回應不簽發新的工作階段 Cookie）', async () => {
    // 剛剛才「撤銷全部 session」，當下立刻簽發一張新的與 FR-012 的意圖相左；
    // 使用者應被導回登入頁以新密碼登入（Acceptance Scenario 2）
    const token = await requestAndGetToken(RESET_USER, '10.114.2.1', firstResetToken);
    const res = await confirmReset(token, 'RevokeNew789', '10.114.2.2');
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});

describe('(b) 自行改密碼時未使用的重設憑證一併作廢（FR-011）', () => {
  it('改密碼之後，先前申請的重設連結回 400 INVALID_TOKEN', async () => {
    const token = await requestAndGetToken(CHANGE_USER, '10.114.3.1');

    // 走伺服器端的改密碼函式（比照 change-password-revoke.test.ts）
    await changePassword(changeUserId, PASSWORD, 'RevokeChanged456');

    const res = await confirmReset(token, 'RevokeStale789', '10.114.3.2');
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('INVALID_TOKEN');
  });

  it('使用者剛設定的新密碼仍然有效（舊重設信沒有覆寫它）', async () => {
    const cookie = await loginAs(CHANGE_USER, 'RevokeChanged456', '10.114.3.3');
    const me = await testFetch('/api/auth/me', { method: 'GET', ip: '10.114.3.3', cookie });
    expect(me.status).toBe(200);
  });
});
