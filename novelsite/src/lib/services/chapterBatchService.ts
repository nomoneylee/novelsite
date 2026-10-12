import 'server-only';
import {
  getVolumeOwnerNovelId,
  getVolumeChaptersByIds,
  publishChaptersBulk,
  deleteChaptersBulk,
  refreshNovelCounters,
  touchNovel,
  withTransaction,
} from '@/lib/repositories';
import { assertNovelOwner, NotFoundError } from '@/lib/auth/ownership';
import { batchChapterIdsSchema } from '@/lib/validation/chapterBatch';
import { invalidateChapter, invalidateNovel, invalidateNovelsList } from '@/lib/cache';
import { ServiceError, parseOrThrow, translateDbError } from './errors';
import { notifyNewChapters } from './notificationService';

/**
 * 批次發佈與批次刪除的授權、交易編排與通知（FEAT-8 8-B，contracts/internal-modules.md §4）
 * ========================================================================================
 * **MUST NOT `import { prisma }`**：資料存取一律經 `@/lib/repositories` barrel
 * （憲章第 III 條，`tests/unit/layering.test.ts` 以靜態稽核鎖死）。
 *
 * **本檔自成一個服務而非併入 `chapterService`**：後者的每一支都以「單章」為單位，
 * 而本階段的核心承諾（N 章 → 一則通知、全有全無）**正是逐章路徑做不到的那件事** ——
 * 逐章呼叫 `publishChapter` 湊批次不會產生任何型別錯誤，只會讓收藏者收到 N 則通知。
 */

// ─────────────────────────────────────────────
// 共用：錯誤轉譯（T010a）
// ─────────────────────────────────────────────

/**
 * 衝突時的對外文案。**不依操作別分兩句**（契約 §4 的簽章只收 `err` 一個參數）：
 * 發佈與刪除撞到的是同一件事（同一批列被另一個寫入軌先動了），
 * 而作者要做的事兩者完全相同 —— 重試。
 */
const CONFLICT_MESSAGE = '資料庫寫入衝突，請重試';

/**
 * Prisma 交易寫入衝突（`P2034` `TransactionWriteConflict`）。
 *
 * 以「有沒有 `code` 屬性且值為 P2034」判斷，MUST NOT 用
 * `instanceof Prisma.PrismaClientKnownRequestError` —— 沿用 `services/errors.ts`
 * 的 `isUniqueViolation` 同一個理由：服務層的存在目的正是不依賴特定資料庫客戶端。
 */
function isTransactionWriteConflict(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'P2034'
  );
}

/**
 * 本檔自有的錯誤轉譯（analyze 第二輪 2026-08-23／findings I2）。
 * 順序：`ServiceError` 原樣通過 → `NotFoundError` → `NOT_FOUND`
 * → **`P2034` → `CONFLICT`** → 其餘交給既有的 `translateDbError`。
 *
 * **MUST NOT 寫成「沿用 `chapterService` 的 `toServiceError`」**：那是
 * `chapterService.ts` 的**模組私有函式、未匯出**，本檔引用不到。
 *
 * **`P2034` 的處置 MUST 由本函式自己做**：共用的 `translateDbError`
 * （`services/errors.ts`）**只認 `P2002` 唯一鍵衝突**，而本階段兩項操作都不寫
 * `Chapter.number`、也不新增列 —— **`P2002` 在此不可能發生**。
 * 真正會發生的是 1000 列更新／刪除與排程掃描互撞的交易寫入衝突，Prisma 兩軌皆回 `P2034`。
 * 不接它就會落到 `INTERNAL_ERROR`／500，把「請重試」講成「系統壞了」。
 *
 * **MUST NOT 為此改動共用的 `translateDbError`**（憲章「變更範圍」：
 * 那會同時改變 9 個服務檔、24 個既有呼叫端的錯誤語意）。
 *
 * **`P2028`（交易逾時）MUST NOT 映射為 `CONFLICT`**：逾時不是衝突，
 * 它代表這一批大到跑不完或資料庫塞住，維持 `INTERNAL_ERROR` 才不會誤導作者一直重試。
 */
export function toBatchServiceError(err: unknown): ServiceError {
  if (err instanceof ServiceError) return err;
  if (err instanceof NotFoundError) return new ServiceError('NOT_FOUND', '找不到指定的資源');
  if (isTransactionWriteConflict(err)) return new ServiceError('CONFLICT', CONFLICT_MESSAGE);
  return translateDbError(err, CONFLICT_MESSAGE);
}

// ─────────────────────────────────────────────
// 共用：授權與候選查詢（T010）
// ─────────────────────────────────────────────

/** 候選章節：兩項操作接下來都要的欄位，一次查齊 */
export interface BatchCandidate {
  id: string;
  number: number;
  title: string;
  status: string;
  publishedAt: Date | null;
  wordCount: number;
}

/** 共用前置的產出：反查到的作品、去重後的識別碼、候選章節 */
export interface BatchContext {
  novelId: string;
  volumeId: string;
  chapterIds: string[];
  candidates: BatchCandidate[];
}

/**
 * 兩項操作的共用前置。**順序 MUST 為：Zod 解析 → 反查 `novelId` → 擁有權 → 候選查詢列數比對**。
 *
 * - **反查在擁有權之前**：擁有權判定的入參就是反查的結果，順序不可調換。
 * - **列數比對是 FR-021a 的落地方式**：候選查詢的 `where` 同時帶 `volumeId` 與
 *   `id: { in: ids }`，回傳列數 `< chapterIds.length` 即代表批次內有章節不屬於該卷
 *   （或根本不存在）。
 *
 * **MUST NOT 指名是哪一個識別碼**（FR-022）：卷不存在、卷不屬於發起者、
 * 章節不屬於該卷三者在此匯流成**同一個** `NotFoundError`。
 * 讓它們走不同分支或在訊息裡點名，回應遲早會長得不一樣，而**差異本身就是洩漏** ——
 * 作者的草稿清單正是需要保護的資訊。
 */
export async function loadBatchContext(uid: string, input: unknown): Promise<BatchContext> {
  const data = parseOrThrow(batchChapterIdsSchema, input);

  const novelId = await getVolumeOwnerNovelId(data.volumeId);
  if (!novelId) throw new NotFoundError();
  await assertNovelOwner(uid, novelId);

  const candidates = await getVolumeChaptersByIds(data.volumeId, data.chapterIds);
  if (candidates.length < data.chapterIds.length) throw new NotFoundError();

  return {
    novelId,
    volumeId: data.volumeId,
    chapterIds: data.chapterIds,
    candidates,
  };
}

// ─────────────────────────────────────────────
// 批次發佈（T015／T016／T019，contracts/batch-operations-actions.md §1）
// ─────────────────────────────────────────────

/**
 * 交易選項。**MUST 傳入，MUST NOT 依賴預設值**（analyze 第二輪 2026-08-23／findings U1）：
 * Prisma 互動式交易的預設 timeout 是 **5 秒**，而本階段的上界是 1000 章 ——
 * 必然逾時，而逾時的表現是「作者按了確認、什麼都沒發生」。
 * 值沿用 `chapterImportService.ts` 的同一組（同一個資料庫、同一個量級）。
 */
const TX_OPTIONS = { timeout: 30_000, maxWait: 5_000 } as const;

export interface BatchPublishResult {
  /** 供 Action 層寫紀錄（findings I3）。**MUST NOT 出現在 `ActionResult` 的回應主體** */
  novelId: string;
  /** 實際由草稿轉為已發佈者（條件更新的回傳列數，FR-010a） */
  published: number;
  /** 選取中原本已是 `published` 者 */
  skipped: number;
  /** 本批**實際發佈**的章節中 `wordCount === 0` 者（FR-014；基準與確認畫面不同，見 data-model §3.2） */
  emptyBody: number;
  /** 追更通知是否成功建立（FR-010b）；`published === 0` 時為 `true` */
  notified: boolean;
  publishedNumbers: number[];
  skippedNumbers: number[];
  /** 空正文章節的章號（FR-027a）—— 成功後選取已清空，前端無從反推，故 MUST 由本層交出 */
  emptyBodyNumbers: number[];
}

/**
 * 批次立即發佈（FR-007～FR-014）。
 *
 * ```
 * 共用前置（loadBatchContext）
 *   → 交易：依 publishedAt 分兩組各一次條件更新 → refreshNovelCounters → touchNovel
 *   → 交易外：快取失效
 *   → 交易外：notifyNewChapters **單次**呼叫
 * ```
 *
 * **通知 MUST 為單次呼叫**：`notifyNewChapters(novelId, 整批)`。
 * **逐章呼叫 `publishChapter` 湊批次是本階段最嚴重的實作錯誤** ——
 * 它不會產生任何型別錯誤、其他所有測試也照樣全綠，唯一的症狀是每位收藏者收到 N 則通知。
 *
 * **計數重算與 touch 各只呼叫一次**（不是每章一次）：兩者都以「該作品目前的已發佈章節」
 * 重算，跑 N 次的結果與跑 1 次相同，差的只是 N 倍的成本。
 */
export async function publishChapters(uid: string, input: unknown): Promise<BatchPublishResult> {
  const now = new Date();

  let novelId: string;
  let candidates: BatchCandidate[];
  let publishedRows: { id: string; number: number; title: string }[];

  try {
    const ctx = await loadBatchContext(uid, input);
    novelId = ctx.novelId;
    candidates = ctx.candidates;

    if (candidates.some((c) => c.status === 'admin_suspended')) {
      throw new ServiceError('FORBIDDEN', '選取的章節中包含遭管理員下架之章節，無法批次發佈');
    }

    // 兩組互斥且都帶 `status: 'draft'`：首次發佈組寫入上架日期，重發組保留原值（FR-013）。
    // 第一組執行後那些列已是 `published`，第二組的 `status: 'draft'` 條件自然排除它們 ——
    // 順序無害，故不必為此另加防護（research R-3）
    const drafts = candidates.filter((c) => c.status === 'draft');
    const firstTimeIds = drafts.filter((c) => c.publishedAt === null).map((c) => c.id);
    const republishIds = drafts.filter((c) => c.publishedAt !== null).map((c) => c.id);

    publishedRows = await withTransaction(async (tx) => {
      const rows: { id: string; number: number; title: string }[] = [];
      if (firstTimeIds.length > 0) {
        rows.push(...(await publishChaptersBulk(ctx.volumeId, firstTimeIds, now, true, tx)));
      }
      if (republishIds.length > 0) {
        rows.push(...(await publishChaptersBulk(ctx.volumeId, republishIds, now, false, tx)));
      }
      await refreshNovelCounters(ctx.novelId, tx);
      await touchNovel(ctx.novelId, now, tx);
      return rows.sort((a, b) => a.number - b.number);
    }, TX_OPTIONS);
  } catch (err) {
    throw toBatchServiceError(err);
  }

  // 快取失效 MUST 在交易之外（T019）：交易尚未 commit 時失效，重新產生的頁面會讀到舊資料。
  // **MUST 留在服務層** —— `layering.test.ts` 鎖死「`invalidate*` 的呼叫端只有 `lib/services/`」
  for (const row of publishedRows) invalidateChapter(row.id);
  invalidateNovel(novelId);
  invalidateNovelsList();

  // 通知在交易 commit 之後（T016）。**失敗 MUST NOT 向上傳播**（FR-010b）：
  // 章節已經真的發佈了，把它回報成整批失敗，作者會再按一次 —— 而第二次只會得到
  // 「已發佈 0 章」。`published === 0` 時沒有要送的通知，也就沒有「未送出」可言
  let notified = true;
  if (publishedRows.length > 0) {
    try {
      await notifyNewChapters(novelId, publishedRows);
    } catch (err) {
      notified = false;
      console.error('[chapterBatch] 追更通知建立失敗（章節已發佈，不影響本批結果）', err);
    }
  }

  const publishedIds = new Set(publishedRows.map((r) => r.id));
  const skipped = candidates.filter((c) => c.status === 'published');
  const emptyBody = candidates.filter((c) => publishedIds.has(c.id) && c.wordCount === 0);

  return {
    novelId,
    published: publishedRows.length,
    skipped: skipped.length,
    emptyBody: emptyBody.length,
    notified,
    publishedNumbers: publishedRows.map((r) => r.number),
    skippedNumbers: skipped.map((c) => c.number),
    emptyBodyNumbers: emptyBody.map((c) => c.number),
  };
}

// ─────────────────────────────────────────────
// 批次刪除（T028，contracts/batch-operations-actions.md §2）
// ─────────────────────────────────────────────

export interface BatchDeleteResult {
  /** 供 Action 層寫紀錄；**MUST NOT 出現在 `ActionResult` 的回應主體**（契約 §2.2） */
  novelId: string;
  /** 實際刪除列數 */
  deleted: number;
  /** 本批章號（供紀錄與摘要組區段）。刪除沒有「略過」語意，故即為候選集合的章號 */
  deletedNumbers: number[];
}

/**
 * 批次刪除（FR-015～FR-020）。
 *
 * ```
 * 共用前置（loadBatchContext）
 *   → 交易：deleteChaptersBulk → refreshNovelCounters → touchNovel
 *   → 交易外：快取失效
 * ```
 *
 * **無通知段**：刪除不產生任何讀者通知。
 *
 * **草稿與已發佈皆可刪，伺服器 MUST NOT 因狀態而分支**（FR-015）：
 * 加強確認落在前端（FR-016），多一個「只刪草稿」的旗標等於多一條要測、
 * 且前端傳錯就會靜默少刪的路徑。
 *
 * **全有全無**（FR-018）：任一章不屬於該卷或不屬於發起者，在共用前置就整批失敗，
 * 走不到部分刪除。
 *
 * **計數重算與 touch 各只呼叫一次**（FR-024），理由同 `publishChapters`。
 */
export async function deleteChapters(uid: string, input: unknown): Promise<BatchDeleteResult> {
  const now = new Date();

  let novelId: string;
  let chapterIds: string[];
  let deletedNumbers: number[];
  let deleted: number;

  try {
    const ctx = await loadBatchContext(uid, input);
    novelId = ctx.novelId;
    chapterIds = ctx.chapterIds;
    // 候選查詢已依 `number` 遞增排序；列數比對通過即代表這些章全部屬於該卷
    deletedNumbers = ctx.candidates.map((c) => c.number);

    deleted = await withTransaction(async (tx) => {
      const count = await deleteChaptersBulk(ctx.volumeId, ctx.chapterIds, tx);
      await refreshNovelCounters(ctx.novelId, tx);
      await touchNovel(ctx.novelId, now, tx);
      return count;
    }, TX_OPTIONS);
  } catch (err) {
    throw toBatchServiceError(err);
  }

  // 快取失效 MUST 在交易之外、且 MUST 留在服務層（同 `publishChapters`；findings C3）。
  // 少了這一段，已刪章節的頁面會續留在快取裡，而沒有任何測試會變紅
  for (const id of chapterIds) invalidateChapter(id);
  invalidateNovel(novelId);
  invalidateNovelsList();

  return { novelId, deleted, deletedNumbers };
}
