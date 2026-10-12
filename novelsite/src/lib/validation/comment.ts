/**
 * 章節留言的入參驗證（FEAT-4 4-B / T059，data-model.md §4）
 * ===========================================================
 * 三個入口共用本檔：章節留言的發表、章節留言列表、作者的留言管理列表。
 * 查詢字串同屬 FR-005 的「所有入參」，MUST NOT 直接把 `searchParams` 的原值交給服務層。
 */
import { z } from 'zod';
import { MAX_LENGTH } from './common';
import { decodeCursor } from '@/lib/pagination/cursor';

/**
 * 留言內容，trim 後 1–500 字（與評論的 1000 是**兩個不同的上限**）。
 * 長度以 trim 後計，輸出即為 trim 後的字串；全形空白（U+3000）亦視為空白。
 */
const contentField = z
  .string()
  .trim()
  .min(1, '請輸入留言內容')
  .max(MAX_LENGTH.commentContent, `留言內容不得超過 ${MAX_LENGTH.commentContent} 個字`);

/** 識別碼欄位。**空字串被拒** —— `parentId: ''` 會被誤讀為「這是一則頂層留言」 */
const identifier = z.string().trim().min(1, '識別碼不可為空');

/**
 * 發表留言。`parentId` 省略即為頂層留言。
 *
 * 「父留言屬於同一章節且非墓碑」是**資料庫事實**，MUST 由服務層於交易內查證
 * （commentService.create）——Zod 只驗形狀，它看不到那則留言掛在哪一章。
 */
export const commentInputSchema = z.object({
  content: contentField,
  parentId: identifier.optional(),
});
export type CommentInput = z.infer<typeof commentInputSchema>;

/**
 * 不透明游標：於此就地驗可解碼，`decodeCursor` 回 `null` 即轉 400（FR-005）。
 * 留到 repository 才發現的話，`?cursor=%%%` 會變成 500。
 */
const cursorField = z.string().refine((raw) => decodeCursor(raw) !== null, {
  message: '游標格式不正確',
});

/** 每頁筆數：自查詢字串來一律是字串，故先轉整數再驗值域；空字串與非數值皆被拒 */
const limitField = z
  .string()
  .regex(/^\d+$/, '每頁筆數必須是整數')
  .transform((v) => Number.parseInt(v, 10))
  .refine((n) => n >= 1 && n <= 20, '每頁筆數必須介於 1 到 20')
  .optional()
  .default(20);

/** 章節留言列表的查詢字串（`GET /api/chapters/{id}/comments`，公開） */
export const commentListQuerySchema = z.object({
  cursor: cursorField.optional(),
  limit: limitField,
});
export type CommentListQuery = z.infer<typeof commentListQuerySchema>;

/**
 * 作者留言管理列表的查詢字串（`GET /api/author/comments`）。
 *
 * **`novelId` 與 `hidden` 兩個篩選 MUST 同時具備**（2026-08-07 第三輪統一）：
 * 先前 `novelId` 只存在於契約、`hidden` 只存在於任務、`arch.md` §5.4 只寫 `?cursor=`，
 * 三份文件各給一套參數，照任一份實作都會與另外兩份不符。
 *
 * `hidden` 只接受 `true`／`false` 兩個字面值，MUST NOT 用「非空即真」那類寬鬆解讀 ——
 * `?hidden=0` 在那種解讀下會篩出「已隱藏」，與作者按下的按鈕相反。
 */
export const authorCommentListQuerySchema = z.object({
  cursor: cursorField.optional(),
  limit: limitField,
  novelId: identifier.optional(),
  hidden: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type AuthorCommentListQuery = z.infer<typeof authorCommentListQuerySchema>;

/** 隱藏／取消隱藏。**簽章中不存在 `content`** —— 作者不可改寫他人內容（FR-031） */
export const commentHiddenSchema = z.object({
  hidden: z.boolean(),
});
export type CommentHiddenInput = z.infer<typeof commentHiddenSchema>;
