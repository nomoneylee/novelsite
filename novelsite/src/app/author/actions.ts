'use server';

import { redirect } from 'next/navigation';
import { requireAuthorForAction } from '@/lib/auth/guard';
import { errorResult as toFailure, ok, type ActionResult, type Failure } from '@/lib/actionResult';
import { createNovel, updateNovel, setNovelStatus, deleteNovel } from '@/lib/services/novelService';
import {
  createVolume,
  updateVolume,
  deleteVolume,
  createChapter,
  saveChapterDraft,
  setChapterStatus,
  deleteChapter,
  reorderChapters,
  publishChapter,
  cancelSchedule,
} from '@/lib/services/chapterService';
import {
  publishChapters,
  deleteChapters,
  type BatchPublishResult,
  type BatchDeleteResult,
} from '@/lib/services/chapterBatchService';
import { logBatchEvent, type BatchResult } from '@/lib/chapterBatch/log';
import { toChapterRanges, formatChapterRanges } from '@/lib/chapterBatch/ranges';
import { ServiceError } from '@/lib/services/errors';

/**
 * 作者寫入流的十三個 Server Action（contracts/server-actions.md §1、§2）
 * =======================================================================
 * **每一個 Action 的第一行都是 `requireAuthorForAction()`**（FR-007、T038a）。
 *
 * MUST NOT 依賴 `proxy.ts` 的 matcher 承擔授權：matcher 是以路徑前綴比對的，
 * 而 Server Action 是 POST 到「某個頁面路徑」再由框架派送 —— 只要有人為了別的理由
 * 把某條路徑排除在 matcher 外，那條路徑上的 Action 就會連帶失去攔截層的保護，
 * 而且不會有任何一個測試變紅。自驗是唯一不會被這種改動悄悄拆掉的作法。
 *
 * 授權順序 MUST 為：
 *   身分（`UNAUTHENTICATED`）→ 角色（`FORBIDDEN`）→ 擁有權（`NOT_FOUND`，服務層負責）
 *
 * CSRF 由框架內建的 `Origin`／`Host` 比對承擔（research R-6），Action 內不自寫。
 */

/**
 * 回傳形狀、錯誤碼與轉譯函式已移至 `@/lib/actionResult`，與個人設定的四個 Action 共用
 * （FEAT-3 T088）—— 契約要求兩者的錯誤碼集合完全相同，各留一份必然漂移。
 */
const errorResult = (err: unknown): Failure => toFailure('author action', err);

// ─────────────────────────────────────────────
// 1. 作品（contracts §1）
// ─────────────────────────────────────────────

/**
 * 建立作品後導向作品管理頁。
 *
 * `redirect()` 以擲出 `NEXT_REDIRECT` 的方式運作，故 MUST 落在 try/catch **之外** ——
 * 包在裡面會被錯誤處理當成未預期例外吃掉，成功的建立反而回一個 500 語意。
 */
export async function createNovelAction(
  input: unknown
): Promise<ActionResult<{ novelId: string }>> {
  let novelId: string;
  try {
    const session = await requireAuthorForAction();
    ({ novelId } = await createNovel(session.uid, input));
  } catch (err) {
    return errorResult(err);
  }
  redirect(`/author/novels/${novelId}`);
}

export async function updateNovelAction(input: unknown): Promise<ActionResult> {
  try {
    const session = await requireAuthorForAction();
    await updateNovel(session.uid, input);
    return ok;
  } catch (err) {
    return errorResult(err);
  }
}

export async function publishNovelAction(input: unknown): Promise<ActionResult> {
  try {
    const session = await requireAuthorForAction();
    await setNovelStatus(session.uid, input);
    return ok;
  } catch (err) {
    return errorResult(err);
  }
}

export async function deleteNovelAction(input: unknown): Promise<ActionResult> {
  try {
    const session = await requireAuthorForAction();
    await deleteNovel(session.uid, input);
    return ok;
  } catch (err) {
    return errorResult(err);
  }
}

// ─────────────────────────────────────────────
// 2. 卷（contracts §2）
// ─────────────────────────────────────────────

export async function createVolumeAction(
  input: unknown
): Promise<ActionResult<{ volumeId: string }>> {
  try {
    const session = await requireAuthorForAction();
    const { volumeId } = await createVolume(session.uid, input);
    return { success: true, data: { volumeId } };
  } catch (err) {
    return errorResult(err);
  }
}

export async function updateVolumeAction(input: unknown): Promise<ActionResult> {
  try {
    const session = await requireAuthorForAction();
    await updateVolume(session.uid, input);
    return ok;
  } catch (err) {
    return errorResult(err);
  }
}

export async function deleteVolumeAction(input: unknown): Promise<ActionResult> {
  try {
    const session = await requireAuthorForAction();
    await deleteVolume(session.uid, input);
    return ok;
  } catch (err) {
    return errorResult(err);
  }
}

// ─────────────────────────────────────────────
// 3. 章節（contracts §2）
// ─────────────────────────────────────────────

/** 建立空白草稿章節後直接進編輯器 —— 不新增「新章節」專用路由（contracts §2） */
export async function createChapterAction(
  input: unknown
): Promise<ActionResult<{ chapterId: string }>> {
  let chapterId: string;
  try {
    const session = await requireAuthorForAction();
    ({ chapterId } = await createChapter(session.uid, input));
  } catch (err) {
    return errorResult(err);
  }
  redirect(`/author/editor/${chapterId}`);
}

export async function saveChapterDraftAction(
  input: unknown
): Promise<ActionResult<{ wordCount: number }>> {
  try {
    const session = await requireAuthorForAction();
    const { wordCount } = await saveChapterDraft(session.uid, input);
    return { success: true, data: { wordCount } };
  } catch (err) {
    return errorResult(err);
  }
}

/**
 * 發佈章節（FEAT-4 4-D / T139，contracts/analytics-scheduling-api.md §5）。
 *
 * `scheduledAt` **可選**：省略即立即發佈並通知收藏者；未來時間寫入排程並維持草稿；
 * 過去時間回 `VALIDATION_ERROR` 且不建立無效排程（FR-049）。
 * 三種行為的判定全部在服務層 —— Action 只負責身分守衛與錯誤轉譯。
 */
export async function publishChapterAction(input: unknown): Promise<ActionResult> {
  try {
    const session = await requireAuthorForAction();
    await publishChapter(session.uid, input);
    return ok;
  } catch (err) {
    return errorResult(err);
  }
}

/** 取消排程（清 `scheduledAt`，章節維持草稿）。 */
export async function cancelScheduleAction(input: unknown): Promise<ActionResult> {
  try {
    const session = await requireAuthorForAction();
    await cancelSchedule(session.uid, input);
    return ok;
  } catch (err) {
    return errorResult(err);
  }
}

export async function unpublishChapterAction(input: unknown): Promise<ActionResult> {
  try {
    const session = await requireAuthorForAction();
    await setChapterStatus(session.uid, { ...asObject(input), status: 'draft' });
    return ok;
  } catch (err) {
    return errorResult(err);
  }
}

export async function reorderChaptersAction(input: unknown): Promise<ActionResult> {
  try {
    const session = await requireAuthorForAction();
    await reorderChapters(session.uid, input);
    return ok;
  } catch (err) {
    return errorResult(err);
  }
}

export async function deleteChapterAction(input: unknown): Promise<ActionResult> {
  try {
    const session = await requireAuthorForAction();
    await deleteChapter(session.uid, input);
    return ok;
  } catch (err) {
    return errorResult(err);
  }
}

// ─────────────────────────────────────────────
// 4. 批次操作（FEAT-8，contracts/batch-operations-actions.md §1）
// ─────────────────────────────────────────────

/**
 * `ServiceError` → 批次紀錄的 `result`。形狀照抄 FEAT-7 `import/route.ts` 的 `resultOfError`。
 * 八個值一一對應契約 §1.4 的出口（見 `chapterBatch/log.ts` 的 `BATCH_RESULTS`）。
 */
function batchResultOfError(err: unknown): BatchResult {
  if (!(err instanceof ServiceError)) return 'internal_error';
  switch (err.code) {
    case 'UNAUTHENTICATED':
      return 'unauthenticated';
    case 'FORBIDDEN':
      return 'forbidden';
    case 'VALIDATION_ERROR':
      return 'validation_error';
    case 'NOT_FOUND':
      return 'not_found';
    case 'CONFLICT':
      return 'conflict';
    default:
      return 'internal_error';
  }
}

/**
 * 自**未經驗證**的入參讀出紀錄要用的兩個值。**只讀，不信任** ——
 * 判定一律留給服務層的 Zod（`batchChapterIdsSchema`），本函式不擲錯、不改變任何流程。
 *
 * **為什麼非有這一步不可**：`logBatchEvent` 落在本層（findings I3），
 * 而 `volumeId` 與 `chapterCount` 只存在於請求主體裡 ——
 * Action 層 MUST NOT 觸及資料存取層，服務層失敗時也不會有回傳值。
 * 沒有這一步，那兩欄在**所有失敗出口**都只能是 `null`／`0`，
 * 而 FR-028 要的正是「被擋下的請求想動哪一卷、幾章」。
 *
 * 取不到（非物件、型別不符）時維持 `null`／`0` ——
 * `0` 與「這一次嘗試一章也沒動到」的事實一致（data-model §3.3 的對稱規定）。
 * `chapterIds` **先去重再計數**，與 schema 同一個判準，否則紀錄的章節數會與超限訊息對不上。
 */
function readBatchRef(input: unknown): { volumeId: string | null; chapterCount: number } {
  if (typeof input !== 'object' || input === null) return { volumeId: null, chapterCount: 0 };
  const raw = input as { volumeId?: unknown; chapterIds?: unknown };
  return {
    volumeId: typeof raw.volumeId === 'string' ? raw.volumeId : null,
    chapterCount: Array.isArray(raw.chapterIds) ? new Set(raw.chapterIds).size : 0,
  };
}

/**
 * 批次立即發佈（FR-007～FR-014、契約 §1）。
 *
 * **入參只有 `volumeId` ＋ `chapterIds`**：`status` 與 `scheduledAt` MUST NOT 出現 ——
 * 本 Action 的語意固定為「立即發佈」，排程走既有的 `publishChapterAction`（FR-007）。
 * `novelId` 亦 MUST NOT 在入參，由服務層自 `volumeId` 反查。
 *
 * **`logBatchEvent` MUST 落在本層，MUST NOT 下放服務層**（findings I3）：
 * 未登入與角色不足由 `requireAuthorForAction()` 在**這裡**擲出，根本到不了服務層，
 * 而契約要求那兩個出口各記一行。故以可變區域變數 ＋ 一個 `log(result)` 閉包涵蓋每一個出口。
 *
 * **服務層回傳的 `novelId` 只餵紀錄**，MUST NOT 出現在回應主體（契約 §1.2，
 * 手法同 FEAT-7 `import/route.ts`：解構後只回其餘欄位）。
 */
export async function publishChaptersAction(
  input: unknown
): Promise<ActionResult<Omit<BatchPublishResult, 'novelId'>>> {
  const startedAt = Date.now();
  let actorId: string | null = null;
  let novelId: string | null = null;
  let volumeId: string | null = null;
  let chapterCount = 0;
  let ranges = '';

  /** 每一個出口都經此記一行（FR-028）。**MUST NOT 因為值不齊就略過記錄** */
  const log = (result: BatchResult) =>
    logBatchEvent({
      actorId,
      novelId,
      volumeId,
      operation: 'publish',
      chapterCount,
      ranges,
      result,
      durationMs: Date.now() - startedAt,
    });

  try {
    const session = await requireAuthorForAction();
    // 身分與角色都過了才填 —— 那兩個出口的 `actorId` MUST 為 `null`（data-model §3.3）
    actorId = session.uid;
    ({ volumeId, chapterCount } = readBatchRef(input));

    const { novelId: publishedNovelId, ...body } = await publishChapters(session.uid, input);
    novelId = publishedNovelId;
    // 「這一批發了哪幾章」是 FR-028a 要紀錄回答的問題，故取**實際發佈**的章號
    ranges = formatChapterRanges(toChapterRanges(body.publishedNumbers));
    // 通知失敗仍是一次成功的發佈（FR-010b），差別只在這一行的 `result`
    log(body.notified ? 'ok' : 'notify_failed');
    return { success: true, data: body };
  } catch (err) {
    log(batchResultOfError(err));
    return errorResult(err);
  }
}

/**
 * 批次刪除（FR-015～FR-020、契約 §2）。
 *
 * **入參與批次發佈完全相同**（`volumeId` ＋ `chapterIds`），且 MUST NOT 含任何
 * 「只刪草稿」的旗標：草稿與已發佈皆可刪（FR-015），加強確認落在前端（FR-016），
 * 伺服器不因狀態而分支。
 *
 * 紀錄的形狀與 `publishChaptersAction` **完全相同**，只差 `operation: 'delete'`
 * 與成功時的章號來源 —— 兩者要回答的是同一組問題（誰、動了哪一卷的哪幾章、結果如何）。
 */
export async function deleteChaptersAction(
  input: unknown
): Promise<ActionResult<Omit<BatchDeleteResult, 'novelId'>>> {
  const startedAt = Date.now();
  let actorId: string | null = null;
  let novelId: string | null = null;
  let volumeId: string | null = null;
  let chapterCount = 0;
  let ranges = '';

  const log = (result: BatchResult) =>
    logBatchEvent({
      actorId,
      novelId,
      volumeId,
      operation: 'delete',
      chapterCount,
      ranges,
      result,
      durationMs: Date.now() - startedAt,
    });

  try {
    const session = await requireAuthorForAction();
    actorId = session.uid;
    ({ volumeId, chapterCount } = readBatchRef(input));

    const { novelId: deletedNovelId, ...body } = await deleteChapters(session.uid, input);
    novelId = deletedNovelId;
    // 「這一批刪了哪幾章」——刪除沒有部分成功，故即為本批全部章號（FR-028a）
    ranges = formatChapterRanges(toChapterRanges(body.deletedNumbers));
    log('ok');
    return { success: true, data: body };
  } catch (err) {
    log(batchResultOfError(err));
    return errorResult(err);
  }
}

/**
 * 發佈／下架的入參只有 `chapterId`，狀態由 Action 決定而非呼叫端傳入 ——
 * 讓呼叫端傳 status 等於多開一個「發佈」與「下架」以外的可能值的入口。
 * 非物件入參原樣交給 Zod 判定，此處不自行擲錯（錯誤語意集中在一處）。
 */
function asObject(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
}
