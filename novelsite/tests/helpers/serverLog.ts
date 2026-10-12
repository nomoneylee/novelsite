/**
 * 測試伺服器 stdout 的讀取輔助（FEAT-7 T031a，contracts/batch-import-api.md §1.4 第 8 步）
 * ========================================================================================
 * **MUST NOT import 任何 `src/**` 模組**（比照 `helpers/client.ts`、`helpers/outbox.ts`）：
 * 本檔會被整合與 a11y 兩套件共用，而 a11y 的解析條件下 `server-only` 會在載入階段擲錯。
 *
 * 落地檔由 `tests/globalSetup.ts` 產生並經 `provide()` 傳入 —— 受測伺服器是那裡起的
 * 子行程，它的 `console.log` 沒有經過本行程，**攔不到就只能繞過真實端點**，
 * 而「提前返回時有沒有記錄」正是繞過去就驗不到的那一件事。
 */
import fs from 'node:fs/promises';
import { inject } from 'vitest';

/** 匯入紀錄的一行（`src/lib/chapterImport/log.ts` 的輸出，data-model §2.4 的 9 欄） */
export interface ImportLogRecord {
  event: 'chapter.import';
  at: string;
  actorId: string | null;
  novelId: string | null;
  volumeId: string;
  fileCount: number;
  totalBytes: number;
  result: string;
  durationMs: number;
}

function isImportRecord(value: unknown): value is ImportLogRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { event?: unknown }).event === 'chapter.import'
  );
}

/**
 * 讀出某一個卷的全部匯入紀錄，依輸出順序排列。
 *
 * 伺服器的其他輸出（Next.js 自身的訊息）與**其他測試**的匯入紀錄一律濾掉：
 * 前者不是 JSON，後者的 `volumeId` 不同。以 `volumeId` 過濾而非「取最後 N 行」——
 * 取尾端的寫法會在有人於本檔之前插進一個匯入案例時無聲換掉被斷言的資料。
 */
export async function readImportLogs(volumeId: string): Promise<ImportLogRecord[]> {
  let raw: string;
  try {
    raw = await fs.readFile(inject('serverLogPath'), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const records: ImportLogRecord[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // 尚未寫完的最後一行；下一輪輪詢就會完整
      continue;
    }
    if (isImportRecord(parsed) && parsed.volumeId === volumeId) records.push(parsed);
  }
  return records;
}

/**
 * 輪詢直到該卷的紀錄達到 `count` 行。
 *
 * **需要輪詢的理由**：紀錄寫在回應送出之前，但它要先穿過子行程的管線才會落到檔案上，
 * 那一段是非同步的 —— 拿到回應的當下直接讀檔會間歇性讀到少一行。
 */
export async function waitForImportLogs(
  volumeId: string,
  count: number,
  timeoutMs = 5000
): Promise<ImportLogRecord[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const records = await readImportLogs(volumeId);
    if (records.length >= count) return records;
    if (Date.now() >= deadline) {
      throw new Error(
        `waitForImportLogs：${timeoutMs}ms 內只等到 ${records.length} 行（預期 ${count} 行），volumeId=${volumeId}`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

// ─────────────────────────────────────────
// 批次發佈與批次刪除的紀錄（FEAT-8 T013a，contracts/internal-modules.md §2）
//
// **為什麼不能沿用上方的 `waitForImportLogs`**（analyze 第三輪 2026-08-23／findings C2）：
// 它只認 `event === 'chapter.import'`，且 `ImportLogRecord.volumeId` 是**必填 `string`**。
// 本階段斷言紀錄的案子因此沒有任何可用的讀取路徑 ——
// 最可能的下場是被降級成「只驗資料庫」，等於不驗紀錄。
// ─────────────────────────────────────────

/** 操作別。**就地宣告而非自 `src/lib/chapterBatch/log` 匯入** —— 見本檔檔頭 */
export type BatchOperationName = 'publish' | 'delete';

/**
 * 批次紀錄的一行（`src/lib/chapterBatch/log.ts` 的輸出，共 10 欄）。
 *
 * **`volumeId` 為 `string | null`**（contracts §2）：本階段的 `volumeId` 在**未經 Zod 的
 * 請求主體**內，不像 FEAT-7 是路徑參數 —— 未登入／角色不足／格式不符三個出口都是 `null`。
 */
export interface BatchLogRecord {
  event: 'chapter.batch';
  at: string;
  actorId: string | null;
  novelId: string | null;
  volumeId: string | null;
  operation: BatchOperationName;
  chapterCount: number;
  ranges: string;
  result: string;
  durationMs: number;
}

/**
 * 過濾條件。**MUST 支援兩種**：
 *
 * - **(a) 以 `volumeId` 過濾** —— 有卷的出口（擁有權失敗、成功、衝突……）。
 * - **(b) 以 `since` ＋ `operation` 過濾** —— **未登入與角色不足那兩行的 `volumeId` 為 `null`，
 *   用 (a) 濾不到**。`since` 是呼叫前記下的 ISO 時刻。
 *
 * 兩種可共同使用（相當於 AND）。**至少要給一種** —— 一種都不給等於收下全部測試的紀錄。
 */
export interface BatchLogFilter {
  volumeId?: string;
  /** 呼叫受測端點**之前**記下的 `new Date().toISOString()` */
  since?: string;
  operation?: BatchOperationName;
}

function isBatchRecord(value: unknown): value is BatchLogRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { event?: unknown }).event === 'chapter.batch'
  );
}

function matches(record: BatchLogRecord, filter: BatchLogFilter): boolean {
  if (filter.volumeId !== undefined && record.volumeId !== filter.volumeId) return false;
  if (filter.operation !== undefined && record.operation !== filter.operation) return false;
  // ISO 8601 （`toISOString()` 的固定長度 UTC 形式）的字典序即時間序，不必轉 Date
  if (filter.since !== undefined && record.at < filter.since) return false;
  return true;
}

/**
 * 讀出符合條件的全部批次紀錄，**依輸出順序**排列。
 *
 * **MUST NOT 以「取最後 N 行」判定**（同上方 `readImportLogs` 的理由）：
 * 有人在本檔之前插進一個批次案例時，取尾端的寫法會**無聲**換掉被斷言的資料。
 */
export async function readBatchLogs(filter: BatchLogFilter): Promise<BatchLogRecord[]> {
  if (filter.volumeId === undefined && filter.since === undefined) {
    throw new Error(
      'readBatchLogs：過濾條件 MUST 至少含 `volumeId` 或 `since` —— ' +
        '兩種都不給會收下全部測試的批次紀錄，斷言就不再指向本案'
    );
  }

  let raw: string;
  try {
    raw = await fs.readFile(inject('serverLogPath'), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const records: BatchLogRecord[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // 尚未寫完的最後一行；下一輪輪詢就會完整
      continue;
    }
    if (isBatchRecord(parsed) && matches(parsed, filter)) records.push(parsed);
  }
  return records;
}

/**
 * 輪詢直到符合條件的紀錄達 `count` 行。
 *
 * **需要輪詢的理由**：紀錄寫在回應送出之前，但它要先穿過子行程的管線才會落到檔案上，
 * 那一段是非同步的 —— 拿到回應的當下直接讀檔會間歇性讀到少一行。
 */
export async function waitForBatchLogs(
  filter: BatchLogFilter,
  count: number,
  timeoutMs = 5000
): Promise<BatchLogRecord[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const records = await readBatchLogs(filter);
    if (records.length >= count) return records;
    if (Date.now() >= deadline) {
      throw new Error(
        `waitForBatchLogs：${timeoutMs}ms 內只等到 ${records.length} 行（預期 ${count} 行），` +
          `filter=${JSON.stringify(filter)}`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
