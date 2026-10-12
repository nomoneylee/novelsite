/**
 * 郵件寄送的薄介面（FEAT-5，contracts/internal-modules.md §1）
 * ===========================================================
 * **這個介面存在的唯一理由**：整合與 a11y 測試會實際啟動伺服器並打真實 HTTP，
 * 沒有可替換的實作就會在每次跑測試時真的往外寄信（FR-002；理由與 `RateLimitStore` 相同）。
 */

export interface MailMessage {
  to: string;
  subject: string;
  /**
   * 純文字。**MUST NOT 有 `html` 欄位**（research R-12）：
   * 聯絡表單的本文是未登入者提供的任意字串，組成 HTML 就是一個注入面；
   * 而 FR-016 要求的三件事（繁中、載明有效期、「若非本人申請可忽略」）純文字全部承載得了。
   */
  text: string;
  /** 回覆位址。只有聯絡表單用（FR-019：這是**回覆**位址，不是寄送對象） */
  replyTo?: string;
}

export interface Mailer {
  /**
   * 成功即 resolve；失敗一律擲 `MailSendError`，**MUST NOT 回傳布林**。
   *
   * 兩個呼叫端對失敗的處置完全相反（密碼重設吞掉只記錄、聯絡表單回 502），
   * 回布林會讓「忘了檢查」變成靜默成功——而靜默成功正是本站明文禁止的那件事（FR-020）。
   */
  send(message: MailMessage): Promise<void>;
}

export class MailSendError extends Error {
  /**
   * HTTP 狀態碼或底層 error 名稱。
   * **MUST NOT 含回應內容**——那可能帶收件人，而收件人不得進入任何記錄（FR-004／FR-007）。
   */
  readonly cause: string;

  constructor(cause: string) {
    super(`郵件寄送失敗（${cause}）`);
    this.name = 'MailSendError';
    this.cause = cause;
  }
}
