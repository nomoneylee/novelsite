/**
 * 重設申請的限流（FEAT-5 T022，SC-012／FR-005／FR-005a）
 * ====================================================
 * 兩個案例：
 *   (a) 對**已註冊** Email 的第 4 次申請回 429，且 outbox 只有 3 封（SC-012）；
 *   (b) 對**未註冊** Email 的第 4 次申請**同樣**回 429 —— FR-005
 *       「帳號鍵 MUST 對所有送入的 Email 一律計數，MUST NOT 只對存在的帳號計數」的唯一把關。
 *
 * **沒有 (b)，一個「只對存在帳號計數」的實作會全綠**，而那正是一條枚舉管道：
 * 未註冊者第 4 次回 200、已註冊者回 429，**差異本身就洩漏帳號存在性**。
 *
 * **兩個案例 MUST 各用一個互不相同的位址**：位址鍵是 5 次/分鐘（沿用 `LOGIN_RATE_IP_MAX`），
 * 八次請求走同一個位址會在第 6 次被**位址鍵**擋下 —— (b) 於是拿到一個與帳號鍵無關的 429，
 * **測試會為了錯的理由變綠**。
 *
 * **MUST NOT 加任何限流重置機制**（FR-005a）：帳號鍵是 3 次/小時，
 * 隔離靠的是「每個案例各用一個專屬 Email」這件事本身。
 *
 * 本檔專屬位址前綴：`10.115.*`
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { env } from '@/lib/env';
import { testFetch } from '../helpers/client';
import { createUser } from '../helpers/fixtures';
import { resetAuthTables } from '../helpers/resetAuthTables';
import { clearOutbox, readOutbox } from '../helpers/outbox';

const REGISTERED = 'feat5-ratelimit-registered@example.com';
const UNREGISTERED = 'feat5-ratelimit-missing@example.com';

/** (a) 專用位址 */
const IP_REGISTERED = '10.115.1.1';
/** (b) 專用位址，MUST 與上者不同（否則 (b) 的 429 來自位址鍵而非帳號鍵） */
const IP_UNREGISTERED = '10.115.2.1';

function requestReset(email: string, ip: string) {
  return testFetch('/api/auth/password-reset/request', {
    method: 'POST',
    ip,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
}

async function countMailsTo(email: string): Promise<number> {
  return (await readOutbox()).filter((entry) => entry.to.toLowerCase() === email).length;
}

/** 輪詢至該信箱累積 n 封（寄送在回應之後，回應拿到 200 的當下 outbox 還是空的） */
async function waitForMailCount(email: string, n: number, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if ((await countMailsTo(email)) >= n) return;
    if (Date.now() >= deadline) {
      throw new Error(
        `waitForMailCount：${timeoutMs}ms 內 ${email} 只收到 ${await countMailsTo(email)} 封，預期 ${n} 封`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

beforeAll(async () => {
  await resetAuthTables();
  await clearOutbox();
  await createUser({ email: REGISTERED, role: 'reader', password: 'RatePass123' });
});

describe('(a) 已註冊 Email：第 4 次申請被帳號鍵擋下（SC-012）', () => {
  it('前 3 次回 200、第 4 次回 429 + Retry-After', async () => {
    expect(env.PASSWORD_RESET_RATE_ACCOUNT_MAX).toBe(3);

    for (let i = 0; i < env.PASSWORD_RESET_RATE_ACCOUNT_MAX; i++) {
      const res = await requestReset(REGISTERED, IP_REGISTERED);
      expect(res.status, `第 ${i + 1} 次申請`).toBe(200);
    }

    const blocked = await requestReset(REGISTERED, IP_REGISTERED);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).not.toBeNull();
    expect((await blocked.json()).error.code).toBe('RATE_LIMITED');
  });

  it('outbox 只有 3 封（被擋下的那一次沒有寄出任何東西）', async () => {
    await waitForMailCount(REGISTERED, 3);
    // 第 4 封若存在，是在被擋下之後才寄的；等一個寄送延遲的餘裕再數，否則「還沒寄到」與「沒寄」分不開
    await new Promise((resolve) => setTimeout(resolve, env.MAIL_MEMORY_DELAY_MS * 2 + 500));
    expect(await countMailsTo(REGISTERED)).toBe(3);
  });
});

describe('(b) 未註冊 Email：第 4 次申請同樣被擋下（FR-005）', () => {
  it('回應與已註冊者一致的 429，帳號鍵對不存在的帳號一律計數', async () => {
    for (let i = 0; i < env.PASSWORD_RESET_RATE_ACCOUNT_MAX; i++) {
      const res = await requestReset(UNREGISTERED, IP_UNREGISTERED);
      expect(res.status, `第 ${i + 1} 次申請`).toBe(200);
    }

    const blocked = await requestReset(UNREGISTERED, IP_UNREGISTERED);
    expect(
      blocked.status,
      '未註冊者第 4 次仍回 200 表示帳號鍵只對存在的帳號計數 —— 429 與 200 的差異本身就是枚舉管道'
    ).toBe(429);
    expect(blocked.headers.get('retry-after')).not.toBeNull();
    expect((await blocked.json()).error.code).toBe('RATE_LIMITED');
  });

  it('未註冊者全程零寄送', async () => {
    expect(await countMailsTo(UNREGISTERED)).toBe(0);
  });
});
