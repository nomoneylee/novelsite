/**
 * `MAIL_MODE=production`：實呼 Resend 的 HTTPS API（FEAT-5，research R-2）
 * =======================================================================
 * **MUST NOT 引入 `resend` SDK**：薄介面（`Mailer`）本來就已經把廠商隔在外面，
 * SDK 對本專案的用途只是包一個 `POST /emails`——多一個要跟著升級的相依，
 * 卻不減少任何一行我們要寫的程式碼（沿用「本階段不新增執行期依賴」的既有慣例）。
 */
import { env } from '@/lib/env';
import { MailSendError, type Mailer, type MailMessage } from './types';

const ENDPOINT = 'https://api.resend.com/emails';

/**
 * 逾時上界。`after()` 的背景工作會佔住 `next start` 關機時的 drain period（10–30 秒），
 * 沒有上界的 `fetch` 會讓一次卡住的寄送拖住整個關機流程。
 */
const TIMEOUT_MS = 10_000;

export class ResendMailer implements Mailer {
  async send(message: MailMessage): Promise<void> {
    let response: Response;
    try {
      response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: env.MAIL_FROM,
          to: [message.to],
          subject: message.subject,
          // 純文字單欄，無 html（research R-12）
          text: message.text,
          // `reply_to` 是 Resend 的線上格式；本站型別用的是 `replyTo`
          ...(message.replyTo === undefined ? {} : { reply_to: message.replyTo }),
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      // 連線失敗與逾時：只留 error 名稱（如 `TimeoutError`），MUST NOT 留訊息內容
      throw new MailSendError(error instanceof Error ? error.name : 'UNKNOWN');
    }

    if (!response.ok) {
      // 只留狀態碼。**MUST NOT 讀回應內容**——那可能帶收件人（FR-004）
      throw new MailSendError(`HTTP_${response.status}`);
    }
  }
}
