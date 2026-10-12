/**
 * 通知與排行的入參驗證（FEAT-4 4-D / T127b，FR-005）
 * ====================================================
 * FR-005 的對象是「**所有**入參」，而 US4 的查詢字串先前無任何驗證模組：
 * `limit` 不驗時 `?limit=100000` 直接就是一次全表掃描，
 * 而 400 是比逾時更好的失敗方式。
 *
 * 排行的 `period`／`categoryId` 也放在本檔（與通知同屬 US4 的查詢字串），
 * 但兩者的**失敗處置不同**，見 `rankingQuerySchema` 的說明。
 */
import { z } from 'zod';
import { decodeCursor } from '@/lib/pagination/cursor';
import { RANKING_PERIODS } from '@/lib/types';

/** 不透明游標：於此就地驗可解碼，`decodeCursor` 回 `null` 即 400（與 `validation/reader.ts` 同式） */
const cursor = z.string().refine((raw) => decodeCursor(raw) !== null, {
  message: '游標格式不正確',
});

/** 查詢字串的 `limit` 一律是字串，故先轉整數再驗值域（1–20，預設 20） */
const limit = z
  .string()
  .regex(/^\d+$/, '每頁筆數必須是整數')
  .transform((v) => Number.parseInt(v, 10))
  .refine((n) => n >= 1 && n <= 20, '每頁筆數必須介於 1 到 20')
  .optional()
  .default(20);

/**
 * `GET /api/notifications` 的查詢字串。
 *
 * `unread` 只接受 `1`／`0`／`true`／`false`：查詢字串沒有布林型別，
 * 用 `Boolean(value)` 換算會讓 `?unread=0` 變成 `true` —— 剛好與使用者的意思相反。
 */
export const notificationListQuerySchema = z.object({
  unread: z
    .enum(['1', '0', 'true', 'false'])
    .transform((v) => v === '1' || v === 'true')
    .optional()
    .default(false),
  cursor: cursor.optional(),
  limit,
});
export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;

/**
 * `PATCH /api/notifications/{id}` 的請求主體。
 *
 * **只接受 `{ read: true }`**（`z.literal`）：契約沒有「標記為未讀」這個動作，
 * 收下 `false` 就得決定它的語意，而那個語意從未被定義過。
 */
export const markNotificationReadSchema = z.object({
  read: z.literal(true),
});

/**
 * 排行查詢（`/ranking` 頁的 `period` 與 `categoryId`）。
 *
 * **非法值回退預設而非擲錯**（T141）：這是一個可被分享、可被手改的網址，
 * 而排行頁沒有任何「輸入」—— 使用者把 `?period=weekley` 貼錯時，
 * 看到週榜比看到一頁 400 合理。故本 schema 的每一格都有預設值且不擲出，
 * 呼叫端以 `safeParse` 取 `data ?? 預設`。
 *
 * 通知的查詢字串**刻意不比照辦理**：那是資料存取的分頁參數，
 * 悄悄回退會讓客戶端以為自己送出的 `limit` 生效了。
 */
export const rankingQuerySchema = z.object({
  period: z.enum(RANKING_PERIODS).optional().default('weekly'),
  /** `'all'`（全站榜）或 `Category.id`；不存在的分類會查到空榜，由 UI 呈現空狀態 */
  categoryId: z.string().min(1).optional().default('all'),
});
export type RankingQuery = z.infer<typeof rankingQuerySchema>;
