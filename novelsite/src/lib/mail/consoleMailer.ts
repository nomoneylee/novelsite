/**
 * `MAIL_MODE=console`：不對外送信，把收件人／主旨／**全文（含重設連結）**印到伺服器主控台
 * （FEAT-5 FR-002a，contracts/internal-modules.md §2）
 *
 * **印全文不違反 FR-004**：該條的對象是「寄送嘗試的**記錄**」（`log.ts` 的 `logMailAttempt()`），
 * 而這支實作的**存在目的**就是把連結給開發者看——沒有它，本機就走不到「設定新密碼」頁，
 * SC-014「零外部帳號即可驗證」不成立。
 *
 * 此輸出 MUST 只在 `MAIL_MODE=console` 發生；`MAIL_MODE=production` 下本類別根本不會被建構
 * （把關見 `tests/unit/mailLog.test.ts`）。
 */
import type { Mailer, MailMessage } from './types';

export class ConsoleMailer implements Mailer {
  async send(message: MailMessage): Promise<void> {
    console.log(
      [
        '[mail:console] ── 以下內容不會真的寄出 ──',
        `to: ${message.to}`,
        `subject: ${message.subject}`,
        ...(message.replyTo === undefined ? [] : [`replyTo: ${message.replyTo}`]),
        '',
        message.text,
        '[mail:console] ── 結束 ──',
      ].join('\n')
    );
  }
}
