import 'server-only';
import { env } from '@/lib/env';
import { logSecurityEvent } from '@/lib/auth/audit';
import { rateLimitStore } from '@/lib/auth/rateLimit';
import { mailer } from '@/lib/mail';
import { logMailAttempt } from '@/lib/mail/log';
import { contactMail } from '@/lib/mail/templates';
import { MailSendError } from '@/lib/mail/types';
import { ServiceError, parseOrThrow } from '@/lib/services/errors';
import type { RequestCtx } from '@/lib/services/authService';
import { contactSchema } from '@/lib/validation/contact';

/**
 * 聯絡表單（FEAT-5 5-C，contracts/contact-api.md）
 * ==============================================
 * **寄送是同步的 `await`，與密碼重設刻意相反**：那一刀的回應必須永遠一樣
 * （任何差異都是帳號枚舉管道），故它把寄送丟進 `after()` 並吞掉例外；
 * 這裡沒有帳號存在性可洩漏，而**使用者必須知道訊息到底出去了沒有**（FR-020／FR-021）。
 * 用 `after()` 就只能一律回 200 —— 那正是站上禁止的假成功。
 *
 * 執行順序見 contracts §1.5：限流 → Zod（含 honeypot）→ 寄送。
 * **限流 MUST 早於寄送**：擋在寄完之後等於沒擋。
 */

const HOUR_MS = 3_600_000;

export async function sendContactMessage(input: unknown, ctx: RequestCtx): Promise<void> {
  // 位址鍵 3 次/小時（FR-018）。未登入端點只有這一個可用的鍵 ——
  // 沒有它，任何人都能讓營運信箱在幾分鐘內收到上萬封由本站寄出的信，
  // 而先耗盡的是寄件網域的信譽，不是營運者的耐性
  const limit = await rateLimitStore.hit(`contact:ip:${ctx.ip}`, HOUR_MS, env.CONTACT_RATE_IP_MAX);
  if (!limit.allowed) {
    logSecurityEvent({ event: 'contact.rate_limited', ip: ctx.ip, result: 'ip_limited' });
    throw new ServiceError('RATE_LIMITED', '送出次數過於頻繁，請稍後再試', {
      retryAfterSeconds: limit.retryAfterSeconds,
    });
  }

  // honeypot 命中在此與一般欄位錯誤走同一條路（400 `VALIDATION_ERROR`）：
  // 為了騙機器人而另開一個「回報成功但什麼也沒做」的分支，代價是往後每個讀這段的人
  // 都要重新判斷它是不是 bug（research R-10）
  const data = parseOrThrow(contactSchema, input);

  const message = contactMail(data);
  try {
    await mailer.send(message);
    logMailAttempt({ mode: env.MAIL_MODE, message, result: 'sent' });
  } catch (err) {
    logMailAttempt({
      mode: env.MAIL_MODE,
      message,
      result: 'failed',
      errorCode: err instanceof MailSendError ? err.cause : 'UNKNOWN',
    });
    // 訊息沒出去，故 MUST 給得出下一步 —— 失敗提示會連同這句話顯示可直接來信的位址
    throw new ServiceError('MAIL_FAILED', '訊息寄送失敗，請改用下方信箱直接來信');
  }
}
