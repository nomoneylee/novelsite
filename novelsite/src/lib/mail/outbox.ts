/**
 * `memory` 模式的落地格式（FEAT-5，contracts/internal-modules.md §3、research R-6）
 * ================================================================================
 * 每行一筆 JSON（**JSON Lines**，追加寫入、不覆蓋）。
 *
 * **為什麼落到檔案而不是記憶體陣列**：整合測試與 a11y 測試都是**另一個行程**——
 * `tests/globalSetup.ts` 以 `next build` + `next start` 啟動測試伺服器，測試程式碼經 HTTP
 * 與它溝通。伺服器行程內的陣列在測試行程裡**永遠是空的**，而需要斷言收件人／主旨／連結的
 * 恰恰是這兩套（spec FR-002a 原文的「於記憶體收集」在本專案不可執行，已回寫上游）。
 */
import { appendFile } from 'node:fs/promises';
import { env } from '@/lib/env';
import type { MailMessage } from './types';

export interface OutboxEntry {
  at: string;
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
}

export async function appendToOutbox(message: MailMessage): Promise<void> {
  const entry: OutboxEntry = {
    at: new Date().toISOString(),
    to: message.to,
    subject: message.subject,
    text: message.text,
    ...(message.replyTo === undefined ? {} : { replyTo: message.replyTo }),
  };
  await appendFile(env.MAIL_OUTBOX_PATH, `${JSON.stringify(entry)}\n`, 'utf8');
}
