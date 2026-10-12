/**
 * 聯絡表單的位址限流（FEAT-5 T047，FR-018）
 * ========================================
 * 這是站上**唯一未登入即可觸發對外寄送**的端點：沒有限流，任何人都能讓營運信箱在幾分鐘內
 * 收到上萬封信，而那些信全部由本站寄出 —— 寄件網域的信譽會先於營運者的耐性耗盡。
 *
 * 額度為 `CONTACT_RATE_IP_MAX`（3 次/小時/位址）。
 * **MUST NOT 加任何限流重置機制**（FR-005a）：隔離靠的是「本檔專屬位址」這件事本身。
 *
 * outbox 的計數以本檔專屬的 `replyTo` 篩選，**不以總筆數判斷**：
 * 收件人一律是 `CONTACT_EMAIL`，與其他檔案的信混在同一個落地檔裡分不開。
 *
 * 本檔專屬位址前綴：`10.121.*`
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { env } from '@/lib/env';
import { testFetch } from '../helpers/client';
import { clearOutbox, readOutbox } from '../helpers/outbox';

const IP = '10.121.1.1';
const FORM_EMAIL = 'feat5-contact-ratelimit@example.com';

function sendContact(index: number) {
  return testFetch('/api/contact', {
    method: 'POST',
    ip: IP,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: '限流案例',
      email: FORM_EMAIL,
      message: `第 ${index} 次送出的測試訊息，內容長度足以通過下限檢查。`,
      website: '',
    }),
  });
}

async function countSentByThisFile(): Promise<number> {
  return (await readOutbox()).filter((entry) => entry.replyTo === FORM_EMAIL).length;
}

beforeAll(async () => {
  await clearOutbox();
});

describe('POST /api/contact 同一位址第 4 次送出被擋下（FR-018）', () => {
  it('前 3 次回 200、第 4 次回 429 + Retry-After', async () => {
    expect(env.CONTACT_RATE_IP_MAX).toBe(3);

    for (let i = 1; i <= env.CONTACT_RATE_IP_MAX; i++) {
      const res = await sendContact(i);
      expect(res.status, `第 ${i} 次送出`).toBe(200);
    }

    const blocked = await sendContact(env.CONTACT_RATE_IP_MAX + 1);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).not.toBeNull();
    expect((await blocked.json()).error.code).toBe('RATE_LIMITED');
  });

  /**
   * 寄送是同步的，故 200 到手時信已落地 —— 被擋下的那一次若也寄了，這裡就會數到 4。
   * **限流 MUST 早於寄送**：擋在寄完之後等於沒擋。
   */
  it('outbox 只有 3 封（被擋下的那一次沒有寄出任何東西）', async () => {
    expect(await countSentByThisFile()).toBe(env.CONTACT_RATE_IP_MAX);
  });
});
