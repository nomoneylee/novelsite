import { z } from 'zod';

/**
 * 批次操作的上限常數與入參驗證（FEAT-8 FR-005、contracts/internal-modules.md §3）
 * ==============================================================================
 * 沿用 `validation/` 的既有語意：client / server 共用的純模組，MUST NOT `import 'server-only'`。
 * 兩個 Action（批次發佈、批次刪除）**共用同一個 schema** —— 入參形狀相同。
 */

/**
 * 單次批次操作的章節數上限。MUST NOT 於各處重複字面量 —— 重複的必然結果是漂移。
 *
 * 與 `IMPORT_LIMITS.maxFiles` 對齊為 1000：一次匯入最多產出 1000 章，
 * 而批次發佈存在的理由正是「匯入之後不必逐章進編輯器」——
 * 上限比匯入低的話，剛匯完的那一批就得分兩次發佈。
 */
export const BATCH_LIMITS = {
  maxChapters: 1000,
} as const;

/**
 * 批次操作的入參：卷識別碼 ＋ 章節識別碼清單。
 *
 * **`chapterIds` MUST 先去重、再驗數量**（contracts §3）。
 * 順序反過來寫（先驗 1–1000、再去重）有兩個後果：
 * 一是 `[a, a, ..., a]` 這種 1001 筆重複值會被判超限，而實際只有一章；
 * 二是重複 id 會讓 `chapterCount` 與資料庫實際影響列數對不上，
 * 而**那個差額會被誤讀成「被排程搶先發佈」**（FR-010a 的判定基準就是影響列數）。
 *
 * **MUST NOT 新增 `ErrorCode`**：超限一律走既有的 `VALIDATION_ERROR`。
 * 超限訊息 MUST 同時含**實際值與上限值**（FR-005）——
 * 只說「超過上限」的話，作者不知道要取消勾選幾章才送得出去。
 */
export const batchChapterIdsSchema = z.object({
  volumeId: z.string().trim().min(1, '缺少卷識別碼'),
  chapterIds: z
    .array(z.string().trim().min(1, '章節識別碼不得為空'))
    .transform((ids) => [...new Set(ids)])
    // 以 `superRefine` 而非兩段 `.refine` —— 超限訊息要帶**去重後的實際筆數**，
    // 而 `.refine` 的第二參數在 Zod 4 只收靜態字串或設定物件，取不到當下的值
    .superRefine((ids, ctx) => {
      if (ids.length < 1) {
        ctx.addIssue('請先選取至少一個章節');
        return;
      }
      if (ids.length > BATCH_LIMITS.maxChapters) {
        ctx.addIssue(`一次最多處理 ${BATCH_LIMITS.maxChapters} 章，目前選取 ${ids.length} 章`);
      }
    }),
});

export type BatchChapterIdsInput = z.infer<typeof batchChapterIdsSchema>;
