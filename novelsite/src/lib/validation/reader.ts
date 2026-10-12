/**
 * 讀者狀態的入參驗證（FEAT-4 4-A / T023，data-model.md §4）
 * ==========================================================
 * 涵蓋**酬載與查詢字串兩者**。查詢字串同屬 FR-005 的「所有入參」——
 * `limit` 未驗時 `?limit=100000` 直接就是一次全表掃描，而 400 是比逾時更好的失敗方式。
 *
 * 上限值不在本檔硬編：`MERGE_BATCH_MAX` 是設定值（data-model.md §9），
 * 故合併酬載以工廠函式產生 schema，由服務層餵入 `env` 的值。
 */
import { z } from 'zod';
import { decodeCursor } from '@/lib/pagination/cursor';

export const FONT_SIZES = ['sm', 'md', 'lg'] as const;
export const THEMES = ['light', 'dark', 'eyecare'] as const;

const identifier = z.string().min(1, '識別碼不可為空');

/** 0–100 的整數。`3.5`、`'80'`、`NaN` 一律被拒（強制型別會讓越界值悄悄變成邊界值） */
const percent = z
  .number()
  .int('進度百分比必須是整數')
  .min(0, '進度百分比不可小於 0')
  .max(100, '進度百分比不可大於 100');

export const progressReportSchema = z.object({
  novelId: identifier,
  chapterId: identifier,
  percent,
});
export type ProgressReportInput = z.infer<typeof progressReportSchema>;

/**
 * 偏好的同步範圍**只有**字級與主題（FR-014）。
 * 兩者皆為可選（PUT 允許只改一項）；未定義的欄位由 Zod 的預設行為剝除，
 * 故 `lineHeight` 之類的東西挾帶不進來。
 */
export const readerPreferenceSchema = z.object({
  fontSize: z.enum(FONT_SIZES).optional(),
  theme: z.enum(THEMES).optional(),
});
export type ReaderPreferenceInput = z.infer<typeof readerPreferenceSchema>;

/**
 * 不透明游標：**於此就地驗可解碼**，而非留到 repository 才發現。
 * `decodeCursor` 對無效輸入回 `null` 而不擲出，故這裡是把它轉成 400 的地方（FR-005）。
 */
const cursor = z.string().refine((raw) => decodeCursor(raw) !== null, {
  message: '游標格式不正確',
});

/**
 * 列表查詢字串（書架 `GET /api/bookshelf`、歷史 `GET /api/history` 共用）。
 * `limit` 自查詢字串來一律是字串，故先轉整數再驗值域；空字串與非數值皆被拒。
 */
export const listQuerySchema = z.object({
  cursor: cursor.optional(),
  limit: z
    .string()
    .regex(/^\d+$/, '每頁筆數必須是整數')
    .transform((v) => Number.parseInt(v, 10))
    .refine((n) => n >= 1 && n <= 20, '每頁筆數必須介於 1 到 20')
    .optional()
    .default(20),
});
export type ListQueryInput = z.infer<typeof listQuerySchema>;

/**
 * `DELETE /api/history` 的查詢字串。
 * `novelId` 省略即清空全部；**空字串被拒** —— `?novelId=` 會被誤讀為「清空全部」，
 * 而那是使用者按錯一個按鈕與刪掉整份歷史之間的差別。
 */
export const historyDeleteQuerySchema = z.object({
  novelId: identifier.optional(),
});

/** 合併酬載的單筆歷史。`readAt` 來自本機，MUST 為可解析的時間字串 */
const mergeHistoryEntrySchema = z.object({
  novelId: identifier,
  chapterId: identifier,
  readAt: z.string().refine((v) => !Number.isNaN(Date.parse(v)), '閱讀時間格式不正確'),
});

/**
 * 合併酬載。每類陣列長度上限為 `MERGE_BATCH_MAX`（預設 200）——
 * 超出時**由客戶端先依時間取最近者截斷**並在 `truncated` 標示，伺服器原樣回傳，
 * 前端據此明確告知使用者有部分未同步（FR-016a，MUST NOT 靜默捨棄）。
 */
export function makeMergePayloadSchema(batchMax: number) {
  return z.object({
    bookshelf: z.array(identifier).max(batchMax, `書架單次合併上限為 ${batchMax} 筆`),
    history: z.array(mergeHistoryEntrySchema).max(batchMax, `歷史單次合併上限為 ${batchMax} 筆`),
    preference: readerPreferenceSchema.optional(),
    truncated: z
      .object({ bookshelf: z.boolean().optional(), history: z.boolean().optional() })
      .optional(),
  });
}
export type MergePayloadInput = z.infer<ReturnType<typeof makeMergePayloadSchema>>;
