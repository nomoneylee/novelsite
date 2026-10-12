/**
 * 批次操作紀錄（FR-028／FR-028a，contracts/internal-modules.md §2）
 * ================================================================
 * 單行 JSON 至標準輸出，**MUST NOT 寫入資料庫**（本階段的 schema 增量為零）。
 *
 * **MUST NOT 擴充 `auth/audit.ts` 的 `logSecurityEvent`**：該函式的四欄位形狀被
 * `tests/unit/audit.test.ts` 鎖死。白名單組物件的**手法**照抄 FEAT-7 的
 * `chapterImport/log.ts`，**欄位集合不同**。
 *
 * **呼叫落點 MUST 為 Action 層（`src/app/author/actions.ts`），MUST NOT 為服務層**
 * （analyze 第二輪 2026-08-23／findings I3）：未登入與角色不足由
 * `requireAuthorForAction()` 在 Action 層擲出，**永遠到不了服務層**，
 * 而契約 §1.3 要求那兩個出口各記一行。
 */

/** 批次操作的種類。兩個 Action 各一 */
export type BatchOperation = 'publish' | 'delete';

/**
 * 批次結果代碼。**以陣列為真相來源、型別自其推導**（沿用 FEAT-7 `PREVIEW_VERDICTS` 的手法）：
 * 型別在執行期不存在，若另外手寫一份陣列供測試比對，兩份必然分岔。
 *
 * **MUST 為字面量聯集，MUST NOT 是開放的 `string`**：開放型別下每個出口各寫各的字面量，
 * 必然出現 `'forbidden'`／`'FORBIDDEN'` 兩種寫法指同一件事，而 SC-008 要這一行
 * 足以回答「結果如何」。註解列舉不會被編譯器檢查，聯集會。
 *
 * **八個值，含 `conflict`**（analyze 第一輪 2026-08-22／findings I1 補入，
 * 第二輪 2026-08-23／findings I1／I2 更正其理由）：`conflict` 由 Prisma **`P2034`
 * （`TransactionWriteConflict`）** 而來 —— 1000 列的更新／刪除與排程掃描互撞，
 * **不是**由唯一鍵衝突（`P2002`）而來：本階段兩項操作都不寫 `Chapter.number`，
 * `P2002` 在此不可能發生（見 `chapterBatchService.ts` 的 `toBatchServiceError`、research R-13）。
 */
export const BATCH_RESULTS = [
  'ok', // 交易 commit 成功且通知送出
  'notify_failed', // 交易 commit 成功、通知失敗（FR-010b：MUST NOT 回報整批失敗）
  'unauthenticated', // Action 層守衛：未登入
  'forbidden', // Action 層守衛：角色不足
  'not_found', // 服務層：卷不存在、不屬於發起者，或有章節不屬於該卷
  'validation_error', // Zod：形狀不符或超過上限
  'conflict', // 服務層：交易寫入衝突（Prisma P2034）
  'internal_error',
] as const;

export type BatchResult = (typeof BATCH_RESULTS)[number];

export interface BatchLogInput {
  /** 發起者。**身分驗證之前的出口為 `null`** */
  actorId: string | null;
  /** 服務層自 `volumeId` 反查而得；反查之前的出口為 `null` */
  novelId: string | null;
  /**
   * **MUST 為 `string | null`，MUST NOT 宣告為必填 `string`**
   * （analyze 第二輪 2026-08-23／findings U3）。照抄 FEAT-7 的 `string` 是錯的：
   * 那邊的 `volumeId` 是**路徑參數**，端點一進來就有；本階段它在**未經 Zod 的請求主體**內
   * （Action 入參型別是 `unknown`），未登入／角色不足／格式不符三個出口**取不到**
   * 保證是字串的值。宣告為必填會逼出 `''` 或 `String(input.volumeId)` 這類自造值 ——
   * `null` 是「這個階段還不知道」的唯一誠實表示法。
   */
  volumeId: string | null;
  operation: BatchOperation;
  /**
   * 本批章節數。**Zod 解析之前的出口 MUST 為 `0`**
   * （analyze 第三輪 2026-08-23／findings U1）：那三個出口的入參型別是 `unknown`，
   * `input.chapterIds.length` 取不到（或直接擲錯）。沒有這條對稱規定就會出現
   * `-1`／`NaN`／`undefined` 三種寫法各記各的，而 `0` 與「這一批一章也沒動到」的事實一致。
   */
  chapterCount: number;
  /** `formatChapterRanges` 的輸出（FR-028a）；未知時為 `''` */
  ranges: string;
  result: BatchResult;
  durationMs: number;
}

/**
 * 輸出單行 JSON。**輸出恰為 10 個欄位** ＝ 入參的 8 個，
 * 加上本函式自填的 `event` 與 `at`。
 *
 * **MUST 從入參擷取已知欄位組出新物件，MUST NOT 展開入參**（FR-028）：
 * 呼叫端即使誤傳 `title` 或 `bodyMarkdown`，輸出也不得含其值 ——
 * 把作者未發佈草稿的標題寫進容器日誌是內容外洩，不是稽核。
 *
 * **值為 `null` 時 MUST 照常輸出該欄，MUST NOT 略過整筆記錄** ——
 * 略過的正好是被擋在門外的請求，而那些才是異常流量的樣子。
 */
export function logBatchEvent(input: BatchLogInput): void {
  const record = {
    event: 'chapter.batch' as const,
    at: new Date().toISOString(),
    actorId: input.actorId,
    novelId: input.novelId,
    volumeId: input.volumeId,
    operation: input.operation,
    chapterCount: input.chapterCount,
    ranges: input.ranges,
    result: input.result,
    durationMs: input.durationMs,
  };
  console.log(JSON.stringify(record));
}
