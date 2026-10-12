/**
 * NovelSite 領域型別（Domain Types）
 * ===================================
 * 純型別定義，client / server 皆可 import，不含任何資料庫相依。
 * repository 層一律回傳這些型別，讓上層與 Prisma / 特定資料庫解耦。
 */

export interface Novel {
  id: string;
  title: string;
  author: string;
  cover?: string;
  coverColor: string; // 封面主色（無圖時的漸層色）
  category: string;
  wordCount: number;
  chapterCount: number;
  rating: number;
  excerpt: string;
  tags?: string[];
  isNew?: boolean;
  isFeatured?: boolean;
  weeklyViews?: number;
  updateFreq?: string;
}

export interface Chapter {
  id: string;
  number: number;
  title: string;
  wordCount: number;
  publishedAt: string; // YYYY-MM-DD
  isLatest?: boolean;
}

export interface Volume {
  id: string;
  number: number;
  title: string;
  chapters: Chapter[];
}

/**
 * 評論列表的一則（FEAT-4 4-B，contracts/interaction-api.md §1）。
 *
 * 取代原本的 `Review` 展示型別：後者的 `publishedAt`／`likes`／`isHot` 三個欄位
 * 隨 `base.prisma` 的改寫一併消失（`isHot` 無來源可維護，熱門改由伺服器排序決定），
 * 而 `likedByMe` 是新的必要資訊 —— 沒有它，按讚鍵無從知道自己按過沒有。
 */
export interface ReviewItem {
  id: string;
  rating: number; // 1-5
  content: string;
  likeCount: number;
  /** 未登入時固定為 `false`，且 MUST NOT 因此多發一次查詢（契約 §1） */
  likedByMe: boolean;
  /** 是否為當前讀者自己的評論（編輯與刪除入口的顯示依據） */
  mine: boolean;
  createdAt: string; // ISO datetime
  updatedAt: string; // ISO datetime
  user: { name: string; avatarColor: string };
}

/** 評論列表的一頁（`hot` 或 `latest`，決勝鍵一律 `id ASC`） */
export interface ReviewPage {
  items: ReviewItem[];
  nextCursor: string | null;
}

/**
 * 章節留言的一則。
 *
 * 墓碑（使用者已刪除）於 mapper 就置換完成：`content` 為固定文案、`user` 為 `null`、
 * `canLike`／`canReply` 為 `false`。**原文 MUST NOT 出現在本型別的任何欄位**——
 * 「前端不要顯示」不是保護，回應主體裡有就是外洩（FR-027）。
 */
export interface CommentNode {
  id: string;
  content: string;
  createdAt: string; // ISO datetime
  /** 墓碑為 `null`，其餘為發言者 */
  user: { name: string; avatarColor: string } | null;
  /** 本階段留言按讚無後端，恆為 `false`（spec Out of Scope） */
  canLike: boolean;
  canReply: boolean;
  /** 是否為當前讀者自己的留言（刪除入口的顯示依據） */
  canDelete: boolean;
}

/** 一個樓層：頂層留言加掛在它下面的回覆（本階段只有兩層） */
export interface CommentThread extends CommentNode {
  replies: CommentNode[];
}

export interface CommentThreadPage {
  items: CommentThread[];
  nextCursor: string | null;
}

/** 作者留言管理列表的一則（contracts/interaction-api.md §3） */
export interface AuthorCommentItem {
  id: string;
  content: string;
  createdAt: string; // ISO datetime
  hidden: boolean;
  user: { name: string; avatarColor: string };
  novelId: string;
  novelTitle: string;
  chapterId: string;
  chapterTitle: string;
}

export interface AuthorCommentPage {
  items: AuthorCommentItem[];
  nextCursor: string | null;
}

export interface NovelDetail extends Novel {
  description: string; // 完整長版簡介
  status: 'ongoing' | 'completed' | 'hiatus';
  authorBio: string;
  totalViews: number;
  favoriteCount: number;
  commentCount: number;
  /** 評分人數（FEAT-4 4-B）。評分總覽顯示的「共 N 則評論」以它為準，MUST NOT 用 `commentCount` —— 後者含章節留言 */
  ratingCount: number;
  latestChapterId: string;
  firstChapterId: string;
  volumes: Volume[];
  // 註（FEAT-4 4-B）：原 `reviews: Review[]` 已移除。評論改為游標分頁的獨立端點
  // （`GET /api/novels/{id}/reviews`），詳情頁只由伺服器渲染**第一頁**（FR-023a）——
  // 一次把全部評論塞進詳情查詢，作品越受歡迎頁面越慢，而那是最不該慢的頁。
  relatedIds: string[]; // 相關作品 id
}

export interface RankingItem {
  rank: number;
  novel: Novel;
  change?: 'up' | 'down' | 'same' | 'new';
  changeCount?: number;
}

/**
 * 排行週期的值域。**以陣列為單一真相**（`RankingPeriod` 由它推導）：
 * 驗證層需要一份可列舉的值（`z.enum`），而型別在執行期不存在 ——
 * 兩邊各寫一份的話，加一個週期時只會改到其中一邊。
 */
export const RANKING_PERIODS = ['weekly', 'monthly', 'alltime'] as const;

export type RankingPeriod = (typeof RANKING_PERIODS)[number];

/**
 * 排行榜的一列（FEAT-4 4-D / T125）——**最近一次重算的結果**。
 *
 * 與 `RankingItem` 的差別是多出 `score` 與 `computedAt` 兩格：前者是名次的推導依據
 * （FR-045 的四項計分），後者讓畫面說得出「這份榜是什麼時候算的」。
 * 兩者的共同欄位刻意保持同名同型，既有的排行元件因而不必為此改寫。
 */
export interface RankingEntryView extends RankingItem {
  /** `views×1.0 + favorites×8.0 + comments×4.0 + rating×ratingCount×0.5` */
  score: number;
  /** 本列所屬的那一次重算時刻（ISO 字串） */
  computedAt: string;
}

/**
 * 站內通知的一列（FEAT-4 4-D / T125）。
 *
 * `payload` 於資料庫是 **JSON 字串**（雙軌相容，data-model.md §2.8），
 * 由 mapper 解析後交給上層 —— 每個消費端各自 `JSON.parse` 一次的話，
 * 壞掉的酬載會在畫面上變成一個未捕捉的例外。
 */
export interface NotificationItem {
  id: string;
  /** 本階段只會是 `chapter_published`（FR-054） */
  type: string;
  payload: NotificationPayload;
  /** `null` 即未讀 */
  readAt: string | null;
  createdAt: string;
}

/**
 * 追更通知的酬載（data-model.md §2.8 的固定六欄）。
 *
 * 全部欄位為可選：酬載存的是**寫入當下**的快照字串，作品改名或章節刪除都不會回頭改它，
 * 而不同型別的通知（本階段不產生）也不會有相同的欄位。
 * UI MUST 對缺欄位有退路，MUST NOT 假設六欄恆在。
 */
export interface NotificationPayload {
  novelId?: string;
  novelSlug?: string;
  novelTitle?: string;
  chapterCount?: number;
  latestChapterId?: string;
  latestChapterTitle?: string;
}

export interface Category {
  id: string;
  label: string;
  emoji: string;
  description: string;
  color: string;
  bgColor: string;
}

export interface ChapterContext {
  novel: NovelDetail;
  volume: Volume;
  chapter: Chapter;
  /**
   * 章節正文的 **Markdown 原文**（FEAT-3 FR-017、research R-8）。
   *
   * 原為 `paragraphs: string[]`（資料存取層先切好段落）。改為原文是
   * 「編輯器預覽與讀者端共用同一個 `<SafeMarkdown>`」的必要條件：
   * 若閱讀頁吃的是切好的段落，就必然存在第二條渲染路徑，共用即失效 ——
   * 而「作者在預覽看到的」與「讀者實際讀到的」一旦分家，預覽就不再是保證。
   */
  bodyMarkdown: string;
  prevChapterId: string | null;
  nextChapterId: string | null;
  progressInVolume: number; // 0-100，該章節在整本書中的粗略進度
}

// ─────────────────────────────────────────────
// 搜尋（FEAT-3 3-A，data-model.md §9）
//
// `Novel.searchText` 與 `Novel.updatedAt` **不對外曝露**：兩者是搜尋的內部實作，
// 一旦進了領域型別就會有人拿去顯示，而顯示出來的那一刻它們就不再能自由改動。
// ─────────────────────────────────────────────

/** 即時建議清單的單筆（FR-031）：只有導向所需的識別碼與看得懂是哪一部的兩個欄位 */
export interface NovelSuggestion {
  id: string;
  title: string;
  /** 作者的公開顯示名（`penName ?? name`） */
  author: string;
}

/** 游標分頁的一頁結果（FR-030a）；`nextCursor` 為 null 即無下一頁 */
export interface SearchPage {
  items: Novel[];
  nextCursor: string | null;
}

// ─────────────────────────────────────────────
// 作者後台
// ─────────────────────────────────────────────
export type NovelStatus = 'published' | 'draft' | 'hiatus' | 'admin_suspended';
export type ChapterStatus = 'draft' | 'published' | 'admin_suspended';

/** 作者後台的作品摘要；資料來源為 `Novel`（`authorId` + `status`），結構與改名前相同 */
export interface AuthorWorkSummary {
  id: string;
  title: string;
  coverColor: string;
  category: string;
  status: NovelStatus;
  chapterCount: number;
  wordCount: number;
  totalViews: number;
  favoriteCount: number;
  commentCount: number;
  updatedAt: string; // ISO date string
}

/** 作者後台的章節摘要；資料來源為 `Chapter` + `ChapterContent`，結構與改名前相同 */
export interface AuthorChapterSummary {
  id: string;
  novelId: string;
  novelTitle: string;
  number: number;
  title: string;
  contentMarkdown: string;
  status: 'draft' | 'published';
  updatedAt: string;
  /**
   * 排程發佈時刻的 ISO 字串（FEAT-4 4-D / T140）；未排程為 `null`。
   * **僅 `status='draft'` 時有意義** —— 發佈成功時它會於同一交易內被清為 `null`。
   */
  scheduledAt: string | null;
}

/**
 * 標籤選項（作品管理頁的多選來源，FR-012c）。
 *
 * 只有識別碼與顯示名 —— 作者**只能自既有集合挑選，不能新增標籤名稱**，
 * 故不需要任何可寫入的欄位。
 */
export interface TagOption {
  id: string;
  name: string;
}

/**
 * 作品管理頁（`/author/novels/{novelId}`）所需的完整結構（FR-012a）。
 *
 * 與公開的 `NovelDetail` **刻意分開**：管理頁要看得到草稿章節與尚未指派的欄位
 * （`categoryId`／`tagIds` 是給表單回填用的識別碼，不是給讀者看的 label），
 * 公開型別若為此擴張，草稿就有機會沿著同一條路徑漏到讀者端。
 */
export interface AuthorManageChapter {
  id: string;
  number: number;
  title: string;
  status: 'draft' | 'published' | 'admin_suspended';
  wordCount: number;
  updatedAt: string; // YYYY-MM-DD
}

export interface AuthorManageVolume {
  id: string;
  number: number;
  title: string;
  chapters: AuthorManageChapter[];
}

export interface AuthorNovelManage {
  id: string;
  title: string;
  excerpt: string;
  description: string;
  categoryId: string;
  category: string; // 分類 label（顯示用）
  coverColor: string;
  /** 發佈狀態（draft | published | admin_suspended），與連載狀態互相獨立 */
  status: 'draft' | 'published' | 'admin_suspended';
  serialStatus: 'ongoing' | 'completed' | 'hiatus';
  tagIds: string[];
  wordCount: number;
  chapterCount: number;
  volumes: AuthorManageVolume[];
}

export interface DailyStat {
  date: string; // ISO date（僅日期）
  views: number;
  favorites: number;
  comments: number;
}

export interface AuthorSummary {
  totalViews: number;
  totalFavorites: number;
  totalComments: number;
  totalNovels: number;
}

// ─────────────────────────────────────────────
// 使用者系統
// ─────────────────────────────────────────────
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  avatarColor: string;
  createdAt: string; // ISO date string；mapper 以 toISOString() 輸出
  role: 'reader' | 'author' | 'admin';
  /**
   * 未讀通知數（FEAT-4 4-D，T117／T134）。**非可選**：`getSessionUser()` 對未登入者
   * 回 `null`，故拿得到這個物件就一定有這個數字；做成可選只會讓每個消費端多寫一次
   * `?? 0`，而那個 `?? 0` 與「真的沒有通知」在畫面上一模一樣。
   *
   * 與使用者查詢**同一次往返**取回（`usersRepo.findByIdWithUnread`），
   * MUST 即時反映、MUST NOT 快取（FR-053a）。
   */
  unreadCount: number;
}

/**
 * 個人設定表單的回填來源（FEAT-3 US3）。
 *
 * 與 `AuthUser` **刻意分開**：後者被序列化進每一個頁面的 flight payload
 * （root layout 的 SessionProvider），為了一個只有設定頁用得到的簡介欄位
 * 讓全站每一頁多帶 500 字並不划算。
 * MUST NOT 直接把 `User` 資料列交給用戶端 —— 那裡面有 `passwordHash`。
 */
export interface UserProfile {
  name: string;
  /** 空字串代表未設定（公開顯示名遞補為 `name`） */
  penName: string;
  bio: string;
  avatarColor: string;
}

export interface ReadingHistoryEntry {
  novelId: string;
  novelTitle: string;
  coverColor: string;
  chapterId: string;
  chapterTitle: string;
  readAt: string; // ISO datetime
}

/**
 * 續讀點（FEAT-4 FR-011）。
 * `chapterNumber` 一併回傳，續讀入口要顯示「讀到第 N 章」——
 * 少了它，作品詳情頁得為了一個數字再打一次資料庫。
 */
export interface ProgressPoint {
  chapterId: string;
  chapterNumber: number;
  percent: number;
}

/** 閱讀偏好的同步範圍**只有**這兩項（FR-014） */
export interface ReaderPreference {
  fontSize: 'sm' | 'md' | 'lg';
  theme: 'light' | 'dark' | 'eyecare';
}

// ─────────────────────────────────────────────
// 管理者後台（FEAT-9 / 009-admin-dashboard）
// ─────────────────────────────────────────────

export interface PaginatedResult<T> {
  items: T[];
  nextCursor: string | null;
  totalCount?: number;
}

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  role: 'reader' | 'author' | 'admin';
  isSuspended: boolean;
  suspendedAt: string | null; // ISO datetime string
  penName: string | null;
  createdAt: string; // ISO datetime string
  updatedAt: string; // ISO datetime string
  novelCount?: number;
  commentCount?: number;
}

/**
 * 使用者管理詳情頁（`/admin/users/[userId]`）的檢視模型。
 *
 * 與 `AdminUserRow` 的差別只在 `reviewCount` 與必填的兩個計數 —— 列表的計數為選填
 * （分頁查詢可省略），詳情頁一定查得到，型別上就該是必填而不是到處 `?? 0`。
 */
export interface AdminUserDetail {
  id: string;
  name: string;
  email: string;
  role: 'reader' | 'author' | 'admin';
  isSuspended: boolean;
  suspendedAt: string | null; // ISO datetime string
  penName: string | null;
  createdAt: string; // ISO datetime string
  updatedAt: string; // ISO datetime string
  novelCount: number;
  commentCount: number;
  reviewCount: number;
}

export interface AdminNovelRow {
  id: string;
  title: string;
  authorId: string;
  authorName: string;
  category: string;
  categoryId: string;
  status: NovelStatus;
  serialStatus: 'ongoing' | 'completed' | 'hiatus';
  chapterCount: number;
  wordCount: number;
  totalViews: number;
  favoriteCount: number;
  commentCount: number;
  updatedAt: string;
  publishedAt: string;
}

export interface AdminChapterRow {
  id: string;
  novelId: string;
  novelTitle?: string;
  number: number;
  title: string;
  wordCount: number;
  status: ChapterStatus;
  publishedAt: string | null;
  scheduledAt: string | null;
  updatedAt?: string;
  commentCount?: number;
}

export interface AdminTagRow {
  id: string;
  name: string;
  slug: string;
  novelCount: number;
}

export interface AuditLogRow {
  id: string;
  actorId: string;
  actorName?: string;
  actorEmail?: string;
  action: string;
  targetType: string;
  targetId: string;
  diff: string; // JSON string
  reason: string;
  ip: string;
  createdAt: string; // ISO datetime string
}

export interface SiteOverviewStats {
  totalUsers: number;
  userCountByRole: { reader: number; author: number; admin: number };
  suspendedUserCount: number;
  totalNovels: number;
  novelCountByStatus: { published: number; draft: number; admin_suspended: number };
  totalChapters: number;
  chapterCountByStatus: { published: number; draft: number; admin_suspended: number };
  totalWords: number;
  totalViews: number;
}

export interface DailyTrendStat {
  date: string; // YYYY-MM-DD
  views: number;
  registrations: number;
  comments: number;
}

export interface CategoryDistributionStat {
  categoryId: string;
  categoryLabel: string;
  novelCount: number;
  percentage: number;
}

export interface AdminDailyTrendPoint {
  date: string;
  views: number;
  newUsers: number;
}

export interface AdminCategoryDistribution {
  id: string;
  name: string;
  totalNovels: number;
  ongoingNovels: number;
  completedNovels: number;
}
