import { z } from 'zod';
import { MAX_LENGTH } from './common';

/**
 * 卷與章節寫入的驗證規則（FR-003a／FR-003b／FR-003d、FR-006a、FR-019）
 * ======================================================================
 * **編號一律不在入參內**（`Volume.number`／`Chapter.number`）：兩者皆由服務層指派為
 * 「目前最大值 + 1」。若讓作者傳入，唯一約束就從「系統自己維持的不變式」變成
 * 「使用者送什麼就可能撞什麼」，而撞上的表現形式是 500，不是可理解的錯誤。
 */

const volumeIdField = z.string().trim().min(1, '缺少卷識別碼');
const chapterIdField = z.string().trim().min(1, '缺少章節識別碼');
const novelIdField = z.string().trim().min(1, '缺少作品識別碼');

const volumeTitleField = z
  .string()
  .trim()
  .min(1, '請輸入卷標題')
  .max(MAX_LENGTH.volumeTitle, `卷標題不得超過 ${MAX_LENGTH.volumeTitle} 個字`);

const chapterTitleField = z
  .string()
  .trim()
  .min(1, '請輸入章節標題')
  .max(MAX_LENGTH.chapterTitle, `章節標題不得超過 ${MAX_LENGTH.chapterTitle} 個字`);

/**
 * 章節正文：非空、不得超過上限。
 *
 * 長度以 **trim 前的原文**計算 —— 上限存在的目的是擋住寫入端的資料量，
 * 不是計算「有意義的字數」（那是 `countWords` 的事）。
 */
const bodyMarkdownField = z
  .string()
  .max(MAX_LENGTH.chapterBody, `章節正文不得超過 ${MAX_LENGTH.chapterBody} 個字`)
  .refine((v) => v.trim().length > 0, { message: '請輸入章節正文' });

/** 建立卷：作者只填標題，編號由系統指派（FR-003d） */
export const createVolumeSchema = z.object({
  novelId: novelIdField,
  title: volumeTitleField,
});

/** 更新卷：只允許改標題（data-model §3） */
export const updateVolumeSchema = z.object({
  volumeId: volumeIdField,
  title: volumeTitleField,
});

/** 刪除卷（僅空卷，條件由服務層判定） */
export const volumeIdSchema = z.object({ volumeId: volumeIdField });

/** 建立章節：建立標題預設、正文空白的草稿，編號由系統指派（FR-003a） */
export const createChapterSchema = z.object({
  novelId: novelIdField,
  volumeId: volumeIdField,
});

/**
 * 儲存章節：**不改變 `status`**（contracts/server-actions.md §2）。
 * 已發佈章節按「儲存」走的是同一個入口，故 schema 內 MUST NOT 出現 status。
 */
export const saveChapterDraftSchema = z.object({
  chapterId: chapterIdField,
  title: chapterTitleField,
  bodyMarkdown: bodyMarkdownField,
});

/** 發佈／下架（FR-013，雙向） */
export const setChapterStatusSchema = z.object({
  chapterId: chapterIdField,
  status: z.enum(['draft', 'published', 'admin_suspended']),
});

/** 只需章節識別碼的操作（刪除、取消排程） */
export const chapterIdSchema = z.object({ chapterId: chapterIdField });

/**
 * 發佈（FEAT-4 4-D / T128）：`scheduledAt` **省略即立即發佈**。
 *
 * 形狀層只驗「可解析的時間字串」，**「必須是未來」不在這裡驗** ——
 * 那是一個與當下時刻有關的判斷，寫進 schema 會讓同一份輸入在不同時刻有不同結果，
 * 而 schema 是要能被單元測試以固定輸入驗證的（contracts/internal-modules.md §3）。
 * 過去時間的 400 由服務層擲出（FR-049）。
 */
export const publishChapterSchema = z.object({
  chapterId: chapterIdField,
  scheduledAt: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), '排程時間格式不正確')
    .optional(),
});

/**
 * 卷內排序（FR-003b）。
 *
 * 形狀層先擋掉重複識別碼；「與該卷章節集合完全相同」（無缺漏、無外卷）
 * 需要查資料庫，故由服務層在交易內核對。
 */
export const reorderChaptersSchema = z.object({
  volumeId: volumeIdField,
  orderedChapterIds: z
    .array(chapterIdField)
    .min(1, '排序清單不得為空')
    .refine((ids) => new Set(ids).size === ids.length, {
      message: '排序清單內有重複的章節',
    }),
});

export type CreateVolumeInput = z.infer<typeof createVolumeSchema>;
export type UpdateVolumeInput = z.infer<typeof updateVolumeSchema>;
export type VolumeIdInput = z.infer<typeof volumeIdSchema>;
export type CreateChapterInput = z.infer<typeof createChapterSchema>;
export type SaveChapterDraftInput = z.infer<typeof saveChapterDraftSchema>;
export type SetChapterStatusInput = z.infer<typeof setChapterStatusSchema>;
export type ChapterIdInput = z.infer<typeof chapterIdSchema>;
export type PublishChapterInput = z.infer<typeof publishChapterSchema>;
export type ReorderChaptersInput = z.infer<typeof reorderChaptersSchema>;
