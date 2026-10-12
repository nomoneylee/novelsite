/**
 * 登入頁到得了忘記密碼流程（FEAT-5 T022b，FR-014）
 * ==============================================
 * a11y 套件的 `/auth/forgot-password` 目標只證明**那一頁存在**，
 * 不證明**登入頁到得了它** —— 兩者之間唯一的連結是一行 `href`，
 * 而沒有東西把關的「自然成立」，下一次改版就會斷掉。
 *
 * `arch.md` §7.2 原本明文禁止放任何「忘記密碼」入口（沒有可用流程時，入口就是假象）；
 * 該禁令於本階段解除的前提正是**流程真的可用**，故本檔一併斷言連結指向的那一頁回 200。
 *
 * 本檔專屬位址前綴：`10.117.*`
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { testFetch } from '../helpers/client';
import { resetAuthTables } from '../helpers/resetAuthTables';

let loginHtml: string;

beforeAll(async () => {
  await resetAuthTables();
  const res = await testFetch('/auth/login', { ip: '10.117.1.1' });
  expect(res.status).toBe(200);
  loginHtml = await res.text();
});

describe('GET /auth/login 的忘記密碼入口（FR-014）', () => {
  it('HTML 含指向 /auth/forgot-password 的連結', () => {
    expect(loginHtml).toMatch(/href="\/auth\/forgot-password"/);
  });

  it('該連結指向的頁面回 200（入口 MUST 導向真正可用的流程，非假象）', async () => {
    const res = await testFetch('/auth/forgot-password', { ip: '10.117.1.2' });
    expect(res.status).toBe(200);
  });
});
