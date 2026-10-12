/**
 * `MAIL_MODE=memory`：不對外送信，寫入 outbox（FEAT-5，research R-6／R-16）
 */
import { setTimeout as delay } from 'node:timers/promises';
import { env } from '@/lib/env';
import { appendToOutbox } from './outbox';
import { MailSendError, type Mailer, type MailMessage } from './types';

/**
 * 觸發寄送失敗分支的保留收件人（research R-16）。
 *
 * **這不是繞過任何檢查的後門**：它不放寬任何門檻、不影響其他收件人，
 * 且 `.invalid` 是 RFC 2606 的保留 TLD，**永遠不會是真實信箱**。
 * FR-020「失敗時 MUST NOT 出現任何形式的成功提示」只在寄送真的失敗時才被執行到——
 * 沒有可觸發的手段，那條規則就只能靠人工拔網路線驗證，等於不驗。
 *
 * **MUST 僅存在於本檔**，MUST NOT 出現在 `resendMailer.ts`。
 */
export const FAIL_RECIPIENT = 'fail@outbox.invalid';

/**
 * **判定同時看 `to` 與 `replyTo`（FEAT-5 T046 裁示，2026-08-10）**。
 *
 * research R-16 與 `arch.md` §9 Phase 14 第 5 項原文寫的是「**收件人**等於
 * `fail@outbox.invalid` 時擲錯」，而**照那個字面，聯絡表單的失敗分支永遠觸發不到**：
 * 該封信的收件人一律是 `env.CONTACT_EMAIL`（FR-019 —— 表單填入的 Email 只作回覆位址），
 * 測試無從把收件人換成保留位址。把 `CONTACT_EMAIL` 整個設成保留位址亦不可行：
 * 那會使 `contact-send.test.ts` 連一封信都收不到。
 *
 * 於是 FR-020「MUST NOT 假成功」在**唯一會回報成功與失敗的那支表單上**沒有把關手段，
 * 而那正是 R-16 開這個機制的全部理由。
 *
 * 擴及 `replyTo` 不放寬任何門檻：`.invalid` 仍是 RFC 2606 保留 TLD，
 * 真實使用者填不出一個能收信的 `@outbox.invalid` 位址；密碼重設信不帶 `replyTo`，不受影響。
 */
function isFailTarget(message: MailMessage): boolean {
  return (
    message.to.toLowerCase() === FAIL_RECIPIENT || message.replyTo?.toLowerCase() === FAIL_RECIPIENT
  );
}

export class MemoryMailer implements Mailer {
  async send(message: MailMessage): Promise<void> {
    // 這個延遲是「寄送確實在回應之後」那道測試的解析度（`.env.test` 設 300ms）：
    // 同步寄送必然多花 ≥ 這麼久，after() 生效時則不會反映在回應時間上
    if (env.MAIL_MEMORY_DELAY_MS > 0) await delay(env.MAIL_MEMORY_DELAY_MS);

    if (isFailTarget(message)) {
      throw new MailSendError('MEMORY_FAIL_RECIPIENT');
    }

    await appendToOutbox(message);
  }
}
