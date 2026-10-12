/**
 * 匯入紀錄（FR-016b～FR-016d，contracts/internal-modules.md §4）
 * ==============================================================
 * 單行 JSON 至標準輸出，**MUST NOT 寫入資料庫**（FR-016c：新增稽核表會連帶引入
 * 保留期、清理作業與隱私處置，而本階段的 schema 增量為零）。
 *
 * **MUST NOT 擴充 `auth/audit.ts` 的 `logSecurityEvent`**：該函式的四欄位形狀被
 * `tests/unit/audit.test.ts` 鎖死，硬塞另外七個欄位會同時打破那個測試與它刻意的極簡設計
 * （research R-10）。白名單組物件的**手法**照抄，欄位集合不同。
 */

/**
 * 匯入結果代碼。**MUST 為字面量聯集，MUST NOT 是開放的 `string`**
 * （FEAT-7 第四輪 analyze，2026-08-21）：開放型別下每個出口各寫各的字面量，
 * 必然出現 `'forbidden'`／`'FORBIDDEN'`／`'origin_rejected'` 三種寫法指同一件事，
 * 而 SC-007 要這一行足以回答「結果如何」、FR-016a 的限流觸發條件要靠本欄分組計數。
 * 註解列舉不會被編譯器檢查，聯集會。
 *
 * 九個值一一對應契約 §1.4 的每一種出口。
 */
export type ImportResult =
  | 'ok' // 交易 commit 成功
  | 'origin_rejected' // 第 1 步 assertSameOrigin
  | 'bad_request' // 第 2、3 步：Content-Type／Content-Length 缺漏或超標
  | 'unauthenticated' // 第 4 步：未登入
  | 'forbidden' // 第 4 步：角色不足
  | 'not_found' // 服務層：卷不存在或不屬於發起者
  | 'validation_error' // 第 6 步或全量重驗：逐檔判定或上限
  | 'conflict' // 章號衝突（預查或唯一鍵）
  | 'internal_error';

export interface ImportLogInput {
  /**
   * 發起者。**身分驗證之前的出口（契約 §1.4 第 1–3 步）為 `null`**。
   * 宣告為必填 `string` 會逼出 `''`／`'unknown'` 這類自造值，
   * 而那種值在日誌查詢裡與真實 id 無法區分 —— `null` 是「這個階段還不知道」的唯一誠實表示法
   */
  actorId: string | null;
  /** 服務層自 `volumeId` 反查而得；反查之前的出口為 `null`。理由同 `actorId` */
  novelId: string | null;
  /** 路徑參數，任何出口都有 */
  volumeId: string;
  /** 尚未解析 multipart 的出口為 0 */
  fileCount: number;
  /** 取自 `Content-Length`；缺該標頭的出口為 0 */
  totalBytes: number;
  result: ImportResult;
  durationMs: number;
}

/**
 * 輸出單行 JSON（FR-016b）。**輸出恰為 9 個欄位** ＝ 入參的 7 個，
 * 加上本函式自填的 `event` 與 `at`（data-model §2.4）。
 *
 * **MUST 從入參擷取已知欄位組出新物件，MUST NOT 展開入參**（FR-016d）：
 * 呼叫端即使誤傳 `filename` 或 `bodyMarkdown`，輸出也不得含其值 ——
 * 把作者未發佈草稿的標題寫進容器日誌是內容外洩，不是稽核。
 *
 * **值為 `null` 時 MUST 照常輸出該欄，MUST NOT 略過整筆記錄** ——
 * 略過的正好是被擋在門外的請求，而那些才是異常流量的樣子。
 */
export function logImportEvent(input: ImportLogInput): void {
  const record = {
    event: 'chapter.import' as const,
    at: new Date().toISOString(),
    actorId: input.actorId,
    novelId: input.novelId,
    volumeId: input.volumeId,
    fileCount: input.fileCount,
    totalBytes: input.totalBytes,
    result: input.result,
    durationMs: input.durationMs,
  };
  console.log(JSON.stringify(record));
}
