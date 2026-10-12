/**
 * 密碼重設全程（FEAT-5 T017，arch.md §10.3 案例 23）
 * ================================================
 * 申請 → `waitForMail` 取 token → confirm → **新密碼登入成功、舊密碼 401**（SC-001）。
 *
 * 另斷言三件事：
 *   (a) 以憑證**明碼**查 `PasswordResetToken` 表回 **0 列**（FR-007「DB 內查無明碼」）；
 *   (b) 信件內文含**有效期分鐘數**與「若非本人申請可忽略本信」（FR-016）；
 *   (c) 重設連結的 host 等於 `SITE_URL`（FR-016a）。
 *
 * **送入的 Email 刻意用大小寫混合**（`FEAT5-Flow@Example.com` 對應 `feat5-flow@example.com`
 * 的帳號）：回應一律相同（FR-006），漏了正規化時「查不到帳號」的外觀與
 * 「這個 Email 沒註冊」**完全一樣** —— 沒有這個案例，正規化壞掉不會有任何測試變紅。
 *
 * 本檔專屬位址前綴：`10.110.*`
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { SITE_URL } from '@/lib/siteConfig';
import { testFetch, loginAs } from '../helpers/client';
import { createUser } from '../helpers/fixtures';
import { resetAuthTables } from '../helpers/resetAuthTables';
import { clearOutbox, waitForMail, extractResetToken } from '../helpers/outbox';

const EMAIL = 'feat5-flow@example.com';
/** 送入端點的是這一串：與帳號同一個信箱，但大小寫不同（FR-006 的正規化把關） */
const EMAIL_MIXED_CASE = 'FEAT5-Flow@Example.com';
const OLD_PASSWORD = 'FlowOld123';
const NEW_PASSWORD = 'FlowNew456';

let userId: string;
let plainToken: string;
let mailText: string;

beforeAll(async () => {
  await resetAuthTables();
  await clearOutbox();
  const user = await createUser({ email: EMAIL, role: 'reader', password: OLD_PASSWORD });
  userId = user.id;
});

describe('POST /api/auth/password-reset/request（申請）', () => {
  it('以大小寫混合的 Email 申請 → 200，且重設信寄達該帳號的信箱', async () => {
    const res = await testFetch('/api/auth/password-reset/request', {
      method: 'POST',
      ip: '10.110.1.1',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL_MIXED_CASE }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { ok: true } });

    // 寄送在回應之後（`after()`，FR-006a），故此處必須輪詢而非直接讀
    const mail = await waitForMail((entry) => entry.to.toLowerCase() === EMAIL);
    mailText = mail.text;
    plainToken = extractResetToken(mail.text);
    expect(plainToken.length).toBeGreaterThan(0);
  });

  it('(b) 信件內文含有效期分鐘數與「若非本人申請可忽略本信」（FR-016）', () => {
    // 分鐘數比對設定值而非寫死的 30：文案寫死時改了設定信上就會寫一個假的時間，
    // 而那件事使用者要等到連結提早失效才會發現
    expect(mailText).toContain(String(env.PASSWORD_RESET_TOKEN_TTL_MINUTES));
    expect(mailText).toContain('若這不是你本人的申請');
    expect(mailText).toContain('你的密碼不會有任何變動');
  });

  it('(c) 重設連結為絕對網址且 host 等於 SITE_URL（FR-016a）', () => {
    const link = /(https?:\/\/[^\s]+)/.exec(mailText)?.[1];
    expect(link, '內文中找不到絕對網址形式的重設連結').toBeDefined();
    const url = new URL(link!);
    expect(url.host).toBe(new URL(SITE_URL).host);
    expect(url.pathname).toBe('/auth/reset-password');
    expect(url.searchParams.get('token')).toBe(plainToken);
  });

  it('(a) 以憑證明碼查 PasswordResetToken 表回 0 列（FR-007：DB 內查無明碼）', async () => {
    // 兩條一起斷言：**只驗「明碼查不到」會在表根本是空的時候也綠**，
    // 而那正是「憑證沒建立、信也沒寄」的樣子。
    expect(await prisma.passwordResetToken.count({ where: { userId } })).toBe(1);
    expect(await prisma.passwordResetToken.count({ where: { tokenHash: plainToken } })).toBe(0);
  });
});

describe('POST /api/auth/password-reset/confirm（設定新密碼）', () => {
  it('憑證有效 → 200', async () => {
    const res = await testFetch('/api/auth/password-reset/confirm', {
      method: 'POST',
      ip: '10.110.2.1',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: plainToken, password: NEW_PASSWORD }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { ok: true } });
  });

  it('新密碼登入成功、舊密碼 401（SC-001：全程自助復原）', async () => {
    const cookie = await loginAs(EMAIL, NEW_PASSWORD, '10.110.3.1');
    const me = await testFetch('/api/auth/me', { method: 'GET', ip: '10.110.3.1', cookie });
    expect(me.status).toBe(200);

    const oldRes = await testFetch('/api/auth/login', {
      method: 'POST',
      ip: '10.110.3.2',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: OLD_PASSWORD }),
    });
    expect(oldRes.status).toBe(401);
  });
});
