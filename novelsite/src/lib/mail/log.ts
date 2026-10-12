/**
 * 寄送嘗試的記錄（FEAT-5，FR-004／FR-007，contracts/internal-modules.md §2）
 * ==========================================================================
 * 經既有的 `logSecurityEvent()` 輸出，**MUST NOT 含正文、重設連結或憑證明碼**。
 *
 * 本檔與 `consoleMailer.ts` 是**兩支不同的函式**，界線是 FR-004 與 FR-002a 的字面互斥處：
 *
 * | 函式 | 何時執行 | 內容 |
 * |---|---|---|
 * | `logMailAttempt()` | **每一種模式、每一次寄送** | mode／`sha256(收件人)` 前 8 碼／結果／錯誤碼 |
 * | `ConsoleMailer.send()` | **僅 `MAIL_MODE=console`** | 全文（存在目的就是把連結給開發者看） |
 */
import { createHash } from 'node:crypto';
import { logSecurityEvent } from '@/lib/auth/audit';
import type { MailMode } from '@/lib/env';
import type { MailMessage } from './types';

export interface MailAttempt {
  mode: MailMode;
  /**
   * 整封信。**刻意收整封而非只收收件人**：呼叫端手上就是這個物件，
   * 若要求它自己先摘出 `to`，遲早有人為了「除錯方便」把 `text` 也一起傳進來。
   * 本函式只讀 `message.to`，其餘欄位不可能進入輸出（同 `audit.ts` 既有的防呆做法）。
   */
  message: MailMessage;
  result: 'sent' | 'failed';
  /** 失敗時的 `MailSendError.cause`（HTTP 狀態或 error 名稱） */
  errorCode?: string;
}

/** `sha256(收件人)` 前 8 碼：足以在記錄裡串起同一位收件人的多次嘗試，且不可還原 */
function recipientDigest(to: string): string {
  return createHash('sha256').update(to).digest('hex').slice(0, 8);
}

export function logMailAttempt({ mode, message, result, errorCode }: MailAttempt): void {
  logSecurityEvent({
    event: 'mail.send',
    // `SecurityEvent` 的四個欄位是 FEAT-1 定下的固定形狀（見 audit.ts）。
    // 寄送發生在 `after()` 的背景工作內，**沒有請求來源位址**——填 '-' 而不是
    // 硬塞收件人雜湊，否則同一個欄位在不同事件裡代表不同東西，記錄就無法被機械解讀。
    ip: '-',
    result: `mode=${mode} to=${recipientDigest(message.to)} ${result}${
      errorCode ? ` code=${errorCode}` : ''
    }`,
  });
}
