/**
 * 寄送確實發生在回應之後（FEAT-5 T019，FR-006a）
 * ============================================
 * 本階段**最容易安靜失效**的一處：`after()` 沒生效時，重設信根本沒寄，
 * 而使用者看到的仍是那句一律相同的成功訊息（`deliver()` 吞掉一切例外）。
 * **畫面上看不出來，這支測試是唯一的證明。**
 *
 * 兩件事：
 *   (a) `waitForMail` 於逾時內命中 → `after()` 確實被執行（不是被吞掉、也不是根本沒排）；
 *   (b) 已註冊與未註冊兩種 Email 的**回應時間差 < 200ms**。
 *       `.env.test` 的 `MAIL_MEMORY_DELAY_MS=300` 是這道測試的**解析度**：
 *       同步寄送必然使已註冊那條路徑多花 ≥ 300ms，而 `after()` 生效時
 *       兩條路徑在回應時間上的天然差異只有數毫秒。設 0 該測試即失去鑑別力。
 *
 * 本檔專屬位址前綴：`10.112.*`
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { env } from '@/lib/env';
import { testFetch } from '../helpers/client';
import { createUser } from '../helpers/fixtures';
import { resetAuthTables } from '../helpers/resetAuthTables';
import { clearOutbox, waitForMail } from '../helpers/outbox';

const WARMUP = 'feat5-after-warmup@example.com';
const REGISTERED = 'feat5-after-registered@example.com';
const UNREGISTERED = 'feat5-after-missing@example.com';

/** 回傳「送出到收到回應標頭」的毫秒數 */
async function timedRequest(email: string, ip: string): Promise<{ status: number; ms: number }> {
  const started = performance.now();
  const res = await testFetch('/api/auth/password-reset/request', {
    method: 'POST',
    ip,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const ms = performance.now() - started;
  await res.text();
  return { status: res.status, ms };
}

let registeredMs: number;
let unregisteredMs: number;

beforeAll(async () => {
  await resetAuthTables();
  await clearOutbox();
  await createUser({ email: WARMUP, role: 'reader', password: 'AfterPass123' });
  await createUser({ email: REGISTERED, role: 'reader', password: 'AfterPass123' });

  // 暖機：第一次打這條路由含一次性的初始化成本，計入量測會讓時間差變成雜訊的量測
  await timedRequest(WARMUP, '10.112.1.1');
  await waitForMail((entry) => entry.to.toLowerCase() === WARMUP);

  const registered = await timedRequest(REGISTERED, '10.112.1.2');
  const unregistered = await timedRequest(UNREGISTERED, '10.112.1.3');
  expect(registered.status).toBe(200);
  expect(unregistered.status).toBe(200);
  registeredMs = registered.ms;
  unregisteredMs = unregistered.ms;
});

describe('(a) after() 確實被執行', () => {
  it('回應之後，重設信於逾時內出現在 outbox', async () => {
    const mail = await waitForMail((entry) => entry.to.toLowerCase() === REGISTERED);
    expect(mail.subject.length).toBeGreaterThan(0);
  });
});

describe('(b) 寄送不發生在回應之前（FR-006a）', () => {
  it('已註冊與未註冊的回應時間差 < 200ms（同步寄送必然 ≥ MAIL_MEMORY_DELAY_MS）', () => {
    expect(
      env.MAIL_MEMORY_DELAY_MS,
      'MAIL_MEMORY_DELAY_MS 為 0 時本測試失去鑑別力'
    ).toBeGreaterThanOrEqual(300);
    expect(Math.abs(registeredMs - unregisteredMs)).toBeLessThan(200);
  });

  it('已註冊的回應時間本身小於寄送延遲（回應沒有等待寄送完成）', () => {
    expect(registeredMs).toBeLessThan(env.MAIL_MEMORY_DELAY_MS);
  });
});
