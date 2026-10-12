/**
 * 評論的入參驗證（FEAT-4 4-B / T058，data-model.md §4）
 * =======================================================
 * 涵蓋**酬載與查詢字串兩者**。查詢字串同屬 FR-005 的「所有入參」——
 * `limit` 未驗時 `?limit=100000` 直接就是一次全表掃描，而 400 是比逾時更好的失敗方式。
 *
 * 長度上限取自 `MAX_LENGTH`，MUST NOT 在此重複字面量（FR-029）——
 * 重複的必然結果是漂移，而漂移出來的那一版永遠是比較寬鬆的那一版。
 */
import { z } from 'zod';
import { MAX_LENGTH } from './common';
import { decodeCursor } from '@/lib/pagination/cursor';

/**
 * 評分為 1–5 的**整數**。
 *
 * 刻意不用強制型別轉換：`'5'` 與 `3.5` 都該被拒而非被悄悄修成邊界值 ——
 * 一個把 4.7 收下並存成 4 的實作，使用者看到的星數與他按的不同。
 */
const ratingField = z
  .number()
  .int('評分必須是整數')
  .min(1, '評分最低為 1 星')
  .max(5, '評分最高為 5 星');

/**
 * 評論內容，trim 後 1–1000 字。
 *
 * 長度以 **trim 後**計，且輸出即為 trim 後的字串 —— 存進資料庫的是這一份，
 * 否則「純空白也算有內容」與「前後空白吃掉字數額度」兩件事會同時成立。
 * 全形空白（U+3000）亦為空白，`String.prototype.trim` 已涵蓋。
 */
const contentField = z
  .string()
  .trim()
  .min(1, '請輸入評論內容')
  .max(MAX_LENGTH.reviewContent, `評論內容不得超過 ${MAX_LENGTH.reviewContent} 個字`);

/** 發表評論：兩欄皆必填 */
export const reviewInputSchema = z.object({
  rating: ratingField,
  content: contentField,
});
export type ReviewInput = z.infer<typeof reviewInputSchema>;

/**
 * 編輯評論：兩欄皆可省略（PATCH 語意），但**省略不等於放寬** ——
 * 有給值時仍走同一套規則，故直接沿用同一組欄位加上 `.optional()`。
 */
export const reviewPatchSchema = z.object({
  rating: ratingField.optional(),
  content: contentField.optional(),
});
export type ReviewPatchInput = z.infer<typeof reviewPatchSchema>;

/**
 * 不透明游標：**於此就地驗可解碼**，而非留到 repository 才發現。
 * `decodeCursor` 對無效輸入回 `null` 而不擲出，故這裡是把它轉成 400 的地方（FR-005）。
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

/**
 * 評論列表的查詢字串。
 *
 * `sort` 預設 `hot`：切換排序與首次載入看到的是同一份契約
 * （contracts/interaction-api.md §1）。排序由**伺服器**承擔，客戶端不再自行重排 ——
 * 客戶端只拿得到當前這一頁，對它排序等於只排了 20 則裡的 20 則。
 */
export const reviewListQuerySchema = z.object({
  sort: z.enum(['hot', 'latest']).optional().default('hot'),
  cursor: cursorField.optional(),
  limit: limitField,
});
export type ReviewListQuery = z.infer<typeof reviewListQuerySchema>;
