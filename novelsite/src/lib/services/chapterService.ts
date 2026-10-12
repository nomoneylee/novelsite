import 'server-only';
import {
  createVolumeRow,
  updateVolumeTitle,
  deleteVolumeIfEmpty,
  getVolumeOwnerNovelId,
  getVolumeChapterRefs,
  createChapterRow,
  saveChapterDraftRow,
  setChapterStatusRow,
  deleteChapterRow,
  getChapterOwnerRefs,
  reorderWithinVolume,
  refreshNovelCounters,
  touchNovel,
  withTransaction,
  setChapterScheduledAt,
  findDueScheduled,
  publishScheduledChapterRow,
  getChapterNotifyRef,
} from '@/lib/repositories';
import { assertNovelOwner, NotFoundError } from '@/lib/auth/ownership';
import { invalidateNovel, invalidateNovelsList, invalidateChapter } from '@/lib/cache';
import { stripControlChars, countWords } from '@/lib/validation/common';
import {
  createVolumeSchema,
  updateVolumeSchema,
  volumeIdSchema,
  createChapterSchema,
  saveChapterDraftSchema,
  setChapterStatusSchema,
  chapterIdSchema,
  reorderChaptersSchema,
  publishChapterSchema,
} from '@/lib/validation/chapter';
import { notifyNewChapters } from './notificationService';
import { ServiceError, parseOrThrow, translateDbError } from './errors';

/**
 * 卷與章節寫入的業務規則（FR-003a～FR-003d、FR-009、FR-011、FR-013、FR-019）
 * ===========================================================================
 * 擁有權**經作品推導**：先問「這個卷／章節屬於哪一部作品」，再對那部作品跑擁有者守衛。
 * 查不到（`null`）與不屬於該作者，在這一層匯流成同一個 `NOT_FOUND` ——
 * 若讓兩者走不同的分支，回應遲早會長得不一樣，而差異本身就是洩漏（FR-004）。
 *
 * **章節異動即作品有更新**（data-model.md §2.2、FEAT-3 3-A）：建立／儲存／發佈／下架／
 * 刪除／排序**六處**皆於同一交易內推進 `Novel.updatedAt`。漏掉的話，作者更新章節後
 * 作品不會在搜尋結果上浮 —— 而那正是 FR-034 選用「更新時間」當排序鍵的理由。
 * `searchText` 不含章節內容，故此處只推排序鍵、不重算預算。
 */

export { ServiceError } from './errors';

// ─────────────────────────────────────────────
// 純函式（單元測試對象，contracts/internal-modules.md §1.2）
// ─────────────────────────────────────────────

/**
 * 字數 = 去除所有空白後的字元數（FR-011，沿用 FEAT-2 的推導規則）。
 *
 * **本體已移至 `@/lib/validation/common`**（FEAT-7 T004）：批次匯入的預覽在瀏覽器端
 * 計字數，而本檔首行是 `import 'server-only'`，client component 引用不到。
 * 此處保留 re-export，既有呼叫端與 `tests/unit/chapterService.test.ts` 的 import 路徑一律不變。
 * （本檔內部亦呼叫它，故以 import + export 而非 `export … from`：後者不建立本地繫結。）
 */
export { countWords };

/**
 * 寫入前的正文淨化（FR-019）：濾除控制字元，保留 `\t`／`\n`／`\r`。
 * **不做 trim** —— 作者刻意留的首行縮排與段末空白屬於內容。
 */
export function sanitizeBody(bodyMarkdown: string): string {
  return stripControlChars(bodyMarkdown);
}

// ─────────────────────────────────────────────
// 共用：錯誤轉譯與擁有權推導
// ─────────────────────────────────────────────

function toServiceError(err: unknown, conflictMessage: string): ServiceError {
  if (err instanceof NotFoundError) {
    return new ServiceError('NOT_FOUND', '找不到指定的資源');
  }
  return translateDbError(err, conflictMessage);
}

const NOT_FOUND = () => new ServiceError('NOT_FOUND', '找不到指定的資源');

/** 卷 → 作品，並確認擁有權；不存在與非擁有者結果完全相同 */
async function ownerNovelOfVolume(uid: string, volumeId: string): Promise<string> {
  const novelId = await getVolumeOwnerNovelId(volumeId);
  if (!novelId) throw NOT_FOUND();
  await assertNovelOwner(uid, novelId);
  return novelId;
}

/** 章節 → 作品，並確認擁有權 */
async function ownerRefsOfChapter(
  uid: string,
  chapterId: string
): Promise<{ novelId: string; volumeId: string }> {
  const refs = await getChapterOwnerRefs(chapterId);
  if (!refs) throw NOT_FOUND();
  await assertNovelOwner(uid, refs.novelId);
  return { novelId: refs.novelId, volumeId: refs.volumeId };
}

// ─────────────────────────────────────────────
// 卷（FR-003c／FR-003d）
// ─────────────────────────────────────────────

export async function createVolume(uid: string, input: unknown): Promise<{ volumeId: string }> {
  const data = parseOrThrow(createVolumeSchema, input);

  try {
    await assertNovelOwner(uid, data.novelId);
    const volumeId = await createVolumeRow(data.novelId, data.title);

    invalidateNovel(data.novelId);
    return { volumeId };
  } catch (err) {
    // 併發建卷撞號 → 唯一約束 → CONFLICT（FR-003d）
    throw toServiceError(err, '卷編號重複，請重試');
  }
}

export async function updateVolume(uid: string, input: unknown): Promise<void> {
  const data = parseOrThrow(updateVolumeSchema, input);

  try {
    const novelId = await ownerNovelOfVolume(uid, data.volumeId);
    await updateVolumeTitle(data.volumeId, data.title);
    invalidateNovel(novelId);
  } catch (err) {
    throw toServiceError(err, '卷更新衝突，請重試');
  }
}

export async function deleteVolume(uid: string, input: unknown): Promise<void> {
  const data = parseOrThrow(volumeIdSchema, input);

  try {
    const novelId = await ownerNovelOfVolume(uid, data.volumeId);
    const deleted = await deleteVolumeIfEmpty(data.volumeId);
    if (!deleted) {
      throw new ServiceError('CONFLICT', '這一卷還有章節，請先移除或搬走章節再刪除卷');
    }
    invalidateNovel(novelId);
  } catch (err) {
    throw toServiceError(err, '卷刪除衝突，請重試');
  }
}

// ─────────────────────────────────────────────
// 章節（FR-003a／FR-003b、FR-011、FR-013、FR-019）
// ─────────────────────────────────────────────

export async function createChapter(uid: string, input: unknown): Promise<{ chapterId: string }> {
  const data = parseOrThrow(createChapterSchema, input);

  try {
    await assertNovelOwner(uid, data.novelId);

    // 卷必須屬於同一部作品 —— 少了這一步，作者可以把章節掛到別人的卷底下
    const volumeNovelId = await getVolumeOwnerNovelId(data.volumeId);
    if (volumeNovelId !== data.novelId) throw NOT_FOUND();

    const { chapterId } = await withTransaction(async (tx) => {
      const created = await createChapterRow(data.novelId, data.volumeId, tx);
      await touchNovel(data.novelId, new Date(), tx);
      return created;
    });

    invalidateNovel(data.novelId);
    return { chapterId };
  } catch (err) {
    // 併發建章撞號 → 唯一約束 → CONFLICT（FR-009、案例 17）
    throw toServiceError(err, '章節編號重複，請重試');
  }
}

export async function saveChapterDraft(
  uid: string,
  input: unknown
): Promise<{ wordCount: number }> {
  const data = parseOrThrow(saveChapterDraftSchema, input);

  try {
    const { novelId } = await ownerRefsOfChapter(uid, data.chapterId);

    const body = sanitizeBody(data.bodyMarkdown);
    const wordCount = countWords(body);

    await withTransaction(async (tx) => {
      await saveChapterDraftRow(
        data.chapterId,
        { title: data.title, bodyMarkdown: body, wordCount },
        tx
      );
      // 已發佈章節按「儲存」走同一入口，字數變動會影響作品計數，故一併重算
      await refreshNovelCounters(novelId, tx);
      await touchNovel(novelId, new Date(), tx);
    });

    invalidateChapter(data.chapterId);
    invalidateNovel(novelId);
    return { wordCount };
  } catch (err) {
    throw toServiceError(err, '章節儲存衝突，請重試');
  }
}

export async function setChapterStatus(uid: string, input: unknown): Promise<void> {
  const data = parseOrThrow(setChapterStatusSchema, input);

  if (data.status === 'admin_suspended') {
    throw new ServiceError('FORBIDDEN', '無法將章節狀態設為管理員下架');
  }

  try {
    const { novelId, status } = await ownerRefsWithStatus(uid, data.chapterId);
    if (status === 'admin_suspended') {
      throw new ServiceError(
        'FORBIDDEN',
        '此章節已被管理員下架，無法自主變更狀態，如有疑問請聯繫客服'
      );
    }

    await withTransaction(async (tx) => {
      await setChapterStatusRow(data.chapterId, data.status, tx);
      await refreshNovelCounters(novelId, tx);
      await touchNovel(novelId, new Date(), tx);
    });

    invalidateChapter(data.chapterId);
    invalidateNovel(novelId);
    invalidateNovelsList();
  } catch (err) {
    if (err instanceof ServiceError) throw err;
    throw toServiceError(err, '章節狀態更新衝突，請重試');
  }
}

export async function deleteChapter(uid: string, input: unknown): Promise<void> {
  const data = parseOrThrow(chapterIdSchema, input);

  try {
    const { novelId } = await ownerRefsOfChapter(uid, data.chapterId);

    await withTransaction(async (tx) => {
      await deleteChapterRow(data.chapterId, tx);
      await refreshNovelCounters(novelId, tx);
      await touchNovel(novelId, new Date(), tx);
    });

    invalidateChapter(data.chapterId);
    invalidateNovel(novelId);
    invalidateNovelsList();
  } catch (err) {
    throw toServiceError(err, '章節刪除衝突，請重試');
  }
}

/**
 * 卷內排序（FR-003b）。
 *
 * `orderedChapterIds` MUST 與該卷章節集合**完全相同**（無缺漏、無重複、無外卷）。
 * 形狀與重複由 Zod 擋；集合相等要查資料庫，故在此核對，且核對與寫入同在一個交易內 ——
 * 分開做的話，兩者之間有人新增了一章，寫入就會落在一個已經不成立的前提上。
 */
export async function reorderChapters(uid: string, input: unknown): Promise<void> {
  const data = parseOrThrow(reorderChaptersSchema, input);

  try {
    const novelId = await ownerNovelOfVolume(uid, data.volumeId);

    await withTransaction(async (tx) => {
      const refs = await getVolumeChapterRefs(data.volumeId, tx);
      const actual = new Set(refs.map((r) => r.id));
      const requested = new Set(data.orderedChapterIds);

      const sameSize = actual.size === requested.size;
      const sameMembers = [...requested].every((id) => actual.has(id));
      if (!sameSize || !sameMembers) {
        throw new ServiceError('VALIDATION_ERROR', '排序清單與該卷的章節不一致', {
          fields: { orderedChapterIds: '排序清單必須剛好包含這一卷的全部章節' },
        });
      }

      await reorderWithinVolume(data.volumeId, data.orderedChapterIds, tx);
      await touchNovel(novelId, new Date(), tx);
    });

    invalidateNovel(novelId);
  } catch (err) {
    throw toServiceError(err, '章節排序衝突，請重試');
  }
}

// ─────────────────────────────────────────────
// 排程發佈與追更通知（FEAT-4 4-D，T128，FR-049～FR-052a）
// ─────────────────────────────────────────────

/**
 * 發佈章節（立即或排程）。
 *
 * | `scheduledAt` | 行為 |
 * | --- | --- |
 * | 省略 | 立即發佈；對收藏者產生一則追更通知（`chapterCount=1`） |
 * | **未來**時間 | 寫入 `Chapter.scheduledAt`，維持 `status='draft'`（讀者不可見） |
 * | **過去**時間 | **400**，且**不建立無效排程**（FR-049） |
 *
 * 過去時間 MUST NOT 被「寬容地」當成立即發佈：那與作者的意思相同的機率不高，
 * 而寫進去的話，下一次掃描就會立刻發佈它 —— 結果等同立即發佈，作者卻以為自己排了程。
 *
 * 立即發佈時 `scheduledAt` 於**同一交易內清為 `null`**：先排程、後改成手動發佈的章節
 * 若留著那一欄，下一次掃描會再選中它（雖然 `status` 已排除，但那是兩道防線裡的第二道）。
 */
export async function publishChapter(uid: string, input: unknown): Promise<void> {
  const data = parseOrThrow(publishChapterSchema, input);

  if (data.scheduledAt !== undefined) {
    return schedulePublish(uid, data.chapterId, new Date(data.scheduledAt));
  }

  let published: { novelId: string; chapterId: string } | null = null;
  try {
    const { novelId, status } = await ownerRefsWithStatus(uid, data.chapterId);
    if (status === 'admin_suspended') {
      throw new ServiceError('FORBIDDEN', '此章節已被管理員下架，無法自主發佈，如有疑問請聯繫客服');
    }

    await withTransaction(async (tx) => {
      await setChapterStatusRow(data.chapterId, 'published', tx);
      // 手動發佈同樣清掉排程 —— 這一欄就是重複發佈的防護，只在 cron 路徑清掉不夠
      await setChapterScheduledAt(data.chapterId, null, tx);
      await refreshNovelCounters(novelId, tx);
      await touchNovel(novelId, new Date(), tx);
    });

    invalidateChapter(data.chapterId);
    invalidateNovel(novelId);
    invalidateNovelsList();

    // **只有真的由草稿轉為已發佈才通知**：已發佈章節再按一次發佈是無害的操作，
    // 但重發一次追更通知不是 —— 收藏者會為同一章收到第二則
    if (status === 'draft') published = { novelId, chapterId: data.chapterId };
  } catch (err) {
    if (err instanceof ServiceError) throw err;
    throw toServiceError(err, '章節狀態更新衝突，請重試');
  }

  if (published) {
    const chapter = await getChapterNotifyRef(published.chapterId);
    if (chapter) await notifyNewChapters(published.novelId, [chapter]);
  }
}

/**
 * 寫入排程時刻（維持草稿）。過去時間 → `VALIDATION_ERROR`（FR-049）。
 *
 * 同一章節多次改排程覆寫同一欄，**不留多個待發佈狀態**（data-model.md §3.2）。
 */
export async function schedulePublish(
  uid: string,
  chapterId: string,
  scheduledAt: Date
): Promise<void> {
  try {
    const { novelId, status } = await ownerRefsWithStatus(uid, chapterId);
    if (status === 'admin_suspended') {
      throw new ServiceError('FORBIDDEN', '此章節已被管理員下架，無法排程發佈，如有疑問請聯繫客服');
    }

    if (scheduledAt.getTime() <= Date.now()) {
      throw new ServiceError('VALIDATION_ERROR', '排程時間必須是未來時間', {
        fields: { scheduledAt: '請選擇未來的時間，或改用立即發佈' },
      });
    }

    await setChapterScheduledAt(chapterId, scheduledAt);
    invalidateNovel(novelId);
  } catch (err) {
    if (err instanceof ServiceError) throw err;
    throw toServiceError(err, '章節排程更新衝突，請重試');
  }
}

/** 取消排程（清 `scheduledAt`，維持草稿） */
export async function cancelSchedule(uid: string, input: unknown): Promise<void> {
  const data = parseOrThrow(chapterIdSchema, input);

  try {
    const { novelId } = await ownerRefsOfChapter(uid, data.chapterId);
    await setChapterScheduledAt(data.chapterId, null);
    invalidateNovel(novelId);
  } catch (err) {
    throw toServiceError(err, '章節排程更新衝突，請重試');
  }
}

export interface PublishDueResult {
  chaptersPublished: number;
  novelsAffected: number;
  notificationsCreated: number;
}

/**
 * 到期排程章節的批次發佈（FR-051、FR-052a）——**無 session 入參**。
 *
 * 呼叫端是 `/api/cron/publish-scheduled`，該入口的授權是 cron 密鑰而非工作階段；
 * 沿用以 session 判定擁有權的 `publishChapter` 會逼出一個假的系統身分。
 *
 * ```
 * findDueScheduled(now) → 逐章於交易內發佈並回填計數
 *                       → 對**本次實際**轉為已發佈者 group by novelId
 *                       → 每組呼叫一次 notifyNewChapters（一組章節 → 一則通知）
 * ```
 *
 * **通知 MUST 在全部發佈完成之後才發**，且以「本次實際成功的集合」為準：
 * 逐章邊發邊通知的話，同一作品的 M 章會產生 M 則 —— 那正是 FR-052a 要擋的。
 *
 * **重跑時集合為空**（`scheduledAt` 已清為 `null`），三個計數皆為 0，不產生第二則通知。
 * 已被作者手動發佈或刪除者由掃描條件自然排除，**不報錯** —— 單章的狀態
 * MUST NOT 讓整批發佈停擺。
 */
export async function publishDueScheduled(now: Date): Promise<PublishDueResult> {
  const due = await findDueScheduled(now);

  const publishedByNovel = new Map<string, { id: string; number: number; title: string }[]>();

  for (const chapter of due) {
    // 掃描與寫入之間作者剛好自己按了發佈 → `updateMany` 影響 0 列 → 不計入本次，
    // 也就不會為它再發一次通知
    const done = await withTransaction(async (tx) => {
      const ok = await publishScheduledChapterRow(chapter.id, now, tx);
      if (!ok) return false;
      await refreshNovelCounters(chapter.novelId, tx);
      await touchNovel(chapter.novelId, now, tx);
      return true;
    });
    if (!done) continue;

    const group = publishedByNovel.get(chapter.novelId) ?? [];
    group.push({ id: chapter.id, number: chapter.number, title: chapter.title });
    publishedByNovel.set(chapter.novelId, group);

    invalidateChapter(chapter.id);
  }

  let chaptersPublished = 0;
  let notificationsCreated = 0;
  for (const [novelId, chapters] of publishedByNovel) {
    chaptersPublished += chapters.length;
    notificationsCreated += await notifyNewChapters(novelId, chapters);
    invalidateNovel(novelId);
  }
  if (publishedByNovel.size > 0) invalidateNovelsList();

  return {
    chaptersPublished,
    novelsAffected: publishedByNovel.size,
    notificationsCreated,
  };
}

/** 章節 → 作品 + 目前狀態，並確認擁有權（發佈需要知道「原本是不是草稿」） */
async function ownerRefsWithStatus(
  uid: string,
  chapterId: string
): Promise<{ novelId: string; status: string }> {
  const refs = await getChapterOwnerRefs(chapterId);
  if (!refs) throw NOT_FOUND();
  await assertNovelOwner(uid, refs.novelId);
  return { novelId: refs.novelId, status: refs.status };
}
