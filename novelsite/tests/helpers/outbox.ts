/**
 * memory 模式寄件落地檔的讀取輔助（FEAT-5 T013，contracts/internal-modules.md §3）
 * ==============================================================================
 * **MUST NOT import 任何 `src/**` 模組**（比照 `helpers/client.ts`）：本檔會被整合與 a11y
 * 兩套件共用，而 a11y 的解析條件下 `server-only` 會在載入階段擲錯。
 *
 * **正因為不能 import，路徑只能自行複製一份**：讀 `process.env.MAIL_OUTBOX_PATH`，
 * 未設定時回落 `path.join(process.cwd(), '.mail-outbox.jsonl')` ——
 * 與 `src/lib/env.ts` 的 `DEFAULT_MAIL_OUTBOX_FILENAME` **同一個基準**（research R-6）。
 * 兩處基準不一致時測試永遠讀到空 outbox，而**症狀是「信沒寄」**——
 * 會被誤判成 `after()` 沒生效或寄送實作壞了，而那兩處都沒有問題。
 */
import fs from 'node:fs/promises';
import path from 'node:path';

export interface OutboxEntry {
  at: string;
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
}

function outboxPath(): string {
  return process.env.MAIL_OUTBOX_PATH ?? path.join(process.cwd(), '.mail-outbox.jsonl');
}

/** 刪檔。每個測試檔於 `beforeAll` 呼叫 —— 不存在也算成功 */
export async function clearOutbox(): Promise<void> {
  await fs.rm(outboxPath(), { force: true });
}

/** 解析全部行。檔案尚未產生時回空陣列（還沒有任何一封信寄出，不是錯誤） */
export async function readOutbox(): Promise<OutboxEntry[]> {
  let raw: string;
  try {
    raw = await fs.readFile(outboxPath(), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return raw
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as OutboxEntry);
}

/**
 * 輪詢直到命中或逾時。**「`after()` 確實被執行」那道驗證就靠它**（FR-006a）——
 * 寄送發生在回應之後，故回應拿到 200 的當下 outbox 必然還是空的。
 */
export async function waitForMail(
  predicate: (entry: OutboxEntry) => boolean,
  timeoutMs = 5000
): Promise<OutboxEntry> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const hit = (await readOutbox()).find(predicate);
    if (hit) return hit;
    if (Date.now() >= deadline) {
      throw new Error(`waitForMail：${timeoutMs}ms 內 outbox 未出現符合條件的信件`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** 自內文擷取重設連結的 `token=` 參數（base64url 字元集） */
export function extractResetToken(text: string): string {
  const matched = /[?&]token=([A-Za-z0-9_-]+)/.exec(text);
  if (!matched) throw new Error('extractResetToken：內文中找不到 token= 參數');
  return matched[1];
}
