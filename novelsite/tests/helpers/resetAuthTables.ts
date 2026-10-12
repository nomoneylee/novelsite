import { prisma } from '@/lib/db';

/**
 * 依外鍵順序清空認證域兩張表（Session → User），供每個整合測試檔的 beforeAll 呼叫。
 * MUST NOT 清空 Novel／Chapter 等內容資料表（FR-032）。a11y 套件 MUST NOT 呼叫本函式。
 *
 * FEAT-2 起 `Novel.authorId`（2-A）與 `Review.userId`（2-C）都參照 User，故 MUST 保留
 * 「擁有作品的內容作者」與「發表過評論的讀者」—— 無條件刪除會在 SQLite 觸發外鍵限制
 * （Restrict）而失敗，在 PostgreSQL 若以 `TRUNCATE ... CASCADE` 執行則會連同示範內容
 * 一併刪除，兩者皆違反上述不得清空內容表的規定。
 * 三個示範登入帳號（reader／author／admin）不擁有作品也沒有評論，仍會被清空，
 * 行為與 FEAT-1 一致。
 */
export async function resetAuthTables(): Promise<void> {
  await prisma.session.deleteMany();
  // ── FEAT-4 4-A 讀者狀態（T018）────────────────────────────────────────────
  // 五張表 MUST 在 User 之前清空。`Bookshelf`／`ReadingProgress`／`ReadingHistory`／
  // `ReaderPreference` 對 User 為級聯，本來就會被帶走；但 `BookshelfEvent.userId`
  // **不設 FK**（使用者刪除後事件保留至保留期結束，data-model.md §2.2），
  // 不在此明確清空就會跨測試檔累積 —— 而 T012 斷言的是「該作品的事件恰為一筆」。
  // 另：本組表 MUST 在 `user.deleteMany` 之前刪，否則保留下來的內容作者（有作品者）
  // 名下的讀者狀態會留存，污染下一個檔案的計數斷言。
  await prisma.bookshelfEvent.deleteMany();
  await prisma.bookshelf.deleteMany();
  await prisma.readingProgress.deleteMany();
  await prisma.readingHistory.deleteMany();
  await prisma.readerPreference.deleteMany();
  // ── FEAT-4 4-B 互動（T056）────────────────────────────────────────────────
  // 三張表 MUST 在 User 之前清空，且 MUST 依外鍵順序：`ReviewLike` → `Review`、
  // `Comment`（自我參照的回覆由 `parent` 級聯帶走）。
  // 評論清空後，下一行保留內容作者的條件裡 `reviews: { none: {} }` 對測試帳號恆成立 ——
  // 那正是要的：**測試建立的評論者不該跨檔案留存**，而擁有作品的內容作者仍被 `novels` 擋下。
  await prisma.comment.deleteMany();
  await prisma.reviewLike.deleteMany();
  await prisma.review.deleteMany();
  // ── FEAT-4 4-C 統計（T098）────────────────────────────────────────────────
  // `ChapterView.userId` **不設 FK**（明細於保留期內獨立於帳號存在），故與
  // `BookshelfEvent` 同樣不會被 `user.deleteMany` 帶走 —— 不在此明確清空就會跨測試檔累積，
  // 而 T086／T087 斷言的正是「該章節的明細恰為 N 列」。
  // `NovelDailyStat` 一併清空：彙總的冪等斷言（T088）比對的是逐欄差異，
  // 前一個檔案留下的統計列會讓「無空洞」與「當日不建列」紅在別人的殘留上。
  await prisma.chapterView.deleteMany();
  await prisma.novelDailyStat.deleteMany();
  // ── FEAT-4 4-D 排行與通知（T120）──────────────────────────────────────────
  // `RankingEntry` 不參照 User，但**每一次重算都會整組覆寫**，且名次是「最近一次重算的
  // 結果」——前一個檔案留下的名次會讓「統計為空即空榜」紅在別人的殘留上（T114）。
  // `Notification` 對 User 為級聯，本來就會被下一行帶走；仍明確清空，因為被保留下來的
  // 內容作者（有作品者）名下的通知不會被帶走，而 T116 斷言的是「恰好 N 則」。
  await prisma.rankingEntry.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.user.deleteMany({ where: { novels: { none: {} }, reviews: { none: {} } } });
}
