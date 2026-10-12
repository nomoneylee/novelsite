/**
 * 密碼重設不洩漏帳號存在性（FEAT-5 T018，SC-002／FR-006）
 * =====================================================
 * 已註冊與未註冊的申請，回應的**狀態與主體逐位元組相同**，
 * 且未註冊者的 outbox **零新增**。
 *
 * **兩條要一起驗**：只驗回應相同時，「未註冊也照樣寄一封信出去」會全綠 ——
 * 那是把站台變成任意信箱的寄信機；只驗 outbox 時，回應形狀的差異
 * （例如未註冊回 `{ok:true}`、已註冊回 `{ok:true,sent:true}`）就是一條枚舉管道。
 *
 * 本檔專屬位址前綴：`10.111.*`
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { testFetch } from '../helpers/client';
import { createUser } from '../helpers/fixtures';
import { resetAuthTables } from '../helpers/resetAuthTables';
import { clearOutbox, readOutbox, waitForMail } from '../helpers/outbox';

const REGISTERED = 'feat5-enum-registered@example.com';
const UNREGISTERED = 'feat5-enum-missing@example.com';

function requestReset(email: string, ip: string) {
  return testFetch('/api/auth/password-reset/request', {
    method: 'POST',
    ip,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
}

let registeredRes: { status: number; body: string };
let unregisteredRes: { status: number; body: string };

beforeAll(async () => {
  await resetAuthTables();
  await clearOutbox();
  await createUser({ email: REGISTERED, role: 'reader', password: 'EnumPass123' });

  const res1 = await requestReset(REGISTERED, '10.111.1.1');
  registeredRes = { status: res1.status, body: await res1.text() };

  const res2 = await requestReset(UNREGISTERED, '10.111.1.2');
  unregisteredRes = { status: res2.status, body: await res2.text() };

  // 已註冊那一封確實寄達 —— 沒有這一步，「兩邊都沒寄」也會讓下方的零新增斷言全綠
  await waitForMail((entry) => entry.to.toLowerCase() === REGISTERED);
});

describe('已註冊 vs 未註冊的申請回應（SC-002）', () => {
  it('狀態碼相同且皆為 200', () => {
    expect(registeredRes.status).toBe(200);
    expect(unregisteredRes.status).toBe(registeredRes.status);
  });

  it('回應主體逐位元組相同', () => {
    expect(unregisteredRes.body).toBe(registeredRes.body);
  });
});

describe('未註冊的 Email 不觸發任何寄送', () => {
  it('outbox 中沒有任何寄往該位址的信件', async () => {
    const entries = await readOutbox();
    expect(entries.filter((e) => e.to.toLowerCase() === UNREGISTERED)).toHaveLength(0);
  });

  it('已註冊者恰有一封（證明上一則的零新增不是因為整個 outbox 都是空的）', async () => {
    const entries = await readOutbox();
    expect(entries.filter((e) => e.to.toLowerCase() === REGISTERED)).toHaveLength(1);
  });
});
