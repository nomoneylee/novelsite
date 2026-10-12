/**
 * 郵件寄送的單一出口（FEAT-5，contracts/internal-modules.md §2）
 * =============================================================
 * 依 `env.MAIL_MODE` 選用實作，並匯出**單一** `mailer`。
 *
 * `import 'server-only'`（比照 `repositories/index.ts`）：`resendMailer` 讀 `RESEND_API_KEY`，
 * 一旦被 client component 引用，Next.js 會在建置期報錯，但**錯誤訊息不會提到憑證**。
 * 另有一條靜態稽核在 `tests/unit/layering.test.ts` 把原因寫成一句話（T015）。
 */
import 'server-only';
import { env, type MailMode } from '@/lib/env';
import { ConsoleMailer } from './consoleMailer';
import { MemoryMailer } from './memoryMailer';
import { ResendMailer } from './resendMailer';
import type { Mailer } from './types';

/**
 * 選用邏輯獨立成具名函式，**是為了讓「哪個模式選到哪支實作」有可被直接呼叫的斷言對象**
 * （`tests/unit/mailSelect.test.ts`）。若只有下方的 `mailer` 常數，唯一的測試方式是
 * 「重設模組快取 + 改寫 `process.env`」——那測的是模組載入時序，不是選用規則。
 */
export function createMailer(mode: MailMode): Mailer {
  switch (mode) {
    case 'production':
      return new ResendMailer();
    case 'memory':
      return new MemoryMailer();
    case 'console':
      return new ConsoleMailer();
  }
}

export const mailer: Mailer = createMailer(env.MAIL_MODE);
