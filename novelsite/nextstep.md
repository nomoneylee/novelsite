# 📋 NovelSite 全面安全與架構審核報告（Next Steps）

> **審核日期**：2026-07-22
> **審核範圍**：`novelsite/`（Next.js 16 + Prisma 7 + SQLite）
> **前置作業說明**：依指示，**本輪不刪除 SQLite 假資料**，僅執行審核。
> **文件用途**：作為「上線前後端安全機制落地」的工作清單與修復依據。

---

## 🧭 審核前的關鍵發現（決定全報告的基調）

在下結論前，必須先說明實測後確認的一個 **架構事實**，它改變了風險的解讀方式：

> **這個專案目前是一個「唯讀展示型網站（Read-only Showcase）」，不是一個運作中的多用戶平台。**

具體證據：

- **沒有任何後端寫入路徑**：全專案 `grep` **無 `route.ts`（API Routes）、無 `"use server"`（Server Actions）**。所有頁面都是 Server Component 讀取 → `repositories/*` → Prisma → 顯示。
- **身分驗證 100% 在前端**：`src/hooks/useAuth.ts` 用 `localStorage` 存登入態，帳密比對寫死在 client bundle 的 `src/lib/content.ts:80-83`。
- **所有「寫入」操作都是假的**：
  - 新增作品 `src/components/author/CreateNovelForm.tsx:49`
  - 發佈章節 `src/components/author/ChapterEditor.tsx:57-60`
  - 改個資 `src/components/profile/AccountSettingsView.tsx:19`
  - 全都只 `showToast` 或 `setState`，**不觸及資料庫**。

**這代表什麼？** 目前 **沒有真正可被外部攻擊者利用的資料外洩或提權漏洞**——因為根本沒有可寫入、可查詢私密資料的伺服器端點。但 **這也正是最大的風險**：一旦依照 `plan.md` 的規劃「接上真實後端」，以下每一項若不先修正，都會 **立刻** 變成真實漏洞。

因此本報告的定位是：**上線前的架構級防護清單（Pre-Production Hardening）**，而非「當前正在被攻擊」的緊急事件。

### 資料庫現況（實測 `dev.db`）

| 資料表 | 筆數 |
|--------|------|
| Novel | 13 |
| Volume | 3 |
| Chapter | 60 |
| Review | 14 |
| Category | 6 |
| RankingEntry | 30 |
| User | 1（`reader@novelsite.tw`，**明碼密碼 `novelsite123`**） |
| AuthorNovel | 4 |
| AuthorChapterDraft | 2 |

> ⚠️ 全站頁面皆「唯讀」讀取這些 seed 資料顯示。若清空資料表，整個網站會變成空白（首頁、排行榜、閱讀頁全無內容）。**故本輪未刪除假資料**——需在接上真實內容來源後再決定清理策略。

---

## 1. 🔴 致命 / 高風險（Critical / High）

### 🔴 H-1　身分驗證完全在前端，無伺服器端信任邊界

> ✅ **已解決（2026-07-24，FEAT-1 `001-trust-boundary-dual-track`）**：自建 session（`jose` 簽發 JWT + HTTP-only Cookie + `Session` 資料表，可查詢／撤銷）。三道防線：`src/proxy.ts` 逐請求驗簽 + `role` 快照判斷 → `author`/`profile` layout 以 `requireAuthor()`/`requireUser()` 覆核資料庫 `User.role` → 各受保護頁面 `page.tsx` 亦各自呼叫守衛（見 arch.md 附錄 B #10 的巢狀 layout 串流限制）。`ProfileGate` 已刪除，`useAuth` 改讀伺服器提供的 `SessionProvider`。詳見 `specs/001-trust-boundary-dual-track/`。

- **位置**：`src/hooks/useAuth.ts`、`src/components/profile/ProfileGate.tsx`、`src/app/author/layout.tsx`
- **問題**：
  - 登入狀態只存 `localStorage['novelsite-auth'] = { userId: 'user-1' }`。任何人打開 DevTools 貼一行 `localStorage.setItem('novelsite-auth', JSON.stringify({userId:'user-1'}))` 即「登入」。
  - 作者後台 `/author/*` **完全沒有任何守衛**——`src/app/author/layout.tsx` 直接渲染，連 `ProfileGate` 都沒套。任何人可直接訪問作者儀表板、章節編輯器。
  - `/profile/*` 的 `ProfileGate` 是 **client-side redirect**，內容其實已在 SSR 階段送到瀏覽器，靠 `useEffect` 才跳轉——**保護是視覺性的，不是真正的存取控制**。
- **上線後衝擊**：提權（任何訪客變作者）、私密頁面內容於 SSR 洩漏。
- **修復方向**：改用 NextAuth.js（plan 已規劃），以 **HTTP-only、Secure、SameSite Cookie + 伺服器端 session 驗證** 取代 localStorage；作者/個人頁改用 **Server Component 讀 session** 或 `middleware.ts` 攔截，未授權在 **伺服器端** 就 `redirect()`。

### 🔴 H-2　密碼明碼儲存與明碼傳輸

> ✅ **已解決（2026-07-24，FEAT-1）**：`User.passwordHash` 改存 argon2id 雜湊（`@node-rs/argon2`，成本參數見 README／arch.md §7.2），永不存明碼；登入頁示範帳密提示已移除；seed 改由 `SEED_USER_PASSWORD` 環境變數提供或隨機產生。

- **位置**：`prisma/schema.prisma:187`（`password String`）、`prisma/seed.ts:183`、DB 實測 `password: "novelsite123"`
- **問題**：User 表密碼欄位為明碼；示範帳密還 **直接印在登入頁 UI**（`src/components/auth/LoginForm.tsx:48-50`）。目前雖只是 mock，但這個 schema 一旦接真實註冊，就是明碼落庫。
- **修復方向**：密碼欄位存 **bcrypt/argon2 雜湊**（絕不存明碼、絕不可逆），註冊時 hash、登入時 `compare`。上線前務必從登入 UI 移除示範帳密提示。

### 🔴 H-3　付費章節「防護」純屬視覺裝飾（Paywall Bypass）

> ✅ **已解除（2026-07-29，FEAT-2 2-B）**：平台定案全免費，付費機制不再存在，本項的三處殘留已全數清除 ——
> (1) `Chapter.isFree` 自 schema、`src/lib/types.ts` 與 mapper 移除；(2) `ReaderView`／`ChapterList` 的 `Lock`
> icon 與鎖頭區塊移除；(3) `/author/earn` 的收益金額語意改為非金額「作品成效」（側欄／頁尾導覽標籤與
> `/about` 措辭同步）。章節可見性改為只取決於 `Chapter.status`（`published` 對所有人可讀、草稿對非擁有者回 404），
> **無任何付費／授權分支**。稽核：`grep -rn --exclude-dir=migrations "isFree" src prisma` = 0；
> `/author/earn` 與 `/about` 無 `NT$`／收益／分潤／打賞字樣。

- **位置**：`src/components/reader/ReaderView.tsx:200-202`、`src/lib/repositories/novels.ts:103`（`getChapterContext`）
- **問題**：`!chapter.isFree` 只顯示一個 🔒 圖示與「付費章節（示範內容）」字樣，但 **下方 `paragraphs` 正文照樣完整渲染**。`getChapterContext` 對付費章節不做任何攔截。
- **上線後衝擊**：若導入付費機制，**所有付費內容零成本繞過**，直接業務營收漏洞。
- **修復方向**：**在伺服器端**（repository / API）判斷 `isFree` 與使用者購買/訂閱狀態，**未授權時根本不把 `paragraphs` 送到 client**，改回傳付費牆佔位。前端過濾一律視為無效。

---

## 2. 🟡 中度風險與邏輯缺陷（Medium）

### 🟡 M-1　`register()` 不檢查 Email 是否重複、不真正建帳號

> ✅ **已解決（2026-07-24，FEAT-1）**：註冊改走伺服器端 `authService.register()`：Zod 驗證 → 正規化 Email 唯一性檢查 → 已存在回 `409 CONFLICT`（不外拋 Prisma unique 例外）。

`src/hooks/useAuth.ts:66-74`：註冊只做格式驗證就回傳 `MOCK_USER` 的複製體，`email` 唯一性（`schema @unique`，`prisma/schema.prisma:185`）完全沒被檢查。接真後端時務必在 **伺服器端** 做唯一性檢查並回傳友善錯誤（而非丟 Prisma unique constraint 例外）。

### 🟡 M-2　富文本編輯器 Markdown 未淨化（潛在儲存型 XSS）

> ✅ **已解決（2026-07-31，FEAT-3）**：新增 `src/components/ui/SafeMarkdown.tsx`
> （`react-markdown` + `remark-gfm` + **`rehype-sanitize`**，**無任何可放寬淨化的 prop**），
> 並成為編輯器預覽與讀者端正文的**唯一**渲染路徑。`eslint.config.mjs` 以
> `no-restricted-imports` 禁止 import `rehype-raw`（規則已實測會報錯，非只是寫著）。
> 寫入端另有控制字元過濾與長度上限（`chapterService.sanitizeBody`，單章 ≤100,000 字元）。
> `tests/integration/markdown-sanitize.test.ts` 涵蓋腳本節點、`onerror` 事件屬性與
> `javascript:` 協定連結三種形狀。
> **已知行為**：未啟用 `rehype-raw` 的情況下，正文中的原始 HTML 會被**整段丟棄**
> 而非逸出顯示（見 `features.md` FEAT-3「交付後的已知行為」第 1 項）。

`src/components/author/ChapterEditor.tsx:120` 用 `react-markdown` + `remark-gfm` 預覽作者輸入。目前 `react-markdown` 預設不渲染原始 HTML（安全），但 **一旦日後加入 `rehype-raw` 或允許 HTML**，作者輸入的內容將成為儲存型 XSS 溫床。接寫入 API 後，作者內容在讀者端顯示時務必確保 **不啟用 raw HTML**，或加 `rehype-sanitize`。

### 🟡 M-3　`db.ts` 的全域 Prisma 快取在正式環境會遺漏連線重用

> ✅ **已解決（2026-07-24，FEAT-1）**：singleton 改為**不分環境**一律掛 `globalThis`，移除 `NODE_ENV !== 'production'` 條件；已於 User Story 3 情境 5 實測連續瀏覽多頁後 `pg_stat_activity` 連線數不隨請求數增生。

`src/lib/db.ts:31-33`：`globalForPrisma.prisma` 只在 `NODE_ENV !== 'production'` 時掛回全域。在部分 serverless（如 Vercel）冷啟動下這是慣例，但若未來改長駐伺服器，正式環境每次 import 都可能新建 client。建議依實際部署形態（serverless vs. 長駐）明確化這段策略。

### 🟡 M-4　`searchNovels` 全表載入記憶體過濾

> ✅ **已解決（2026-07-31，FEAT-3）**：`searchNovels()` 已**刪除**，`src/` 內無殘留呼叫。
> 取代者為 `src/lib/repositories/search.ts` 的資料庫層篩選：預算欄位 `Novel.searchText`
> （寫入時由服務層組 `title + penName + 分類 + 標籤` 的正規化小寫串，上限 512 字元）+
> 兩軌統一的子字串比對（SQLite `LIKE ? ESCAPE '\'`／PostgreSQL `ILIKE ? ESCAPE '\'` +
> `pg_trgm` GIN），**不用 `tsvector`**（`simple` 設定不切中文詞，兩軌結果無從一致）。
> 排序鍵為 `updatedAt DESC, id ASC`，游標分頁每頁 20 筆，筆數上限與作品總數脫鉤。
> `tests/integration/search-empty-scan.test.ts` 以**查詢計數**量化「空查詢不對 Novel 表
> 發出任何查詢」。
> **2026-07-31 更新**：PostgreSQL 軌的 migration 與 `pg_trgm` 擴充已於 Docker 恢復可用後
> 實際套用並驗證，`DATABASE_PROVIDER=postgresql npm run test:integration` 37 檔 290 案例
> 全綠，與 SQLite 軌一致；不再有待外部條件。

`src/lib/repositories/novels.ts:83-96`：搜尋把 **整張 Novel 表拉進記憶體** 再 `filter`。程式碼註解已自承「資料量小可接受」，且 plan P1 也列了待辦。資料量成長後這是 O(n) 全表掃描 + 記憶體風險，上線前應改為 DB 層 `where` 或全文索引（plan 已規劃 PostgreSQL FTS）。

### 🟡 M-5　`layout.tsx` 的 `openGraph.url` 寫死網址，繞過 `siteConfig`

> ✅ **已解決（2026-07-24，FEAT-1）**：改用 `SITE_URL`（`src/lib/siteConfig.ts`），與 `metadataBase` 一致。

`src/app/layout.tsx:21` 硬編 `url: 'https://novelsite.tw'`，但同檔 `metadataBase` 已用 `SITE_URL`（可由 `NEXT_PUBLIC_SITE_URL` 覆寫）。兩者不一致——換域名時 OG url 會殘留舊值。應統一改用 `SITE_URL`。

---

## 3. 🔵 架構與維護性優化建議（Enhancements）

- **E-1　作者專用表與公開 `Novel` 完全脫鉤且無 `userId`**：原作者作品表 **沒有作者外鍵（owner）**。真實多作者情境下，這使「越權編輯他人作品」在資料模型層無從防範。建議加 `authorId` 關聯到 `User`，並在所有寫入 query 加 `where: { authorId: session.userId }`。
  > ✅ **已解決（2026-07-29，FEAT-2 2-A + 2-C）**：`Novel.authorId` FK → `User` 已建立；兩張重複的作者專用表已刪除，作者向資料改讀 `Novel`（`authorId` + `status`）與 `Chapter`＋`ChapterContent`（`status='draft'`）。`repositories/authors.ts` 的**每個函式 `authorId` 一律必填**，省略即 `tsc --noEmit` 失敗（`tests/integration/author-ownership.test-d.ts` 以 `@ts-expect-error` 持續稽核）。寫入路徑的 session→作者綁定屬 FEAT-3。
  > ✅ **寫入路徑完成（2026-07-31，FEAT-3）**：`assertNovelOwner`／`requireOwner` 落地，
  > **非擁有者與資源不存在回完全相同的「找不到」**（MUST NOT 回 403）；資料層另以
  > `updateMany`／`deleteMany` + `where: { id, authorId }` 作為型別層之外的第二道
  > —— 守衛可以被忘記，SQL 的 where 不會。十三個作者 Action 逐一自驗身分與角色
  > （`tests/integration/author-role-guard.test.ts` 同時做執行期與靜態稽核），
  > 十二種受擁有者守衛的越權寫入由 `author-write-ownership.test.ts` 全數覆蓋。
  > 作者後台的資料歸屬亦已改為登入的工作階段（`DEMO_AUTHOR_ID` 已刪除）。
- **E-2　SQLite 日期/陣列的 workaround 已技術債化**：`publishedAt` 存 ISO **字串**、`tags`/`relatedIds` 存逗號分隔字串。切 PostgreSQL 時應趁勢改為原生 `DateTime` 與 `String[]`，`mappers.ts` 的 CSV 序列化即可移除。
  > ✅ **已解決（2026-07-29，FEAT-2 2-A + 2-C）**：`Chapter.publishedAt`／`Novel.publishedAt`（原 `releasedAt`）／`Review.publishedAt` 全改原生 `DateTime`；`tags` → `Tag` + `NovelTag`、`relatedIds` → `NovelRelation`（**不採 PostgreSQL 專屬 `String[]`**，維持雙軌相容）；`splitCsv`／`joinCsv` 已刪除。mapper 對外仍還原 `YYYY-MM-DD`，UI 顯示與排序不變。
- **E-3　`repositories` 抽象層設計良好，值得保留**：DB 存取集中在 `db.ts` + `repositories/*`、上層透過 barrel import，這個「可抽換邊界」設計是本專案的亮點，切換 PostgreSQL 的衝擊面確實被良好隔離。**建議未來所有寫入 API 也一律走這層**，別讓 page/action 直接碰 `prisma`。
- **E-4　`inline theme script` 使用 `dangerouslySetInnerHTML`**：`src/app/layout.tsx:47-64` 本身內容是靜態安全字串，但若日後導入 CSP，需為此 inline script 配置 `nonce`，否則會被 CSP 擋下。
  > ✅ **已解決（2026-07-24，FEAT-1）**：`proxy.ts` 逐請求產生 nonce，root layout 以 `(await headers()).get('x-nonce')` 取得後套用於此 script；CSP 已強制上線（見 E-5）。
- **E-5　缺乏 CSP / 安全性 HTTP 標頭**：`next.config.ts` 未見 `headers()` 設定。上線前建議補 `Content-Security-Policy`、`X-Frame-Options`、`Strict-Transport-Security`、`X-Content-Type-Options`。
  > ✅ **已解決（2026-07-24，FEAT-1）**：CSP（nonce + `'strict-dynamic'`，強制模式）由 `src/proxy.ts` 設定；HSTS／X-Frame-Options／X-Content-Type-Options／Referrer-Policy／Permissions-Policy 五項由 `next.config.ts` 的 `headers()` 套用於所有回應。詳見 arch.md §7.5。

---

## 4. 🛠️ 具體修復方案（Actionable Fixes）

針對三項高風險，提供實作思維虛擬碼：

### H-1 + H-2：伺服器端 Session + 密碼雜湊

```
// middleware.ts — 在伺服器端攔截私密路由（取代 client 的 ProfileGate）
export async function middleware(req) {
  const session = await getSession(req)          // 讀 HTTP-only cookie
  const path = req.nextUrl.pathname
  if (path.startsWith('/author') || path.startsWith('/profile')) {
    if (!session) return NextResponse.redirect('/auth/login')
    if (path.startsWith('/author') && !session.user.isAuthor)
      return NextResponse.redirect('/')          // 非作者禁入後台
  }
}

// 註冊（Server Action / API）— 密碼雜湊 + Email 唯一性
async function registerUser(name, email, rawPassword) {
  if (await repo.findUserByEmail(email)) throw new Error('此 Email 已被註冊')
  const hash = await argon2.hash(rawPassword)     // 絕不存明碼
  return repo.createUser({ name, email, password: hash })
}
```

### H-3：付費章節在伺服器端攔截，未授權不送正文

```
// repositories/novels.ts — getChapterContext 內
async function getChapterContext(novelId, chapterId, session) {
  const chapter = await loadChapter(...)
  const locked = !chapter.isFree &&
                 !(await hasPurchased(session?.userId, novelId, chapterId))
  return {
    ...meta,
    // 關鍵：未授權時「根本不生成/不回傳」正文，改回傳付費牆旗標
    paragraphs: locked ? null : generateChapterParagraphs(chapter),
    isLocked: locked,
  }
}
// ReaderView：if (context.isLocked) 只渲染購買 CTA，無正文可繞過
```

---

## ✅ 總結

| 面向 | 現況 |
|------|------|
| **當前實際可被攻擊性** | **低**——因無後端寫入/查詢端點，攻擊面尚未開啟 |
| **上線就緒度（Production-Readiness）** | **未就緒**——認證、授權、密碼、付費牆全是前端 mock |
| **架構設計品質** | **良好**——repository 抽換邊界、型別分層清晰，是加分項 |

**核心結論**：這是一份 **體驗完整度極高、但後端安全機制尚未落地** 的作品。目前如同「精緻的展示原型」。上述 **H-1 ～ H-3 三項必須在接上真實後端的「同一個 PR」內一併完成**——它們不是「之後再補」的優化，而是「開了後端門就必須同時裝好的鎖」。

---

## 📌 建議的下一步執行順序（Recommended Order）

1. **H-1 / H-2**：導入 NextAuth.js + `middleware.ts` 伺服器端授權骨架、密碼改雜湊、User 加 `authorId`（含 E-1）。
2. **H-3**：付費牆改為伺服器端攔截（未授權不送正文）。
3. **M-1**：註冊改走伺服器端（Email 唯一性 + hash）。
4. **E-5 / E-4**：補安全性 HTTP 標頭與 CSP（含 inline script nonce）。
5. **M-4 / E-2**：切換 PostgreSQL 時一併處理全文搜尋與原生型別。
6. **M-5**：修正 `openGraph.url` 統一用 `SITE_URL`（低成本，可先做）。

---

## 🏁 FEAT-4 收尾紀錄（2026-08-08）

**先更正一處文件指向**：`specs/004-reader-interaction-stats/tasks.md` 的 T162 要求「於本檔勾銷
N-3～N-8」，但 **N-* 這一組編號自始不在本檔**——本檔追蹤的是 H-1～H-3、M-1～M-5、E-1～E-5。
N-* 是 `arch.md` §8「本次新增項目（`nextstep.md` 未涵蓋，但『完整小說網站』必需）」那張表的編號，
該表的標題本身就寫明它涵蓋的是本檔沒寫到的項目。**勾銷已落在 `arch.md` §8 的各該列**
（那才是「會被照著實作的那一處」）；在此只記錄結果與指向，不在本檔另立一份會漂移的副本。

| 編號 | 內容 | 落點 |
| --- | --- | --- |
| **N-3** | 書架／歷史／偏好上雲 + 本機資料合併 | FEAT-4 4-A（2026-08-07） |
| **N-4** | `Review.userId` + 評論／留言／按讚寫入路徑 | FEAT-4 4-B（2026-08-08） |
| **N-5** | 排行榜改由 `NovelDailyStat` 計分重算 | FEAT-4 4-D（2026-08-08） |
| **N-6** | 作者儀表板改讀真實統計，`getAuthorDailyStats()` 刪除 | FEAT-4 4-C（2026-08-08） |
| **N-7** | 測試框架：Vitest + Playwright 四條 E2E 主流程 | FEAT-1 起步 → FEAT-4 4-D 完成（2026-08-08） |
| **N-8** | `/author/earn` 改為作品成效總覽 | FEAT-4 4-C（2026-08-08） |

**與本檔直接相關的一項現況更新**：檔首「審核前的關鍵發現」把本專案描述為
「唯讀展示型網站（Read-only Showcase）：沒有任何後端寫入路徑、身分驗證 100% 在前端、
所有寫入操作都是假的」。**這段敘述在 FEAT-1～FEAT-4 之後已全部不成立**，保留它的唯一理由是
它記錄了 2026-07-22 當下的事實與後續全部工作的起點。現況是：伺服器端工作階段與三道授權防線
（FEAT-1）、真實的作者寫入路徑與擁有者守衛（FEAT-3）、讀者互動與統計管線（FEAT-4）皆已落地，
`src/lib/content.ts`（當年寫死帳密的那一支）已於 FEAT-4 4-C 整檔刪除。
**閱讀本檔時 MUST 以各項底下的 ✅ 解決註記為準，而非檔首的基調段落。**

---

## 📮 FEAT-5（Phase 14）與本檔的關係（2026-08-09）

**本檔不新增任何 FEAT-5 的勾選項，這是刻意的。** 憲章「開發流程與品質閘門」要求完成項目
MUST 於本檔與 `novelsite/plan.md` 更新勾選狀態與執行紀錄，故此處明寫判斷結果，
避免下一輪審查把「本檔沒有 FEAT-5」再當成一次遺漏：

本檔追蹤的是 **H-1～H-3／M-1～M-5／E-1～E-5** 三組編號（2026-07-22 安全與架構審核的產物），
**其中沒有任何一項對應郵件基礎設施、密碼救援或聯絡管道** —— 該審核當時站上連寫入路徑都沒有，
「忘記密碼無救援」不是那份清單的觀察對象。FEAT-5 的里程碑因此落在
**`novelsite/plan.md` 的 Phase 14 一節**（該檔為里程碑的事實來源），
逐項完成定義與執行紀錄落在 `arch.md` §9 Phase 14 與 `features.md` FEAT-5。

**與本檔既有內容唯一相關的一點**：檔首「審核前的關鍵發現」已於 FEAT-4 收尾時註記為過時，
FEAT-5 交付後另有一項變化 —— **註冊 Email 至今未經驗證**，而重設信的出現使
「把 Email 填成他人真實位址」從一個無法利用的條件變成**可被該位址擁有者接管帳號**的路徑。
這是刻意接受的結果（帳號本就該由信箱擁有者控制），已列入 `README.md` 已知限制，
**MUST NOT 以「既有問題」帶過**。

尚未關閉的項目、待外部條件與已知基線，見 `novelsite/README.md`。

---

## 🚢 FEAT-6（Phase 15）與本檔的關係（2026-08-15）

**本檔同樣不新增 FEAT-6 的勾選項，理由與上一節相同**：本檔追蹤的是
**H-1～H-3／M-1～M-5／E-1～E-5** 三組編號，而 FEAT-6 的內容（正式環境資料防呆、
子路徑相容、容器化、自動部署、人工清單）**沒有任何一項對應那三組編號**。
里程碑落在 **`novelsite/plan.md` 的 Phase 15 一節**，逐項完成定義與執行紀錄落在
`arch.md` §9 Phase 15 與 `features.md` FEAT-6。

**與本檔既有內容相關的三點**（皆為狀態變化，不是新項目）：

1. **M-3（`db.ts` 全域 Prisma 快取）與 §7.6「限流為單機記憶體實作」的前提被寫進設定檔**：
   `deploy/compose.yml` 的 `novelsite` 服務 `deploy.replicas` **MUST 維持 1** 並就地註明理由
   （FR-081）。調高之後限流額度會變成「每個實例各一份」，**症狀是限流看起來還在**。
2. **H-2 之後的密鑰輪替成為一項有紀錄的人工項目**：
   `RESEND_API_KEY` 現在有**兩份**（站台 `.env` 與 GitHub repo secret，不同信任邊界），
   輪替時 MUST 同時更新兩處——已列入 `deploy/deployment.md` §6.2 的 B4。
3. **檔首「審核前的關鍵發現」的過時註記再加一層**：本專案自本階段起有容器化部署與
   自動部署流程，「唯讀展示型網站」的描述與現況距離更遠。**保留原文不改**是為了
   讓下一個人看得到判斷是怎麼變的，但 MUST NOT 以它為現況依據。

FEAT-6 的**六項待外部條件**（SC-020／021／022／023＋028／027／024）
MUST 維持未勾銷，清單見 `README.md`「待外部條件（FEAT-6）」。
