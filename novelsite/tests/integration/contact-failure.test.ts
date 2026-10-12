/**
 * 聯絡表單寄送失敗時 MUST NOT 假成功（FEAT-5 T046，FR-020）
 * ========================================================
 * 本檔是 `arch.md` §8「誠實標示」在這一刀的**唯一證明路徑**：
 * 「不得假成功」這條規則**只在寄送真的失敗時才會被執行到**，
 * 沒有可觸發的手段就只能靠人工拔網路線驗證 —— 等於不驗。
 *
 * **觸發方式**：`memoryMailer` 於 `to` 或 `replyTo` 等於 `fail@outbox.invalid` 時擲
 * `MailSendError`（research R-16；**擴及 `replyTo` 是 T046 交付時的裁示，2026-08-10** ——
 * 聯絡信的收件人一律是 `CONTACT_EMAIL`，只看收件人的話這條分支永遠觸發不到，
 * 理由詳見 `memoryMailer.ts` 的 `isFailTarget()`）。
 * **這不是測試後門**：不繞過任何檢查、不改變任何門檻，
 * 且 `.invalid` 是 RFC 2606 保留 TLD，永遠不會是真實信箱。
 *
 * **502 而非 500**：失敗來自上游郵件服務，不是本站程式錯誤（contracts/contact-api §1.3）。
 *
 * 本檔專屬位址前綴：`10.120.*`
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { FAIL_RECIPIENT } from '@/lib/mail/memoryMailer';
import { testFetch } from '../helpers/client';
import { clearOutbox, readOutbox } from '../helpers/outbox';

let response: Response;
let bodyText: string;

beforeAll(async () => {
  await clearOutbox();

  response = await testFetch('/api/contact', {
    method: 'POST',
    ip: '10.120.1.1',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: '寄送失敗案例',
      email: FAIL_RECIPIENT,
      message: '這一則訊息預期寄送失敗，用於驗證畫面不得出現任何成功字樣。',
      website: '',
    }),
  });
  bodyText = await response.text();
});

describe('POST /api/contact 寄送失敗（FR-020）', () => {
  it('回 502 且錯誤碼為 MAIL_FAILED', () => {
    expect(response.status).toBe(502);
    expect(JSON.parse(bodyText).error.code).toBe('MAIL_FAILED');
  });

  /**
   * **成功與失敗 MUST 明確不同**（與密碼重設刻意相反）：
   * 那一刀之所以一律回同一句話，是因為回應本身會洩漏帳號存在性；
   * 這裡沒有任何東西可洩漏，而使用者必須知道訊息到底出去了沒有。
   */
  it('回應主體不含任何「已送出」「成功」字樣', () => {
    for (const claim of ['已送出', '成功', '已寄出']) {
      expect(bodyText, `失敗回應含「${claim}」—— 那正是站上明文禁止的假成功`).not.toContain(claim);
    }
  });

  it('錯誤訊息提供可改用的替代管道（訊息沒出去，使用者要有下一步）', () => {
    expect(JSON.parse(bodyText).error.message).toContain('直接來信');
  });

  it('outbox 零新增（失敗就是失敗，MUST NOT 留下一封「其實有寄」的信）', async () => {
    expect(await readOutbox()).toHaveLength(0);
  });
});
