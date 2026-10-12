/**
 * 資料存取層統一出口（Repositories Barrel）
 * ============================================
 * 應用程式（server component / server action）一律由此 import 取資料。
 * 這一層是「可抽換資料庫」的邊界：底層無論用 SQLite、PostgreSQL…，
 * 對上層而言介面與回傳型別皆不變。
 *
 * 注意：本檔（及其 re-export 的模組）僅限伺服器端使用。client component 一律以 props
 * 接收資料 —— FEAT-4 4-C 刪除 `lib/content.ts`（最後一支公式造假的統計來源，FR-040）之後，
 * 已無「client 可直接引用的示範資料模組」，也不該再有一個。
 */
export * from './novels';
export * from './chapters';
// 搜尋（FEAT-3 3-A）：`searchService` 只經本 barrel 引用，MUST NOT 深層 import
// —— provider 差異封鎖在 `search.ts` 內，深層引用會讓那道封鎖看起來像是可選的
export * from './search';
// 交易客戶端型別：服務層要把「資料寫入 + 計數回填」綁在同一個交易內，
// 故 TxClient 需經同一個出口對外（憲章第 III 條：上層不直接 import Prisma 型別）
export type { TxClient } from './tx';
export { withTransaction } from './tx';
export * from './rankings';
export * from './categories';
// 作者向查詢：全部函式的 authorId 必填（FR-019）。MUST NOT 在此另行匯出任何
// 無擁有者條件的作者查詢——那會讓型別層的強制形同虛設。
export * from './authors';
export * from './health';
export * as usersRepo from './users';
export * as sessionsRepo from './sessions';
// 密碼重設憑證（FEAT-5，T026）：上層 MUST 只由本 barrel 引用（憲章第 III 條）。
// 有效性判準不在這一層 —— 那是 `lib/auth/passwordResetToken.ts` 的 `resetTokenStatus()`
export * as passwordResetTokensRepo from './passwordResetTokens';
// 讀者狀態（FEAT-4 4-A，T022）：書架／收藏事件／續讀／歷史／偏好。
// 上層 MUST 只由本 barrel 引用（`layering.test.ts` 對深層 import 有靜態稽核）。
export * from './bookshelf';
export * from './reading';
// 互動（FEAT-4 4-B，T063）：評論／評論按讚／章節留言。
// 上層 MUST 只由本 barrel 引用（`layering.test.ts` 對深層 import 有靜態稽核）。
export * from './reviews';
export * from './comments';
// 統計（FEAT-4 4-C，T099／T100）：閱讀明細、每日新增量、保留期清理與排行計分取數。
// 本檔是**全站唯一允許 `$queryRaw`** 之處（憲章第 III 條附條件，research R-17）；
// 深層 import 會讓那道界線看起來像是可選的（`layering.test.ts` 有靜態稽核）。
export * from './stats';
// 通知（FEAT-4 4-D，T122／T125）：批次建立、游標列表、標記已讀與 90 天保留期清理。
// 上層 MUST 只由本 barrel 引用（`layering.test.ts` 對深層 import 有靜態稽核）。
export * from './notifications';
// 管理者後台（FEAT-9 / 009-admin-dashboard）：使用者、作品、標籤管理與稽核日誌。
export * as adminRepo from './admin';
export * as auditLogRepo from './auditLog';
