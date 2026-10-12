# 🧩 NovelSite 開發 Feature 拆解

> **版本**：v1.0
> **日期**：2026-07-23
> **依據**：`arch.md` v1.0（架構真相來源）
> **用途**：把 `arch.md` 的 Phase 9–15 拆成 **6 個可依序開發、可獨立驗收的 Feature**，避免一次性巨型重構。
> （原文寫「Phase 9–13／4 個 Feature」，隨 Phase 14／FEAT-5（2026-08-09）與
> Phase 15／FEAT-6（2026-08-13）的新增就地更新 —— 舊數字會讓人以為表格少了兩列。）

---

## 總覽

| Feature | 名稱 | 涵蓋 arch.md 項目 | 相依 | 產出的產品能力 |
|---------|------|-------------------|------|----------------|
| **FEAT-1** | 信任邊界與雙軌基礎建設 | H-1, H-2, M-1, M-3, M-5, E-4, E-5, N-7(起步) | — | 真實可註冊登入，後台真的擋得住 |
| **FEAT-2** | 資料模型重構與真實內容 | H-3, E-1, E-2, N-1, N-2 | FEAT-1 | 全站顯示 DB 內的真實小說正文 |
| **FEAT-3** | 創作流與搜尋 | M-2, M-4, E-1(`requireOwner` 落地), N-7(E2E 導入) | FEAT-2 | 作者真的能寫、讀者搜得到 ← **產品上線點** |
| **FEAT-4** | 讀者互動與數據 | N-3, N-4, N-5, N-6, N-8 | FEAT-3 | 完整社群互動 + 真實排行與統計 |
| **FEAT-5** | 郵件基礎設施、密碼救援與聯絡管道 | GitHub issue #5、#6（arch.md §7.2 無密碼救援途徑、§8 聯絡我們表單、**新增的 Phase 14**） | FEAT-1 | 忘記密碼可自救、聯絡管道真的通得了 |
| **FEAT-6** | 正式上線就緒：資料防呆、子路徑相容、容器化與自動部署 | GitHub issue #7、#8、#9（arch.md §5.7 排程載體、§10.1 第五套測試、**新增的 Phase 15**） | FEAT-5 | 站台真的能上線，且上線之後改得動、回得去、救得回 |
| **FEAT-7** | 作者批次上傳章節 | GitHub issue #14（arch.md §7 作者寫入流只有逐章路徑、**新增的 Phase 16**） | FEAT-3 | 作者能一次匯入整卷章節，不必逐章複製貼上 |
| **FEAT-8** | 作者批次發佈與批次刪除章節 | arch.md §5.5 章節狀態與刪除只有**逐章** Action、**新增的 Phase 17** | FEAT-7 | 作者能一次發佈整卷草稿（收藏者只收到一則通知），也能一次清掉匯錯的整批章節 |
| **FEAT-9** | 管理者後台：以 admin 帳號管理使用者、書籍與文章、標籤與站台統計 | GitHub issue #15、**新增的 Phase 18** | FEAT-4, FEAT-5 | 提供 /admin 後台，管理全站使用者、違規內容、標籤治理與營運統計，操作留痕 |

> **FEAT-9 為 2026-09-03 新增**（`/speckit-specify` 裁示，規格見 `specs/009-admin-dashboard/`，對應 GitHub Issue #15）。
> **全站現行對 `admin` 角色僅當成 `author` 的同義詞**，且全站無任何 `/admin` 路由與專屬後台；目前唯一的 admin 是 seed 示範帳號（上線前必須清除）。
> 本階段建立獨立管理者守衛與 `/admin` 邊界防禦，提供四大管理核心：使用者治理（搜尋、停權、變更角色、密碼重設）、違規書籍與內容管理（下架與刪除）、標籤治理（新增、更名、合併、刪除）與營運數據儀表板，並具備關鍵管理動作稽核紀錄（Audit Log）。
> 落點為 `arch.md` §9 新增的 **Phase 18**。

> **FEAT-8 為 2026-08-22 新增**（`/speckit-specify` 裁示，規格見 `specs/008-batch-publish-delete/`）。
> **原文的 FEAT-7 條目讓批次流程只走完一半**：FEAT-7 把匯入從數百次操作降到 3 次，
> 但其 FR-013 明訂「匯入產出一律為草稿」，而 `arch.md` §5.5 的
> `publishChapterAction`／`deleteChapterAction` 都是**一次一章**——
> 作者匯完 200 章後，仍要逐章進編輯器按發佈；匯錯了要退回，也只能點 400 次「刪除 → 確認刪除」。
> FEAT-7 省下的操作，在下一步原封不動加了回來。
> **相依到 FEAT-7**（並非只到 FEAT-3）：本階段的價值全部由「匯入產出是一批草稿」這個前提定義，
> 沒有批次上傳，批次發佈只是一個少有人會用的便利功能。
> 落點為 `arch.md` §9 新增的 **Phase 17** —— Phase 16 的項目清單已於 2026-08-22 全數執行完畢
> 並結案（GitHub issue #14 已關閉），把新項目補進一個已收尾的階段會讓該階段的執行紀錄失真
> （與 FEAT-5、FEAT-6、FEAT-7 新增時同一種問題）。

> **FEAT-7 為 2026-08-19 新增**。原文六列中沒有任何一列涵蓋「作者怎麼把已經寫好的稿子搬進站裡」——
> FEAT-3 交付的作者寫入流**只有逐章路徑**（建立章節 → 進編輯器 → 貼上正文 → 儲存），
> 一部長篇要重複數百次。**相依只到 FEAT-3**（它建立了 `Volume`／`Chapter` 的寫入路徑與授權守衛），
> 不依賴 FEAT-4～6，可與其並行；落點為 `arch.md` §9 新增的 **Phase 16**
> ——Phase 11～15 的項目清單自始不含批次匯入，且 Phase 15 已為上線收尾，
> 照字面掛上去等於掛在一個為別件事收尾的階段後面（與 FEAT-5、FEAT-6 新增時同一種問題）。

> **FEAT-6 為 2026-08-13 新增**。原文的五列全部是「站台要有什麼功能」，
> 沒有任何一列涵蓋「站台怎麼跑起來」—— 而至今它只在一個地方跑過：開發者的本機、掛在網域根目錄。
> 其落點原應屬 **Phase 13「強化與上線」**，但該 Phase 的項目清單**自始不含容器化、CI/CD
> 與路徑前綴相容**，且已於 2026-08-08 執行完畢；照字面等於掛在一個走完的階段後面
> —— 與 FEAT-5 當初遇到的同一種問題，故 `arch.md` §9 另立 **Phase 15** 承接。
> **相依標為 FEAT-5** 是因為它是最後一個改動應用程式碼的階段（本階段要打包的就是它的產物），
> **並非功能相依**：FEAT-6 不使用郵件以外的任何 FEAT-5 能力
> （部署失敗通知刻意**不經站台**寄送，見 FR-090a）。

> **FEAT-5 為 2026-08-09 新增**。原文的四列涵蓋範圍不含 issue #5／#6，而這兩者的解除條件是**同一句話**
> （郵件基礎設施就位），分開做等於把寄送能力、寄件網域設定與濫用防護各做一次。
> 其落點原寫在 **Phase 13**，但 Phase 13 的項目清單自始沒有郵件相關項目且已於 2026-08-08 執行完畢 ——
> 照字面等於指向一個不存在的工作項，故 `arch.md` §9 另立 **Phase 14** 承接（該處已載明理由）。
> **相依只到 FEAT-1**（認證核心、限流、session 撤銷），不依賴 FEAT-2～4，故可與其他工作並行。

> **FEAT-3 涵蓋項目的修訂（2026-07-30）**：原列 `N-8(部分)` —— 該項的付費語意移除已於 FEAT-2 隨 H-3 完成，
> 完整成效指標屬 FEAT-4，FEAT-3 無對應工作，故移除。改列 `E-1`（資料層 FK 屬 FEAT-2，
> 服務層 `requireOwner` 於本階段落地）與 `N-7`（E2E 框架導入）。

**貫穿全程**：E-3（repository 抽象層維持並強化）、N-7（測試持續累積）、§2.2 分層鐵律 R1–R5。

**共通完成準則**（每個 Feature 皆須滿足，出自 `arch.md` §10.6）：

- [ ] 該 Feature 的所有測試案例通過
- [ ] `npm run build`、`npm run lint`、`npx tsc --noEmit` 全綠
- [ ] `DATABASE_PROVIDER=sqlite` 與 `=postgresql` 皆可執行（FEAT-1 之後）
- [ ] 合併後網站仍可完整瀏覽（不得留下半殘狀態）

---

## FEAT-1　信任邊界與雙軌基礎建設

> **一句話**：把「登入」從瀏覽器的謊言變成伺服器的事實，並讓資料庫從此雙軌。
> **對應 arch.md**：§2（分層）、§3（雙軌）、§7.1（H-1）、§7.2（H-2）、§7.5（E-4/E-5）、§7.6、§9 Phase 9
> **前置**：`npm install` 後先讀 `node_modules/next/dist/docs/`（`AGENTS.md` 強制要求）—— **已於 2026-07-23 完成**，`arch.md` 附錄 B 9 項全部核對完畢，結論見 `specs/001-trust-boundary-dual-track/research.md`
> **規格與任務**：`specs/001-trust-boundary-dual-track/`（spec / plan / research / data-model / contracts / tasks，共 **105 個任務**）
> **一致性修正（2026-07-23，第二輪 `/speckit-analyze`）**：已修正 16 項跨文件落差，其中影響本節內容者為 —— Cookie `maxAge` 改取絕對上限、CSP 政策字串抽為純函式、攔截層排除整個 `/api/*`、p95 量測須避開限流、`localStorage` 竄改改列人工驗收、安全事件記錄補單元測試、新增 FR-056（停用 Cookie 的提示）。憲章同步 PATCH 至 **v1.0.2**（H-3 標為不適用、分支命名承認 `NNN-slug`）
> **一致性修正（2026-07-23，第三輪 `/speckit-analyze`）**：再修 10 項，任務數 94 → 100。影響本節內容者為 —— (a) 整合測試流程補上**測試資料庫的結構套用與示範資料載入**（缺此步驟時就緒探針永遠等不到 200，整條測試路徑無從啟動）；(b) 補上**逐表清空與角色 fixture 的輔助程式**（原清單只列了 a11y 輔助檔，整合測試側被預設為「已存在」）；(c) 清空範圍界定為**只清認證域**，內容資料表保留，測試帳號一律由 fixture 建立；(d) vitest 拆為**三個設定檔**（單元用 node、a11y 另立），否則 `npm run test` 會連帶跑需要伺服器的 a11y 測試而必然失敗；(e) 誠實標示補上 **`ContactForm` 與 `/author/earn`** 兩處漏項，並改以**全站掃描**收尾
> **一致性修正（2026-07-23，第四輪 `/speckit-analyze`）**：再修 5 項，任務數維持 100（皆為既有任務的內容補強）。影響本節內容者為 —— (a) **a11y 頁面層打不到它宣稱要驗的頁面**：目標清單 9 頁中有 6 頁在 `/author/*`／`/profile/*`，未帶憑證的 `fetch` 取回的是登入頁，`axe.run()` 會對同一份登入頁驗 6 次而全綠 —— 現要求帶登入 Cookie 並斷言 200，且 DoD 增列「移除 Cookie 後該測試必須失敗」的反向驗證；(b) 測試輔助程式自 `tests/integration/helpers/` 上移至 **`tests/helpers/`**，供整合與 a11y 共用；(c) globalSetup 改為**動態空閒埠** + `provide()` 傳 baseURL，避免兩套件同時執行時互撞；(d) 釐清 **`SessionProvider` 掛 root layout 與「公開頁零成本」不衝突**（零成本的對象是攔截層，且未登入者本來就零查詢）；(e) 整合測試案例 1 的「既有 Email」明訂以 fixture 建立
> **一致性修正（2026-07-23，第四輪 `/speckit-analyze` 覆核）**：再修 11 項，任務數 100 → **102**（新增 T006a 測試環境設定檔、T070a 示範帳號隨機密碼驗證）。影響本節內容者為 —— **(a) 測試環境變數沒有任何任務負責建立與注入**（`contracts/env.md` §5 早有規範卻無人落實）：`TRUSTED_PROXY_HOPS` 預設 `0` 會使 `X-Forwarded-For` 被完全忽略、位址鍵隔離全面失效，而 `DATABASE_URL` 沿用開發者殼層會讓逐表清空**直接刪掉 `dev.db` 的認證域** —— 現以版控的 `.env.test` + globalSetup 注入四個子行程解決；**(b) a11y 與逐頁檢查的清單漏頁**：a11y 由 9 頁補為 **12 頁**（漏掉 `/author/create`、`/author/editor/{chapterId}`、`/reader/{novelId}/{chapterId}`，而前兩者正是「停用原因可讀出」的主要落地處），「既有 26 頁可正常開啟」則補上「受保護的 9 頁須帶 Cookie 並斷言 200」；**(c) 動態埠只解決埠衝突**，兩個測試套件仍共用測試資料庫與 `.next` 目錄，故明訂**不得並行**；(d) `T076`（`openGraph.url`）與 `T061`（`SessionProvider`）同改 `layout.tsx`，移除其 `[P]` 標記；(e) 新增樣式（停用態、示範資料標示）明訂**一律走既有設計 token**，不得硬編色碼；(f) 補上 `LoginForm` 的 `useId`、示範帳號隨機密碼退路的驗證任務、人工驗收由三項更正為**四項**（補 `Set-Cookie` 的 `Max-Age` 覆核）；(g) 釐清 `arch.md` §10.3 與 FR-032 **兩套案例編號**的對照表；(h) 於 plan 記錄「測試輔助程式的直接資料庫存取不違反憲章第 III 條」
> **一致性修正（2026-07-23，第五輪 `/speckit-analyze`）**：再修 8 項，任務數 102 → **103**（新增 T006b 測試環境組態函式）。影響本節內容者為 —— **(a) 測試套件根本跑不起來的解析問題**：`src/lib/repositories/*` 帶 `import 'server-only'`，該套件只有在 `react-server` 解析條件下才是空實作，而 **Vitest 的 node 與 jsdom 環境都不套用該條件、兩者同樣會擲錯** —— 先前寫的「單元用 node 環境即可迴避」並不成立。正解是單元與整合設定檔補上 `resolve.conditions`，a11y **不得**補（`react` 也宣告該條件，補了會解析到不含用戶端 Hook 的伺服器版本，React Testing Library 無法渲染）；**(b) 連帶：a11y 套件不得 import 任何 `src/**` 伺服器端模組** —— 受保護頁面的憑證改以 `SEED_USER_PASSWORD` 經 HTTP 登入示範帳號取得（該套件因此不得清空認證域），`RegisterForm` 的互動測試改以 `vi.mock` 隔離 Server Action；**(c) 測試環境變數只注入了子行程、漏掉測試執行器本身** —— 但逐表清空與角色 fixture 正是在測試行程內直接連 DB 的，漏掉這一側同樣會刪掉 `dev.db` 的認證域，且更難察覺（伺服器那側看起來完全正常），故改由單一函式 `loadTestEnv()` 同時供應兩側；**(d) `DATABASE_PROVIDER` 若被寫進 `.env.test`，雙軌兩輪會跑在同一種資料庫上**，「兩軌結果完全一致」將恆真且毫無驗證力 —— 明訂它是唯一由指令層傳入的變數，且 globalSetup 須印出本輪實際採用的種類供覆核；**(e) 單元測試沒有任何環境注入來源**，而 `src/lib/env.ts` 在模組載入時即驗證，`npm run test` 會在第一次執行就全紅；(f) 「僅存本機」的加註漏掉 `NovelHero` 的**加入書架**控制項 —— 那是使用者最常觸發的入口，只在書架頁加註等於事後才告知，a11y 清單因此由 12 頁補為 **13 頁**；(g) 明訂「本階段新增或修改的頁面」的判準為「版面或控制項有可見／語意變更」，跨頁基礎設施（nonce、`SessionProvider`）不使 26 頁全數列入；(h) `.gitignore` 的 `!.env.test` **必須排在 `.env*` 之後**才生效，DoD 增列 `git check-ignore` 核對

> **一致性修正（2026-07-23，第六輪 `/speckit-analyze`）**：再修 10 項，任務數 103 → **105**（新增 T014a 連線探測 repository、T035a 憑證層模組）。本輪有兩個共同主題：**「模組邊界」與「安全網本身的漏洞」**。影響本節內容者為 —— **(a) 攔截層無法同時滿足兩條 MUST**：`verifyClaimsOnly`（零 I/O、供 `proxy.ts`）與 `readSession`（經 repository）原本同屬 `auth/session.ts`，而 `proxy.ts` 又被要求「呼叫前者」且「不得 import repositories」—— **模組相依是傳遞性的**，一 import 就把 Prisma 客戶端與 `better-sqlite3` 原生驅動拉進攔截層打包產物，`server-only` 在該層的解析條件下還可能於載入階段擲錯。拆出 `auth/sessionToken.ts`（只相依 `jose` + `env`）；**(b) `/api/health` 沒有合法的資料存取途徑** —— 它是 Route Handler，憲章第 III 條禁止它直連 prisma，但要回報「一次查詢的往返延遲」，而原設計只定義了 `users`／`sessions` 兩個 repository，實作時只剩「端點內 `$queryRaw`」一條路，等於在唯一必須感知資料庫種類的端點上鑿穿雙軌邊界。補 `repositories/health.ts`；**(c) `logSecurityEvent` 有實作、有單元測試，卻沒有任何任務要求呼叫它** —— 「有實作 + 有測試」不等於「有被呼叫」，且**沒有任何測試偵測得到**。明訂三個必須呼叫的位置（登入失敗／限流拒絕／越權被擋）並以原始碼稽核核對；**(d) 誠實標示的安全網自己有漏洞** —— `AuthorNovelList` 的連載狀態切換只改前端狀態卻提示「已重新上架」（假成功，且比表單類更誤導），逐項列舉把它歸類錯過，而 §10.6 的全站掃描又因原樣式 `showToast(.*'success'` 是**逐行**比對、該處為**跨行**呼叫而未命中 —— 列舉漏了它，補列舉之漏的掃描也漏了它。掃描改為只搜呼叫名稱；(e) `validateEnv` 抽為純函式（否則四種啟動失敗情況在單元測試層無法斷言，理由同 `buildCspPolicy`）；(f) a11y 的 8 頁與逐頁檢查的 9 頁**不得逐頁登入** —— 登入位址鍵 5 次/分鐘且計入所有送達請求，第 6 次起取回登入頁，又變回第四輪修掉的「對同一份登入頁反覆驗證」；(g) 攔截層 matcher 補上 `public/` 的副檔名排除（原本只排除 `_next/static`，與「靜態資源不經攔截層」的表述分歧）；(h) `test:integration` 的流程在 contracts 與 tasks 各有一個擁有者，照字面同時實作會建置兩次、啟兩個伺服器 —— 唯一擁有者定為 globalSetup；(i) `Session.tokenHash` 原寫「隨機 32 bytes token 的 sha256」，與其餘處一致的 JWT 描述衝突（opaque token 承載不了 `role` 快照）；(j) `.env.test` 的測試專用憑證與 SC-011 的界線寫入 README 已知限制

### 1-A～1-D 與實作階段的對應（2026-07-23 修正）

下列四組是**主題分類**，不等於執行順序。實際排程有三處必須調整，理由皆為硬性相依：

| 調整 | 內容 | 理由 |
|------|------|------|
| 1-A 的 **CSP nonce 管道與安全標頭**上提為最前置 | 與 1-B 同批 | nonce 由攔截層逐請求產生並經 root layout 下發；缺它則 CSP 一旦強制生效，全站 React 無法水合。它是其他工作的前提，不是可平行的支線 |
| 1-C 的 **schema 變更與密碼雜湊**上提為最前置 | 與 1-B 同批 | 兩軌各只能有**一個**涵蓋本階段全部變更的初始 migration，故「雙軌重組 + 身分域 schema + migration 產生」是不可拆的原子單元；seed 寫入 hash 亦需 `password.ts` 先在位 |
| **`/api/health` 維持在 1-B** | 不得後移 | 它是整合測試伺服器的**就緒探針**（`arch.md` §10.3）。若排在整合測試之後，測試啟動時只會輪詢到 404 而永遠等不到就緒 |

### 為什麼排第一

`nextstep.md` 的結論是：目前沒有可被攻擊的漏洞，**因為根本沒有後端**。一旦開了寫入的門，H-1／H-2 就會立刻變成真實漏洞。所以「裝鎖」必須先於「開門」。

雙軌基礎建設同樣排在最前：它**不改任何 model**，純基礎設施。先做完，之後每一次 migration 都天生產生 sqlite 與 postgres 兩份。反過來若先做認證，`Session` 表的 migration 只會落在 sqlite 目錄，日後得回頭補寫。

### 範圍

**1-A 平台加固（無 schema、無 auth，暖身用）**

| 工作 | arch 項目 | 檔案 |
|------|-----------|------|
| `openGraph.url` 硬編網址改用 `SITE_URL` | **M-5** | `src/app/layout.tsx:21`、`src/lib/siteConfig.ts` |
| 安全性 HTTP 標頭（CSP **強制模式，不採 Report-Only 過渡**、HSTS、X-Frame-Options、X-Content-Type-Options、Referrer-Policy、Permissions-Policy）。**職責切分**：CSP 因需逐請求 nonce 而由 `proxy.ts` 設定，其餘五個為靜態值由 `next.config.ts` 設定並套用於所有回應 —— 正好達成「靜態資源與 API 有防護但無 CSP 標頭」的驗收 | **E-5** | `next.config.ts`、`src/proxy.ts` |
| CSP 腳本允許方式採 **nonce + `'strict-dynamic'`**（逐請求產生，theme script 與 `next/script` 共用同一個；受影響頁面改動態產生）。**政策字串 MUST 抽為純函式 `buildCspPolicy(nonce, { isDev })`** —— 內嵌於攔截層則「正式產物零放寬」只能靠整合測試驗，失去最便宜的單元測試防線 | **E-4** | `src/proxy.ts`、**新增 `src/lib/security/csp.ts`**、`src/app/layout.tsx:47-64` |
| Vitest 建置 + 第一批單元測試。**三個設定檔各司其職**：`vitest.config.mts`（單元／node／`tests/unit/**`／**含 `react-server` 解析條件**）、`vitest.integration.config.mts`（整合／node／globalSetup／**含 `react-server`**）、`vitest.a11y.config.mts`（a11y／jsdom + React plugin／共用 globalSetup／**不得含 `react-server`**）。**分立的根本理由是解析條件無法兩全**：`server-only` 只有在 `react-server` 條件下才是空實作（node 與 jsdom **皆會**擲錯，「用 node 即可迴避」不成立），但同一條件會讓 `react` 解析到不含用戶端 Hook 的伺服器版本而無法渲染。次要理由才是「a11y 要 `fetch` 測試伺服器，併入單元設定檔會使 `npm run test` 必然失敗」 | **N-7** | `vitest.config.mts`、`vitest.integration.config.mts`、`vitest.a11y.config.mts`、`package.json` scripts |
| **測試基礎設施**：globalSetup 內建「`db:generate` → 測試 DB `migrate deploy` → 測試 DB `db:seed` → `next build` → `next start`（**動態空閒埠**，baseURL 以 `provide()` 傳給測試）→ 輪詢 `/api/health`」，**由整合與 a11y 兩套件共用**（但**兩者不得並行** —— 共用測試資料庫與 `.next` 目錄）；輔助程式含**清空認證域**（`Session` → `User`，不動內容資料表）、**角色 fixture**（經 repository + `hashPassword` 建立 `author`／`admin`）、**位址隔離的 fetch 包裝**（`ip` 必填無預設值、網址取自 baseURL 不得硬編埠號）。**輔助程式置於 `tests/` 根層，但兩檔的引用邊界須切分**：`client.ts`（`baseUrl`／`testFetch`／`loginAs`，純 HTTP、不 import 任何 `src/**`）由整合與 a11y 共用；`fixtures.ts`／`resetAuthTables.ts`（經 repository 與 `db.ts`）**僅整合測試可引用** —— a11y 的解析條件下 `server-only` 會擲錯。**測試伺服器的 stdout／stderr 改以 `pipe` 接出並同步 tee 至 `novelsite/.server-stdout.log`，路徑經 `provide()` 傳給測試**（**FEAT-7 T031a 裁示，2026-08-22**）：原文的 `stdio: 'inherit'` 讓子行程直接寫父行程的檔案描述子，測試行程碰不到中間任何一段，**伺服器端 `console.log` 的稽核與匯入紀錄因此完全無從驗證**，而「所有出口都要記錄、含身分驗證前的提前返回」只有打真實端點才證明得了；讀取端 `serverLog.ts` 比照 `client.ts` **不得 import 任何 `src/**`**。詳見 `arch.md` §10.3 | **N-7** | `tests/globalSetup.ts`、`tests/helpers/*` |
| **測試環境設定檔與組態函式**：`.env.test` **隨 repo 版控**（`.gitignore` 加 `!.env.test` 反向例外，**該行須排在 `.env*` 之後**才生效），內含測試資料庫連線（兩軌各一）、**`TRUSTED_PROXY_HOPS=1`**、測試用 `SESSION_SECRET`／`SEED_USER_PASSWORD`／`HEALTH_CHECK_SECRET`／**`VIEW_HASH_SECRET`／`CRON_SECRET`**（後兩者為 FEAT-4 T003 追加，2026-08-07 —— `VIEW_HASH_SECRET` 自 FEAT-4 起是啟動期必要變數，本檔缺它會使**全部整合測試**在伺服器啟動階段就紅，症狀是「環境變數驗證失敗」而非任何測試斷言，照原文重建本檔的人看不出跟這裡有關）；**不得收錄 `DATABASE_PROVIDER`**（唯一由指令層傳入者，寫入即讓雙軌兩輪跑同一軌）。由 `tests/testEnv.ts` 的 `loadTestEnv()` 統一組出並**注入兩側** —— 三個 vitest 設定檔的 `test.env`（測試執行器）與 globalSetup 啟動的四個子行程，**不得要求開發者手動 `export`**。缺此注入的後果皆為靜默：`TRUSTED_PROXY_HOPS` 為 `0` 時 `X-Forwarded-For` 完全失效（位址鍵隔離崩潰），`DATABASE_URL` 沿用開發值時逐表清空會**刪掉 `dev.db` 的認證域**；**只注入子行程而漏掉測試執行器時，後者照樣發生卻更難察覺** | **N-7** | `.env.test`、`.gitignore`、`tests/testEnv.ts`、`tests/globalSetup.ts` |
| **啟動期設定驗證**：缺 `SESSION_SECRET`／長度不足／provider 與連線字串不符即拒絕啟動，不自動產生臨時密鑰。**驗證邏輯須抽為純函式 `validateEnv(source)`** —— 只寫在模組載入副作用中則四種失敗情況在單元測試層無法斷言（測試行程必然已注入合法設定），理由同 `buildCspPolicy`；啟動記錄的輸出屬副作用，留在模組層 | §3.5 | 新增 `src/lib/env.ts` |

**1-B 雙軌 DB 基礎建設（純基礎設施，model 定義不變）**

| 工作 | arch 項目 | 檔案 |
|------|-----------|------|
| `base.prisma` + `headers/{sqlite,postgres}.prisma` + 產生器 | §3.2 | `prisma/`、新增 `scripts/build-schema.ts` |
| `prisma.config.ts` 依 `DATABASE_PROVIDER` 選 schema 與 migrations 路徑 | §3.2 | `prisma.config.ts` |
| migration 目錄分軌（`migrations/sqlite/`、`migrations/postgres/`） | §3.2 | `prisma/migrations/` |
| **重置既有 migration 歷史**：刪除單軌的 `20260722122104_init`、`20260722122840_author_tables`，兩軌各重新產生一個含本階段 schema 變更的初始 migration；開發庫重建後由 seed 還原（seed 本就先 `deleteMany`，內容一致）。**前提是尚無正式資料，僅此一次成立** | §3.2 | `prisma/migrations/` |
| `db.ts` 雙 adapter 切換 + **singleton 不分環境掛 `globalThis`** | **M-3**、§3.3 | `src/lib/db.ts` |
| npm scripts 調整（`db:schema`／`db:generate`／`db:migrate`／`db:reset`） | §3.2 | `package.json` |
| **`docker-compose.yml`**：本機 PostgreSQL + 獨立整合測試 DB，`docker compose up -d` 即可用，不依賴外部帳號或付費服務 | §3.2 | `docker-compose.yml` |
| `/api/health`（**密鑰分流**：匿名只回 ok/fail，帶 `HEALTH_CHECK_SECRET` 才回 provider、DB 延遲、`TRUSTED_PROXY_HOPS` 與 `rateLimitMode`） | §5.3 | `src/app/api/health/route.ts` |
| **`repositories/health.ts` 的 `pingDatabase()`**（第六輪補入）：發出 provider 中立的最小往返並計時，連線失敗回 `{ okay: false }` 而非擲出。**`/api/health` 是 Route Handler，憲章第 III 條禁止它直連 prisma**，而它又是唯一必須感知資料庫種類的端點 —— 缺這一層就只剩「端點內 `$queryRaw`」一條路，等於在剛建立雙軌抽換邊界的同時親手鑿穿它 | §2.2 R1、§5.3 | `src/lib/repositories/health.ts` |

**1-C 認證核心**

| 工作 | arch 項目 | 檔案 |
|------|-----------|------|
| schema **增量**變更：`User.passwordHash`、`User.termsAcceptedAt`、**移除 `User.isAuthor`（身分只留單一 `role`）**、新增 `Session` 表 | §4.2 | `prisma/base.prisma` |
| argon2id 雜湊（`@node-rs/argon2`，退路 bcrypt cost=12）；成本參數 **`m=19456, t=2, p=1, outputLen=32`** 集中為具名常數 `ARGON2_PARAMS`，`DUMMY_HASH` 以相同參數產生 | **H-2**、§7.2 | `src/lib/auth/password.ts` |
| jose 簽發／驗證，DB 存 **`sha256(JWT 字串)`** 於 `Session.tokenHash`；**滑動有效期 30 天 + 絕對上限 90 天 + 節流寫入 24 小時**；JWT payload 含 **`role` 快照**（供攔截層零查詢判斷，非權威來源）。**Cookie 屬性集中為 `SESSION_COOKIE` 常數，`maxAge` 取絕對上限 × 86400（90 天）而非閒置期限** —— 取 30 天則活躍使用者的 Cookie 會在第 30 天自行消失，滑動延展與絕對上限在瀏覽器端永不生效；Cookie **不隨滑動延展重新下發**（重新下發須在每個頁面請求寫回應，違反公開頁零成本） | **H-1** | `src/lib/auth/{sessionToken,session}.ts` |
| **憑證層與工作階段層必須是兩個模組**（第六輪補入）：`sessionToken.ts` 放簽發／驗簽／`SESSION_COOKIE`／`hashToken`，**只相依 `jose` + `env`**，是 `proxy.ts` **唯一**可引用的 auth 模組；`session.ts` 放經 repository 的查詢／延展／撤銷，且**不得轉出 `verifyClaimsOnly`**（轉出即留下讓攔截層 import 它的後門）。理由：**模組相依是傳遞性的** —— 原設計兩者同檔時，`proxy.ts` 一 import 就把 Prisma 客戶端與原生驅動拉進攔截層打包產物，`server-only` 還可能在該層的解析條件下於載入階段擲錯，直接違反「攔截層零 I/O、不得引用 repositories」 | **H-1**、§7.1 | `src/lib/auth/sessionToken.ts`、`src/proxy.ts` |
| `getSession` / `requireUser` / `requireAuthor`（**以 DB `User.role` 覆核**，`role ∈ {author, admin}`）/ `requireOwner` | **H-1** | `src/lib/auth/guard.ts` |
| 速率限制：登入**雙鍵**（位址 5/min **且** 帳號 5/15min，任一達標即拒，成功登入重置帳號鍵）、註冊 3/hr/位址；**帳號鍵對不存在的 email 一律計數且限流早於查 DB**（否則 429/401 差異可枚舉帳號），鍵值存正規化 email 的 sha256；**註冊與位址鍵計入所有送達的請求（含 400 驗證失敗與 409 衝突），限流判斷早於 Zod 驗證**（否則「400 vs 409」的差異同樣可枚舉 email）；來源位址依 `TRUSTED_PROXY_HOPS` 自右往左取；**單機記憶體實作，須標示 `rateLimitMode=single-instance`**，介面可換 Redis | §7.6 | `src/lib/auth/rateLimit.ts` |
| **結構化安全事件輸出到 stdout**（事件類型／時間／來源位址／結果四欄位，不含密碼與 token 原文；不建稽核表）。**必須接上三個呼叫點**（第六輪補入）：登入失敗（`auth.login.failed`，密碼錯誤與帳號不存在皆記且內容一致）、限流拒絕（`auth.rate_limited`）、越權被擋（`authz.denied`，攔截層守衛 + `requireAuthor`）。**「有實作 + 有單元測試」不等於「有被呼叫」**，且沒有任何測試偵測得到 —— 以原始碼稽核逐一核對 | §7.6 | `src/lib/auth/audit.ts`、`services/authService.ts`、`auth/guard.ts`、`src/proxy.ts` |
| Zod schema（client/server 共用），註冊含 **`acceptTerms` 必為 `true` 的伺服器端驗證** | §5.1 | `src/lib/validation/auth.ts` |
| `authService`：註冊（**email 唯一性 → 409 CONFLICT**、寫入 `termsAcceptedAt`）、登入、登出；**改密碼只做伺服器端函式**（撤銷該使用者全部 session，不開端點、不做 UI） | **M-1** | `src/lib/services/authService.ts` |
| 登入成功時**順帶刪除該使用者自己已過期／已撤銷的 session**（不建排程、不碰請求熱路徑；清理失敗不得導致登入失敗） | §7.6 | `src/lib/repositories/sessions.ts` |
| `users` / `sessions` repository（`health` 見 1-B） | E-3 | `src/lib/repositories/{users,sessions}.ts` |
| API：`POST /api/auth/{register,login,logout}`、`GET /api/auth/me` | §5.2 | `src/app/api/auth/**` |
| Server Actions：`registerAction` / `loginAction` / `logoutAction` | §5.2 | `src/app/auth/actions.ts` |
| seed 建立 `reader` / `author` / `admin` **三個帳號**並寫入 hash（密碼取自 `SEED_USER_PASSWORD`，未設定則各自隨機並印 console） | **H-2** | `prisma/seed.ts` |

**1-D 伺服器端信任邊界**

| 工作 | arch 項目 | 檔案 |
|------|-----------|------|
| 路由攔截：`/author/*`、`/profile/*` 未登入 302；`/author/*` 另檢查 **JWT claim 的 `role`**（雖然 Next 16 的 Proxy 預設跑 Node runtime、技術上可連 DB，但官方明言不應以此承擔授權，且全站攔截不得付查詢成本 —— 故角色仍隨憑證攜帶）；同時**逐請求產生 CSP nonce** 並向下傳遞 | **H-1** 防線①、**E-4** | **`src/proxy.ts`**（Next 16 已自 `middleware.ts` 更名，已查證結案） |
| 攔截層 **matcher 作用於全站頁面請求**（因每頁都要 nonce），排除 **`api` 整個前綴**（含 `/api/health`；API 回應是資料而非頁面、不含腳本，其來源驗證由端點自身的 `assertSameOrigin` 負責）、`_next/static`、`_next/image`、`favicon.ico`、**`public/` 下靜態檔案的常見副檔名**（第六輪補入 —— 前綴排除只涵蓋框架打包輸出，`public/` 的檔案以 `/檔名.副檔名` 直接命中，不排除即會被加上 CSP 標頭而與「靜態資源不經攔截層」的表述分歧）與 prefetch；**只有 `/author/*`、`/profile/*` 走守衛分支**，公開頁不付驗簽成本；公開頁與受保護頁**套用同一套 CSP**，不得為公開頁另設寬鬆版。注意 matcher 排除某路徑會**同時跳過該路徑上的 Server Action**，故每個 Action 內部仍須自行驗權 | §7.1、§7.5 | `src/proxy.ts` |
| layout 改 async Server Component，二次呼叫 `requireAuthor()` / `requireUser()`，**以 DB `User.role` 覆核**（快照不得凌駕 DB） | **H-1** 防線② | `src/app/author/layout.tsx`、`src/app/profile/layout.tsx` |
| **刪除** `ProfileGate`（client-side redirect，保護是視覺性的） | **H-1** | `src/components/profile/ProfileGate.tsx` + `.module.css` |
| `useAuth` 改讀伺服器傳入的 `SessionProvider`，不再信任 `localStorage`；**`SessionProvider` 必須掛在 root layout** —— `SiteHeader` 出現在全部 26 頁且讀取登入狀態，只掛 `/author`、`/profile` 的 layout 會讓公開頁面取不到 context。`useAuth` 對外形狀維持不變，使 5 個既有消費點不需連鎖改寫 | **H-1** | `src/hooks/useAuth.ts`、新增 `src/components/SessionProvider.tsx`、`src/app/layout.tsx` |
| **移除身分的第二欄位**：`AuthUser.isAuthor` → `role`、`joinedAt` → `createdAt`，並改寫其 UI 消費點 —— 只改 DB 不改型別層會使 `tsc --noEmit` 失敗 | **H-1**、§4.2 | `src/lib/types.ts:144-151`、`src/components/profile/AccountSettingsView.tsx:49` |
| **移除登入頁示範帳密提示**、移除 `MOCK_USER` / `MOCK_CREDENTIALS`（`prisma/seed.ts` 的 import 一併移除） | **H-2** | `src/components/auth/LoginForm.tsx:48-50`、`src/lib/content.ts:71-83`、`prisma/seed.ts:21` |
| 寫入端點比對 `Origin` 與 `Host`（CSRF）—— 已查證：**Server Action 內建此比對，Route Handler 沒有**，故僅 `/api/*` 需自行實作；§10.3 案例 13 因此必須打 Route Handler | §7.6 | **`src/lib/auth/origin.ts`**（`guard.ts` re-export，import 路徑不變）。**FEAT-4 裁示（2026-08-08，T102）**：實作本體自 `guard.ts` 移出 —— 該檔匯入 `next/navigation` 的 `redirect()`，而 `routeHelpers.ts` 需要 `SameOriginError`，那條相依把 App Router 的 React context 拉進 `routeHelpers.ts`，使整合測試無法直接呼叫 `assertCronSecret`（「`CRON_SECRET` 未設定即拒絕」只能在測試行程內驗守衛函式），載入階段即以 `React.createContext is not a function` 失敗。比對只需要兩個請求標頭、不需要轉址，故與 `ownership.ts` 同法拆出 |
| 登入頁 `next` 參數**只接受站內路徑**，外部網址忽略並改用預設頁（防開放轉址） | §7.6 | `src/lib/auth/guard.ts` |
| 註冊表單新增**條款／隱私權必填勾選**（附 `/terms`、`/privacy` 連結），未勾選不得送出 | §5.2 | `src/components/auth/RegisterForm.tsx` |
| **尚未接通寫入的控制項一律停用並標示「功能開發中」**（含作品／章節編輯入口、**聯絡表單送出**、**作者作品列表的連載狀態切換**），移除所有假成功提示。`ContactForm` 的「訊息已送出，我們會盡快與你聯繫」實際無任何寄送途徑，對訪客謊報與登入後的假成功同性質；**`AuthorNovelList.toggleStatus` 只改前端狀態卻提示「《…》已重新上架」／「已暫停連載」，重新整理即回復原狀 —— 屬假成功且更具誤導性**（作者會以為作品真的下架了，第六輪補入）。**本條適用全站、且不限於表單送出**，判準是「這個操作真的寫入了嗎」。**收尾須以全站掃描確認**（見下方 DoD 第 14 項） | 6.2、6.3 | `AccountSettingsView.tsx`、`CreateNovelForm.tsx`、`ChapterEditor.tsx`、`src/components/layout/ContactForm.tsx`、`src/components/author/AuthorNovelList.tsx` |
| 作者儀表板統計區塊標示「**示範資料，尚未接上真實統計**」（圖表與版面保留，不隱藏） | 6.2 | `src/components/author/AuthorDashboardView.tsx` |
| **作者收益頁的預估金額同樣標示「示範資料，尚未接上真實統計」**並與區塊建立程式化關聯 —— 頁尾現有的「示範性預估值」不足，該措辭把數字表述為合理估算而非未接通的假資料。金額語意移除屬 **FEAT-2**（H-3 解除條件，改為非金額「作品成效」）；需真實統計的完整成效指標屬 FEAT-4 N-8 | 6.2 | `src/app/author/earn/page.tsx` |
| 作者作品列表標示「**示範資料，作品擁有權尚未接上**」—— `getAuthorNovels()` 查詢無擁有者條件，任何作者都看到同一批；`authorId` 外鍵屬 FEAT-2 | 6.2 | `src/components/author/AuthorNovelList.tsx`、`src/lib/repositories/authors.ts:30` |
| 書架／閱讀歷史／閱讀偏好加註「**目前僅保存在此瀏覽器，換裝置不會同步**」（功能保留可用，**不得因已登入而停用**）。**加註對象為每一個接觸點共 4 處，不只列表頁** —— 除書架頁、歷史頁、閱讀頁偏好面板外，**`NovelHero` 的「加入書架」控制項同樣要加註**（第五輪補入）：它只寫本機，卻是使用者最常觸發的入口，只在書架頁加註等於在使用者做完決定之後才告知 | 6.1 | `src/hooks/{useBookshelf,useReadingHistory,useReaderPrefs}.ts` 的消費頁面、`src/components/novel/NovelHero.tsx` |
| 登入頁與註冊流程**明示「本階段尚無密碼重設功能」**（註冊須在送出前告知）；**不得放任何「忘記密碼」入口或流程假象** —— 本階段無重設信、無管理端重設、改密碼函式不對外，真實使用者忘記密碼即帳號永久失效 | §7.2 | `LoginForm.tsx`、`RegisterForm.tsx`、README 已知限制 |
| **瀏覽器停用 Cookie 的處置**：登入請求成功但後續請求未帶回憑證時，顯示「請啟用 Cookie 才能維持登入」的可理解提示，**不得反覆導回登入頁形成無限跳轉**。此判斷純屬體驗，**不得作為授權依據** | §7.6 | `LoginForm.tsx` |
| **新增元素的無障礙三條**：(1) 停用控制項的「功能開發中」原因可被輔助技術讀出，非僅視覺樣式；(2) 「示範資料」／「僅存本機」標示與其所述區塊有程式化關聯；(3) 表單錯誤與對應欄位關聯並可讀出。表單元件 id 一律用 `useId`（`LoginForm` 與 `RegisterForm` 皆是） | 憲章 V | `RegisterForm.tsx`、`LoginForm.tsx`、`AccountSettingsView.tsx`、`AuthorDashboardView.tsx`、`AuthorNovelList.tsx` |
| **新增樣式一律走既有設計 token**：停用態與「示範資料」／「僅存本機」標示區塊的顏色與間距 MUST 取自 `design-tokens.css`／`design-system/MASTER.md`，**不得硬編色碼**；需要新語意時先於 token 層新增再引用，並須在三個主題下皆可讀（與 CSP 的主題切換驗證同批確認） | 憲章技術約束 | `design-tokens.css`、上列各 `.module.css` |

### 新增依賴

`jose`、`@node-rs/argon2`（或 `bcrypt`）、`zod`、`@prisma/adapter-pg`、`pg`（dependencies）
`vitest`、`@vitejs/plugin-react`、`vite-tsconfig-paths`、`jsdom`、`@testing-library/react`、`@testing-library/dom`、`axe-core`、`dotenv`（devDependencies）

> `dotenv` 現為 `prisma → @prisma/config → c12` 的**傳遞相依**，但 `prisma.config.ts` 直接 `import 'dotenv/config'` —— 屬未宣告相依，必須補為明確 devDependency。
> a11y 檢查以 **`axe-core` + jsdom** 實作，**本階段不引入 Playwright**（E2E 框架於 **FEAT-3** 導入並交付作者流一條，其餘三條流程屬 FEAT-4；原文寫「屬 FEAT-4」，2026-07-30 修訂）：頁面層自測試伺服器取回正式建置產物的 HTML 再驗，互動狀態層以 React Testing Library 渲染 Client Component 後驗。已知限制：jsdom 無版面計算，`color-contrast` 規則須停用，對比度稽核留給 FEAT-4。

### 完成定義（Definition of Done）

1. 未登入直接開 `/author/dashboard` → **伺服器端** 302 到 `/auth/login`，且**回應 HTML 本體不含後台任何內容**（用 `curl` 檢視原始回應，非看瀏覽器畫面）
2. 讀者帳號（`role='reader'`）開 `/author/*` → 302 到 `/`；`author` 與 `admin` 可正常進入
3. DB 內 `User.passwordHash` 以 `$argon2id$` 開頭，全表查無明碼；`grep -rn "isAuthor" src prisma` 無結果（含 `src/lib/types.ts` 的 `AuthUser` 與 `AccountSettingsView` 的身分顯示）
4. 重複 email 註冊 → 409 `CONFLICT`，訊息「此 Email 已被註冊」，DB 不新增列
5. 未勾選條款送出註冊（含繞過前端直送）→ 400；成功註冊者 `termsAcceptedAt` 有值
6. 對同一帳號登入失敗 5 次後第 6 次 → 429 + `Retry-After`；**5 次失敗須各用不同來源位址**（位址鍵門檻同為 5 次/分鐘，共用位址時第 6 次會先被位址鍵擋下，證不到帳號鍵）；**對不存在的 email 做同樣操作，回應與前者完全相同**
7. `grep -r "MOCK_CREDENTIALS\|novelsite123" src` 無結果
8. `DATABASE_PROVIDER` 兩種值皆能 `db:generate` + `db:migrate` + `db:seed` + `build`，且 seed 後 DB 內存在 `reader` / `author` / `admin` 三個帳號。**切換軌別前必先 `db:generate`** —— 產生物依 provider 而異、兩軌共用同一輸出目錄，沿用前一軌會連上錯誤的資料庫
9. CSP **以強制模式**生效且防閃爍 theme script 未被擋（DevTools Console 無 CSP violation）；**React 正常水合**（框架內聯腳本未被擋）；捲動動畫、Chart.js 圖表、三主題切換、GA4 逐一驗證未失效（**驗證 GA4 時必須設定 `NEXT_PUBLIC_GA_ID`**，未設定時分析元件完全不輸出 script，等同未驗）；**正式建置產物的** `script-src` 不含 `'unsafe-inline'` 與 `'unsafe-eval'`（開發模式因 React 以 `eval` 重建錯誤堆疊而追加 `'unsafe-eval'`，為唯一且僅限開發模式的例外，須以單元測試斷言正式模式政策字串）
10. 同一頁面連續兩次請求的 **nonce 不相同**，且回應標頭中的 nonce 與 HTML 內 `<script nonce>` 一致；公開頁與受保護頁取得**同一套 CSP**；**靜態資源與 API 端點（含 `/api/health`）回應不含 CSP 標頭，但仍具備 `next.config.ts` 設定的其餘五個安全標頭**
11. `/api/health` 匿名請求回應不含 provider、延遲、`trustedProxyHops` 與 `rateLimitMode`；帶 `HEALTH_CHECK_SECRET` 才有
12. 未設 `SESSION_SECRET`（或設為長度不足的範例值）→ **啟動失敗並明確報錯**，不得自動產生臨時密鑰繼續運行
13. 啟動記錄含 `rateLimitMode=single-instance`；README 已標示多執行個體部署本階段未支援
14. 全站無假成功提示；未接通的控制項（含編輯入口、**聯絡表單**與**作者作品列表的連載狀態切換**）皆停用並標示「功能開發中」；儀表板統計、**收益頁金額**與作者作品列表皆有示範資料標示；書架／歷史／偏好有「僅存本機」加註且功能仍可用。**驗收方式為全站掃描而非逐項清單**：`grep -rn "showToast(\|setSubmitted(\|setSent(" src`，每一處命中都要能回答「這個操作真的寫入了嗎」——`ContactForm` 與 `/author/earn` 是第三輪、**`AuthorNovelList` 的狀態切換是第六輪**才發現的漏項。
    **掃描樣式必須夠寬（第六輪修正）**：原樣式 `showToast(.*'success'\|…` 要求呼叫名稱與參數落在**同一行**，會漏掉跨多行書寫的呼叫 —— `AuthorNovelList` 的狀態切換正是這種寫法。**安全網本身也會有漏洞**：掃描樣式若寫得太精確，它就退化成另一份列舉。故只搜呼叫名稱本身，命中數變多是可接受的成本
14a. **`logSecurityEvent` 的三個呼叫點皆存在（第六輪新增）**：`grep -rn "logSecurityEvent(" src` 的命中須涵蓋 `auth.login.failed`（登入失敗）、`auth.rate_limited`（限流拒絕）、`authz.denied`（越權被擋）三類，任一類為 0 即安全事件記錄未完成。**這是「該有的有」型稽核** —— 其餘各項驗的是「不該有的沒有」，而只有實作與單元測試的函式在從未被呼叫時，所有測試依然全綠
14b. **攔截層未把資料存取層拉進來（第六輪新增）**：`src/proxy.ts` 的 import 僅限 `next/server`、`@/lib/security/csp`、`@/lib/auth/sessionToken`、`@/lib/auth/audit`；出現 `@/lib/auth/session`、`@/lib/auth/guard`、`@/lib/repositories/*`、`@/lib/db`、`@prisma/*` 任一即為違反。同批確認 `/api/health` 的延遲取自 `repositories/health.ts` 的 `pingDatabase()`，端點內無 `import { prisma }` 或 `$queryRaw`（憲章第 III 條）
15. 既有 26 個頁面合併後全部可正常開啟。**其中 9 頁在 1-D 完成後為受保護路由**（`/author/` 的 `create`、`dashboard`、`earn`、`editor/{chapterId}`、`guide`、`novels`；`/profile/` 的 `bookshelf`、`history`、`settings`），取這 9 頁**必須帶登入 Cookie 並斷言 200**，不得把 302 或取回的登入頁計為「正常開啟」—— 否則會在 9 個頁面上驗到同一份登入頁而全綠，與第 18 項已修正的 a11y 漏洞同性質。**登入須每個角色只做一次並重用 Cookie**（第六輪補入）—— 登入位址鍵為 5 次/分鐘且計入所有送達請求，逐頁登入會在第 6 次起全被 429、取回登入頁，反而變成同一個坑的另一個入口
16. 兩軌各只有**一個**初始 migration，舊的單軌 migration 已不存在；自空 DB 套用 + seed 後網站內容與改造前一致
17. 登入頁與註冊流程皆明示尚無密碼重設功能；`grep -rn "忘記密碼\|forgot" src` 無任何入口
18. 本階段新增／修改頁面的 a11y 檢查零違規；停用控制項的原因與示範資料標示皆可被輔助技術讀出。**目標清單為 13 頁、其中 8 頁在 `/author/*`／`/profile/*`，取 HTML 時必須帶登入 Cookie 並斷言 200**；**反向驗證**：暫時移除 Cookie 後該測試須失敗 —— 仍全綠代表它一直在驗登入頁，等於沒驗。
    **清單由「版面或控制項有可見／語意變更」反推，不以既有清單為準**：公開 5 頁（`/auth/login`、`/auth/register`、`/contact`、**`/reader/{novelId}/{chapterId}`**、**`/novels/{novelId}`**）、需讀者登入 3 頁（`/profile/settings`、`/profile/bookshelf`、`/profile/history`）、需作者登入 5 頁（`/author/dashboard`、`/author/novels`、`/author/earn`、**`/author/create`**、**`/author/editor/{chapterId}`**）。粗體頁面為第四／五輪覆核補入 —— `CreateNovelForm` 與 `ChapterEditor` 正是「停用原因可讀出」的主要落地處，閱讀偏好面板與 `NovelHero` 的加入書架正是「標示與區塊程式化關聯」的落地處，漏驗等於這兩條規則在最主要的落地處沒有防線。**判準本身亦須明訂**：跨頁基礎設施（nonce 注入、`SessionProvider`）技術上觸及全部 26 頁，但不改變任何頁面的可存取語意，**不得**據此把 26 頁全列入（那等同 FEAT-4 的全站稽核）。三個動態路由的參數須自示範資料取實際值（**經公開頁面的 HTTP 回應解析，不得經 repository**），硬編猜測值會驗到 404 頁。
    **帳號來源**：以 `SEED_USER_PASSWORD` 經 HTTP 登入示範帳號取得 Cookie（`tests/helpers/client.ts` 的 `loginAs()`，純 `fetch`）；**不得改用 `createUser()`** —— 該函式經 repository（`server-only`），在 a11y 設定檔的解析條件下會擲錯。前提為 a11y 套件**不得清空認證域**，示範帳號才會全程在庫。
    **但登入不得逐頁做（第六輪補入）**：於 `beforeAll` **每個角色只登入一次並重用 Cookie**（`readerCookie`／`authorCookie` 各一），或每次登入各用專屬 `X-Forwarded-For`。登入位址鍵為 5 次/分鐘且計入所有送達請求，8 個受保護頁逐頁登入會在第 6 次起全被 429 —— 拿不到 Cookie、取回登入頁，於是「斷言 200」失敗，或（若斷言寫得寬鬆）**又退回第四輪修掉的「對同一份登入頁驗 8 次」**
19. 對正式建置產物實測註冊與登入各 ≥30 次，**p95 < 1 秒**，數值記錄於 README；逼近上限時下調 `ARGON2_PARAMS.memoryCost` 後重新量測。**量測須設 `TRUSTED_PROXY_HOPS=1` 並讓每次請求各用一個位址、登入用足量不同帳號** —— 共用位址時第 4 次起全被 429，而被限流的請求不執行密碼雜湊，數值會失真且偏樂觀；**不得為量測調高門檻或停用限流**（`arch.md` §7.2、§7.6、§10.6）
20. `SessionProvider` 掛在 root layout，公開頁面的 `SiteHeader` 能正確顯示登入狀態（只掛受保護區域即為未完成）。**不得以「公開頁零成本」為由改掛受保護 layout** —— 該要求的對象是攔截層；版面層對**未登入訪客本來就是零查詢**（無憑證可讀即回 `null`），只有已登入者才付每頁一次的成本，這是 `SiteHeader` 出現於全部 26 頁的必然代價
21. 登入回應的 `Set-Cookie` 其 `Max-Age` 為**絕對上限**換算的秒數（預設 90 天 = `7776000`），**不得**為閒置期限的 30 天（`2592000`）—— 取錯則活躍使用者的憑證在第 30 天自行消失，滑動延展與絕對上限在瀏覽器端永不生效
22. `npm run test:integration` **連續執行兩次**皆全綠（測試自行清理、無殘留狀態），且執行前後 `dev.db` 各表筆數**完全一致**；**自完全空白的測試資料庫**（先 drop 或刪 `test.db`）執行一次亦全綠 —— 驗證結構套用與示範資料載入確實內建於 globalSetup，而非依賴上一輪殘留
22a. `npm run test` **在未啟動任何伺服器的情況下獨立通過** —— 驗證單元設定檔的 `include` 只含 `tests/unit/**`，未混入需要伺服器的 a11y 頁面層測試
22b. **測試環境設定隨 repo 版控且注入兩側**：clone 後不需手動 `export` 即可跑整合測試；`TRUSTED_PROXY_HOPS=1` 與測試資料庫連線在**測試執行器與四個子行程**上皆生效 —— 未生效時位址鍵隔離會失效（測試互相擋死），且逐表清空會刪掉 `dev.db` 的認證域。另 `git check-ignore -v .env.test` **須無輸出**（驗證 `!.env.test` 排在 `.env*` 之後而生效）。**`test:integration` 與 `test:a11y` 須循序執行**（共用測試資料庫與 `.next` 目錄，並行時前者的清空會讓後者的登入 Cookie 失效）。**FEAT-6 起擴為三套循序（2026-08-13）**：新增的 `test:basepath` 以 `NEXT_PUBLIC_BASE_PATH` 建置，會覆蓋同一份 `.next` 產物，故 MUST 一併納入循序執行——並行時的症狀是「另一套測試莫名其妙開始失敗」，而原因不會指向這裡（規格 FR-078b、`arch.md` §10.1 已同步）
22d. **雙軌兩輪確實跑在不同資料庫**：兩輪 globalSetup 啟動記錄所印的 `DATABASE_PROVIDER` 須不同。忘記帶該變數、或誤把它寫進 `.env.test`，兩輪都會跑同一軌且**全部通過**，第 8 項與 `arch.md` §10.5 的雙軌驗收形同未做
22e. **三個 vitest 設定檔的解析條件正確**：單元與整合含 `react-server`（否則 `repositories/*` 的 `server-only` 在 import 階段擲錯，測試全紅）、a11y **不含**（否則 `react` 解析到伺服器版本，React Testing Library 無法渲染）；且 `tests/a11y/**` 之中無任何 `src/**` 伺服器端模組的 import
22c. **新增樣式無硬編色碼**：停用態與示範資料標示的顏色／間距皆取自 `design-tokens.css`，且三個主題下皆可讀（憲章技術約束）
23. **人工驗收四項**（本階段無 E2E 框架，不得寫成驗不到目標的假自動化測試）：註冊全程實測 < 2 分鐘；開發者工具竄改 `localStorage` 後重載受保護頁面仍為未登入；停用瀏覽器 Cookie 後登入取得可理解提示且無無限跳轉；**以 `curl` 檢視登入回應的 `Set-Cookie`，其 `Max-Age` 為 `7776000`（90 天絕對上限）而非 `2592000`** —— 單元測試已斷言 `SESSION_COOKIE.maxAge`，此為實際回應上的覆核（第 21 項）

### 測試

- **單元**：`password`（hash≠明碼、verify 正誤、同密碼兩次 hash 不同）、`session`（簽發→驗證往返、閒置逾期拒絕、滑動延展生效、節流門檻內不寫入、絕對上限不被突破、竄改拒絕、撤銷後失效、改密碼後全數失效、**payload 含 `role` 快照且竄改 role 亦被驗簽擋下**、**`SESSION_COOKIE.maxAge` 等於絕對上限 × 86400**）、`validation/auth`（email 格式、密碼 ≥8 含英數、`acceptTerms` 必填）、`rateLimit`（位址鍵與帳號鍵各自達上限即拒、換位址不能繞過帳號鍵、時間窗重置、成功登入重置帳號鍵、**不存在的帳號同樣被計數並限流**、依 `TRUSTED_PROXY_HOPS` 取位址且不受偽造標頭影響）、`env`（缺 `SESSION_SECRET`／長度不足／provider 與連線字串不符皆拋錯）、**`csp`**（`buildCspPolicy()` 正式模式零放寬、開發模式僅多 `'unsafe-eval'`）、**`audit`**（輸出單行 JSON、四欄位齊備、**輸出字串不含密碼與 token 的值**）
- **整合**：`arch.md` §10.3 案例 1–6、13、14、**21（安全標頭 + nonce 不重複）、22（攔截層 matcher 範圍）共 10 案全數自動化**，跑在**獨立於 `dev.db` 的測試資料庫**上；HTTP 端點由**正式建置產物**提供（`db:generate` → **測試 DB `migrate deploy` → 測試 DB `db:seed`** → `next build` → `next start` 於測試埠，就緒偵測輪詢 `GET /api/health`；**套用結構不可省** —— 空資料庫時就緒探針本身查不到 DB，輪詢永遠等不到 200；不得用 dev server 或行程內模擬 —— 否則安全標頭與頁面產生方式與正式環境不同，等同未驗證）；隔離採**每個測試檔前依外鍵順序清空認證域**（`Session` → `User`；**不清內容資料表** —— 案例 22 要請求首頁、書庫與閱讀頁，清掉即無渲染對象；不用交易回滾 —— 測試打完整 HTTP 路徑，請求走獨立連線）；**需要 `author`／`admin` 的測試一律以 fixture 建立帳號**（示範帳號在第一個測試檔清空後即不存在，且註冊端點只能產生 `reader`）；**限流狀態另以鍵值天然隔離**（測試環境 `TRUSTED_PROXY_HOPS=1`、每檔專屬 `X-Forwarded-For`、每測試獨立 email；**註冊類測試需每個案例各一個位址** —— 註冊門檻僅 3/hr 且計入所有送達請求，單檔三案即觸底；**刻意觸發登入限流的案例，其 5 次失敗嘗試須各用不同位址** —— 位址鍵門檻同為 5/min，共用位址時第 6 次會先被位址鍵擋下而證不到帳號鍵；逐表清空還原不了記憶體中的計數 —— **不得加測試專用的重置後門**）；**須連跑兩次皆全綠且執行前後 `dev.db` 筆數不變**；兩種 provider 各跑一次且結果完全一致（Phase 9 的「一致」指錯誤碼與排序穩定性；級聯刪除屬 FEAT-2）
- **補充案例**（不在 §10.3 十案內，但屬 FEAT-1 的驗收面）：登出後舊憑證失效且不影響其他裝置的工作階段、**不帶有效憑證的請求即使攜帶任何其他客戶端資料仍視為未登入**（`localStorage` 竄改本身無瀏覽器可測，改驗此等價命題，實際竄改列人工驗收）、`next` 參數帶外部網址時導向站內預設頁、角色遭直接改 DB 後版面層仍以 DB 覆核擋下
- **無障礙**：本階段**新增／修改的頁面**跑自動化 a11y 檢查零違規；另人工確認三點 —— 停用控制項的「功能開發中」原因可被輔助技術讀出、示範資料標示與其所述區塊有程式化關聯、表單錯誤與欄位關聯（全站稽核屬 FEAT-4）
- **靜態**：build / lint / tsc

### 風險

| 風險 | 對策 |
|------|------|
| ~~Next 16 路由攔截檔名可能是 `proxy.ts` 而非 `middleware.ts`~~ **已確認為 `proxy.ts`** | 風險消解。**layout 的二次驗證仍是最後保險**，即使攔截層設定失誤也擋得住 |
| 產生物依 provider 而異、兩軌共用同一輸出目錄，切換軌別時忘記重新產生 → 第二輪測試以錯誤產生物連上另一種資料庫 | `db:generate` 內建於 `test:integration` 的 globalSetup，不依賴人工記得 |
| `/api/health` 若排在整合測試之後，就緒探針不存在，測試永遠等不到伺服器就緒 | 明訂 `/api/health` 屬 1-B 基礎建設批次，不得後移 |
| **測試資料庫沒有結構** → 就緒探針查不到 DB，輪詢永遠等不到 200，整合測試根本啟動不了（第三輪一致性檢查發現：原流程從 `db:generate` 直接跳到 `next build`） | globalSetup 內建「測試 DB `migrate deploy` + `db:seed`」；DoD 另要求**自完全空白的測試資料庫**跑一次驗證此步驟真的內建，而非依賴上一輪殘留 |
| **清空範圍過寬** → 若連內容資料表一起清，案例 22 的首頁／書庫／閱讀頁就沒有渲染對象；若示範帳號被清掉又沒有替代來源，需要 `author`／`admin` 的案例無帳號可用（註冊只產生 `reader`） | 清空範圍限定**認證域兩張表**，內容由 seed 提供且只讀；角色帳號一律由 fixture 經 repository + `hashPassword` 建立 |
| **a11y 測試併入單元設定檔** → `npm run test` 會去 `fetch` 一個沒被啟動的伺服器而必然失敗，綠燈閘門永遠達不成 | 拆為三個 vitest 設定檔；DoD 第 22a 項明確要求 `npm run test` 在未啟動伺服器時獨立通過 |
| **誠實標示以逐項清單驗收** → 列舉必漏（`ContactForm` 與 `/author/earn` 即是漏項） | 收尾改為**全站模式掃描**，對每一處命中回答「這個操作真的寫入了嗎」（DoD 第 14 項） |
| **a11y 頁面層以未登入的 `fetch` 取受保護頁面** → 取回的是登入頁，`axe.run()` 對同一份 HTML 反覆驗證而全綠，無障礙驗收形同未做（第四輪一致性檢查發現：目標頁多數落在受保護前綴，而輔助程式原本沒有任何登入機制；覆核後清單由 9 頁擴為 12 頁，第五輪再擴為 **13 頁、其中 8 頁需登入**） | `axeHelper` 加 `cookie` 參數並**斷言 200**；**帳號以 `SEED_USER_PASSWORD` 經 HTTP 登入示範帳號取得**（第五輪修正：原寫「以共用 fixture 建立」，但 fixture 經 repository，a11y 套件不得引用）；DoD 第 18 項增列**反向驗證**（移除 Cookie 後測試須失敗） |
| **測試伺服器埠號寫死** → 整合與 a11y 共用同一個 globalSetup、各自啟一個伺服器，同時執行時互撞 | 動態取空閒埠（`TEST_PORT` 有設定才用該值），baseURL 以 vitest `provide()` 傳給測試，測試端不得硬編 |
| **動態埠被誤讀為「可以並行跑」** → 兩個測試套件仍共用同一個測試資料庫與同一個 `.next` 輸出目錄：整合測試的認證域清空會讓 a11y 已登入的 Cookie 失效（其「斷言 200」隨機失敗），兩次 `next build` 互相覆寫產物（第四輪覆核發現） | 明訂**兩者不得並行**，彙總指令以 `&&` 循序串接；動態埠的價值在於循序執行下不受殘留埠佔用影響，而非開放並行 |
| **測試環境變數無人負責建立與注入** → `contracts/env.md` 早已規範卻沒有任務落實。後果皆為靜默：`TRUSTED_PROXY_HOPS` 預設 `0` 使 `X-Forwarded-For` 完全被忽略、全部測試共用直連位址而互相擋死；`DATABASE_URL` 沿用開發者殼層則逐表清空**直接刪掉 `dev.db` 的認證域**（第四輪覆核發現） | 新增版控的 `.env.test`（`.gitignore` 加 `!.env.test`，**該行須排在 `.env*` 之後**才生效，DoD 22b 以 `git check-ignore` 核對），由 `loadTestEnv()` 注入四個子行程；`DATABASE_URL` 依 provider 自動擇一，不得要求手動 `export` |
| **注入只做到子行程、漏掉測試執行器**（第五輪發現）→ 逐表清空與角色 fixture 正是在測試行程內直接連 DB 執行的，該行程沒有 `DATABASE_URL` 時同樣會清掉 `dev.db` 的認證域，且**比前一項更難察覺** —— 伺服器那一側看起來完全正常，只有 `dev.db` 悄悄少了使用者 | 抽出 `tests/testEnv.ts` 的 `loadTestEnv()` 為**唯一**組態來源，三個 vitest 設定檔以 `test.env` 注入測試執行器、globalSetup 以同一函式注入子行程；兩側不得各自拼裝（漂移的表現形式正是「子行程連測試庫、清空連開發庫」） |
| **`DATABASE_PROVIDER` 若被寫進 `.env.test`** → 它會覆蓋 `DATABASE_PROVIDER=postgresql npm run test:integration` 的指定，兩輪跑在同一種資料庫上，而「兩軌結果完全一致」將**恆真且毫無驗證力** —— 這是本階段最難察覺的一種靜默失效（兩輪皆綠，沒有任何其他訊號） | 明訂它是**唯一由指令層傳入**的變數，`.env.test` 不得收錄；`loadTestEnv()` 以 `process.env.DATABASE_PROVIDER ?? 'sqlite'` 取值；globalSetup 於啟動記錄印出本輪實際採用的種類，DoD 22d 要求跑完兩輪後回頭比對 |
| **`server-only` 使測試在 import 階段就擲錯**（第五輪發現）→ 該套件只有 `react-server` 一個解析條件指向空模組，**Vitest 的 node 與 jsdom 環境都不套用它**。原先「單元用 node 環境即可迴避」的理由不成立，整合測試的 fixture 與 a11y 頁面層都會在載入時直接失敗 | 單元與整合設定檔加 `resolve.conditions: ['react-server', …]`；**a11y 不得加**（`react` 也宣告該條件，加了會解析到不含用戶端 Hook 的伺服器版本），改為完全不 import `src/**`：憑證走 HTTP 登入示範帳號、Server Action 一律 `vi.mock`。DoD 22e 核對 |
| **單元測試沒有環境注入來源**（第五輪發現）→ `src/lib/env.ts` 在模組載入時即驗證，缺 `SESSION_SECRET` 就擲錯，而 `session.test.ts` 必然經 `session.ts` 觸及它 —— `npm run test` 第一次執行就全紅，DoD 22a 的綠燈閘門永遠達不成 | 三個 vitest 設定檔一律以 `loadTestEnv()` 填 `test.env`，單元套件同樣涵蓋 |
| **「僅存本機」的加註只做在列表頁**（第五輪發現）→ 加入書架的按鈕在作品詳情頁（`NovelHero`），使用者在**做決定的當下**看不到任何說明，到書架頁才被告知「換裝置不會同步」 | 加註對象改為該功能的**每一個接觸點**共 4 處（書架頁、歷史頁、閱讀偏好面板、`NovelHero` 的加入書架），a11y 清單同步由 12 頁補為 13 頁 |
| **a11y 與逐頁檢查的清單以既有列表為準** → 列舉必漏。第四輪覆核發現 a11y 漏掉 `/author/create`、`/author/editor/{chapterId}`、`/reader/{novelId}/{chapterId}` 三頁，而前兩者正是「停用原因可讀出」的主要落地處；「26 頁可正常開啟」則未處理受保護頁需登入，會在 9 頁上驗到同一份登入頁 | 清單一律**由「版面或控制項有可見／語意變更」反推**（a11y **13 頁** / 8 頁需登入；逐頁檢查 26 頁 / 9 頁需登入），受保護頁一律帶 Cookie 並斷言 200；跨頁基礎設施不使 26 頁全數列入 |
| **兩套整合測試案例編號並存** → `arch.md` §10.3 用 1–6、13、14、21、22，`spec.md` FR-032 用 1–10，跨文件引用「案例 22」時實作者會找不到對應 | 於 §10.3 與 `research.md` R-6 各置一份對照表，引用時標明編號出處 |
| **「零 I/O」被當成函式的性質而非模組的性質**（第六輪發現）→ `verifyClaimsOnly` 與 `readSession` 同屬 `auth/session.ts`，而 `proxy.ts` 被要求「呼叫前者」且「不得 import repositories」。**模組相依是傳遞性的**：一 import 就把 Prisma 客戶端與 `better-sqlite3` 原生驅動拉進攔截層打包產物，`server-only` 還可能在該層的解析條件下於載入階段擲錯 —— 兩條 MUST 無法同時成立 | 拆出 `auth/sessionToken.ts`（只相依 `jose` + `env`）作為攔截層**唯一**可引用的 auth 模組；`session.ts` **不得轉出** `verifyClaimsOnly`（轉出即留後門）。DoD 14b 以 import 稽核把關 |
| **API Route 沒有合法的資料存取途徑**（第六輪發現）→ `/api/health` 要回報「一次查詢的往返延遲」，但憲章第 III 條禁止 API Route 直連 prisma，而原設計只定義了 `users`／`sessions` 兩個 repository。實作時只剩「端點內 `$queryRaw`」一條路 —— 等於在**唯一必須感知資料庫種類**的端點上，親手鑿穿剛建立的雙軌抽換邊界 | 新增 `repositories/health.ts` 的 `pingDatabase()`（經 barrel），端點只呼叫它；連線失敗回 `{ okay: false }` 而非擲出。§2.2 R1 一併補列 Route Handler |
| **有實作、有單元測試，卻沒有任何任務要求呼叫**（第六輪發現）→ `logSecurityEvent` 的建立（T034）與單元測試（T032a）都在，但 login 失敗、限流拒絕、越權被擋三處都沒有「須呼叫它」的要求。函式在**從未被接上正式路徑**時，所有測試依然全綠 —— 這是本階段唯一無法由任何測試偵測的失效模式 | 於 §7.6 明訂三個必須呼叫的位置與事件類型，並以 DoD 14a 的原始碼稽核逐一核對（「該有的有」型稽核，與其餘各項的「不該有的沒有」互補） |
| **安全網本身也有漏洞**（第六輪發現）→ 誠實標示的全站掃描原樣式 `showToast(.*'success'…` 是**逐行**比對，而 `AuthorNovelList` 的狀態切換是**跨行**呼叫、且它是列舉唯一漏掉的假成功處。**列舉漏了它，補列舉之漏的掃描也漏了它** —— DoD 第 14 項會回報 0 而實際殘留 1 | 掃描改為只搜**呼叫名稱本身**（不附加訊息或參數條件），命中數變多是可接受的成本；同時把該控制項補進逐項清單。教訓：**掃描樣式若寫得太精確，它就退化成另一份列舉** |
| **登入次數撞上位址鍵限流**（第六輪發現）→ 位址鍵為 5 次/分鐘且計入所有送達請求。a11y 有 8 個受保護頁、逐頁檢查有 9 個，逐頁 `loginAs` 會在第 6 次起全被 429，取回的又是登入頁 —— **又退回第四輪修掉的「對同一份登入頁反覆驗證」**，只是換了個成因 | 兩處一律於 `beforeAll` **每個角色只登入一次並重用 Cookie**，或每次登入各用專屬 `X-Forwarded-For`；限流隔離規則的適用對象由「整合測試」擴為「所有以 HTTP 登入取得憑證的驗證活動」 |
| **同一段流程在兩份文件各有一個擁有者**（第六輪發現）→ `test:integration` 的「`db:generate` → `migrate deploy` → `db:seed` → `next build` → `next start` → 就緒偵測」被 contracts 寫成 **npm script 的內容**、被 tasks 寫成 **globalSetup 的內容**。照字面同時實作會建置兩次、啟兩個伺服器（第二個必然搶不到同一個埠） | 唯一擁有者定為 **globalSetup**，三個測試 script 各只有一行 `vitest run` |
| **「公開頁零成本」被誤讀為版面層也不得讀登入狀態** → 唯一的實作結果是把 `SessionProvider` 只掛受保護 layout，公開頁頁首全站失效 | 於 `arch.md` §7.1 與 DoD 第 20 項明文界定：零成本的適用對象只有攔截層；版面層對未登入者本就零查詢 |
| argon2 成本參數過高 → 拖垮 p95 < 1 秒的回應時間目標 | 參數集中為 `ARGON2_PARAMS` 具名常數，並以 ≥30 次實測取 p95 驗證；逼近上限即下調 `memoryCost` 後重測 |
| `@node-rs/argon2` 原生模組在部署平台不支援 | 退回 `bcrypt`（cost≥12），並於 README 記錄採用哪一個 |
| CSP 擋掉框架自身注入的內聯串流腳本 → 全站無法水合 | **建置期 hash 方案不可行**（腳本內容逐頁而異、無法窮舉）。改 **nonce + `'strict-dynamic'`**：nonce 由路由攔截層逐請求產生，theme script 與 GA4 共用同一個。代價是受影響頁面改動態產生，以快取策略（§2.5）彌補 |
| CSP 擋掉 GA4 或 theme script | 兩者皆由同一個請求範圍的 nonce 允許，避免手動同步失誤。**直接上強制模式**，違規須在本機與整合測試階段清零，不以 Report-Only 過渡。**衝突一律改功能實作或改腳本允許方式，`script-src` 不得放寬**（`style-src 'unsafe-inline'` 為唯一既有例外） |
| 帳號鍵限流可被惡意觸發（攻擊者刻意鎖他人帳號 15 分鐘） | 刻意取捨：相較分散式撞庫成功，短暫拒絕服務損害較低；該帳號成功登入即重置計數 |
| 開發機未安裝 Docker，取不到 PostgreSQL 執行個體 | `docker-compose.yml` 為唯一前置需求，README 明列；無 Docker 時 sqlite 軌仍可完整開發，僅雙軌驗收需補跑 |
| 記憶體限流在多執行個體／serverless 下形同虛設（各實例各持一份計數，輪流打即繞過） | **明示而非默許**：啟動記錄輸出 `rateLimitMode=single-instance`、`/api/health` 密鑰回應一併回報、README 將多執行個體部署標為**本階段未支援**。換共享儲存屬 FEAT-4 |
| 整合測試每輪多一次 `next build`，CI 時間拉長 | 本階段僅 10 案 × 2 provider，可接受。若日後成為瓶頸，改為建置一次後兩種 provider 共用同一產物（僅換連線環境變數） |
| 重置 migration 歷史會刪掉開發者本機的 `dev.db` 內容 | 內容全由 `seed.ts` 產生（本就先 `deleteMany` 再寫入），重建即還原。**唯一實質改變的是使用者列**（明碼 → 三個 hash 帳號），此為本階段目的 |
| 攔截層改為全站作用，每個頁面請求多一段程式碼 | 公開頁只做 nonce 產生（無 I/O、無驗簽），守衛分支僅在受保護前綴執行；靜態資源與圖片以 matcher 排除，不付攔截成本 |
| 真實使用者忘記密碼即無法救援 | 以**事先告知**處理（登入頁 + 註冊送出前），不做假的「忘記密碼」入口。郵件基礎設施就位後解除 |
| Cookie `maxAge` 誤取閒置期限 → 滑動延展與 90 天絕對上限在瀏覽器端形同虛設（活躍使用者第 30 天被登出） | 屬性集中為 `SESSION_COOKIE` 常數、`maxAge` 取絕對上限 × 86400，並以單元測試斷言其值；DoD 第 21 項另以 `curl` 檢視 `Set-Cookie` 覆核 |
| p95 量測撞上註冊／登入限流 → 被 429 的請求不跑雜湊，數值偏樂觀 | 量測沿用整合測試的隔離手法（`TRUSTED_PROXY_HOPS=1` + 每請求專屬位址 + 足量帳號），**不得**為量測調高門檻或停用限流 |
| 需要真實瀏覽器的驗證被硬寫成整合測試 → 得到一個恆綠但驗不到目標的測試 | 明列四項只能人工驗（註冊計時、`localStorage` 竄改、主控台違規與無閃爍、停用 Cookie 的提示），整合測試只驗其 HTTP 層等價命題；Playwright 於 **FEAT-3** 導入（2026-07-30 修訂，原寫 FEAT-4） |

---

## FEAT-2　資料模型重構與真實內容

> **一句話**：讓資料庫裡真的有小說。
> **對應 arch.md**：§4（資料模型全文）、§3.4（mapper 分歧點）、§7.3（H-3）、§9 Phase 10
> **相依**：FEAT-1（雙軌基礎建設必須先在位，migration 才會雙份產生）
> **狀態**：✅ **已完成（2026-07-29）**。規格與任務見 `specs/002-data-model-real-content/`（45 個任務全數完成）。
> 三刀各自獨立 migration 與獨立提交：2-A 關聯化（零 UI diff）→ 2-B 真實正文與付費殘留清除 → 2-C 作者資料統一。
> 兩軌各 4 份 migration（`init` / `2a_relational_model` / `2b_chapter_content` / `2c_author_ownership`）。
> 收尾數據：13 部 / 15 卷 / **96 章真實正文**（`prisma/seed-data/*.md`）＋ 1 章草稿；
> 測試 unit 50 / integration 91 / a11y 15，SQLite 與 PostgreSQL 兩軌結果一致。

### 為什麼需要

`arch.md` §1.1 的實測結論：`Chapter` model 沒有任何內容欄位，閱讀頁的「正文」是 `generateChapterParagraphs()` 依章節編號拼出來的假段落。**這是「完整小說網站」最大的結構缺口** —— 在補上之前，其餘功能都建立在空殼上。

同時 `AuthorNovel` / `AuthorChapterDraft` 與公開 `Novel` 欄位重複且**無 owner 外鍵**，使「越權編輯他人作品」在資料模型層無從防範（E-1）。

### 範圍（分三刀，各自獨立 migration，每刀合併後網站仍可跑）

**2-A 關聯化（不碰內容）**

| 工作 | arch 項目 | 說明 |
|------|-----------|------|
| `Novel.author`（字串）→ `Novel.authorId` FK → `User` | **E-1** | 資料層防越權的根本手段 |
| `Novel.category`（label 字串）→ `categoryId` FK → `Category` | §4.3 | mapper 輸出 label，UI 不變 |
| `tags`（CSV）→ `Tag` + `NovelTag` join table | **E-2** | **不用 PostgreSQL 專屬 `String[]`**，雙軌相容 |
| `relatedIds`（CSV）→ `NovelRelation` | **E-2** | 同上 |
| `publishedAt` 等日期 ISO 字串 → 原生 `DateTime` | **E-2** | SQLite 亦原生支援 |
| `mappers.ts` 移除 `splitCsv` / `joinCsv` | §3.4 | |
| 移除冗餘欄位 `isNew`（改由 `publishedAt` 近 30 天推導）、`latestChapterId`、`firstChapterId` | §4.3 | 避免資料腐化 |

> **驗收關鍵**：領域型別 `src/lib/types.ts` 的 `Novel.author` / `tags` 對外不變 → **`src/app/` 與 `src/components/` 的 diff 應為零**。若不為零，代表 repository 邊界漏了（違反鐵律 R1）。

**2-B 真實正文 + 移除付費殘留**

| 工作 | arch 項目 | 說明 |
|------|-----------|------|
| 新增 `ChapterContent`（`chapterId` 1:1、`bodyMarkdown`、`format`） | **N-1** | 分表避免章節列表查詢拖入大文字欄位 |
| `prisma/seed-data/` 建立：每部作品一資料夾，章節正文以 `.md` 存放 | **N-1**、§4.4 | 既有約 13 部人工精簡示範正文。**3 部真實小說（天啟/聽雨風雲錄/社區醫館）不納入本階段**（2026-07-24 裁示）：`.md` 留 `novels/novel/*/正文/` 原位供手動測試，seed 當作不存在 |
| `seed.ts` 重寫：User(hash) → Category → Novel → Volume → Chapter + ChapterContent → Review(綁真實 user) | §4.4 | |
| `getChapterContext()` 改讀 `ChapterContent`，**廢除 `generateChapterParagraphs()`** | **N-1** | `src/lib/content.ts:15` |
| **刪除 `Chapter.isFree`** 欄位、型別、Reader 鎖頭 UI 與 `Lock` icon import | **H-3** | `prisma/base.prisma`、`src/lib/types.ts:32`、`src/components/reader/ReaderView.tsx:200-202` |
| **移除 `/author/earn` 收益金額語意**，改為非金額「作品成效」（沿用既有欄位）；側欄／頁尾「作者收益」導覽改「作品成效」；`/about` 頁「透明的收益機制」金額措辭一併移除（H-3 解除第三項，對齊 §7.3；完整成效指標延 FEAT-4 N-8） | **H-3** | `src/app/author/earn/page.tsx`、`src/components/author/AuthorSidebar.tsx`、`src/components/layout/SiteFooter.tsx`、`src/app/about/page.tsx` |
| 新增 `chapters` repository | E-3 | `src/lib/repositories/chapters.ts` |

**2-C 作者資料統一**

| 工作 | arch 項目 | 說明 |
|------|-----------|------|
| **刪除** `AuthorNovel` / `AuthorChapterDraft` 兩表 | **N-2** | 欄位與 `Novel`/`Chapter` 重複 |
| 改以 `Novel.status`（draft\|published，原連載狀態欄位更名 `serialStatus`）+ `Chapter.status` + `authorId` 表達 | **N-2** | 發佈狀態與連載狀態語意分離（arch.md §4） |
| `authors.ts` repository 改寫：**所有查詢強制帶 `where: { authorId }`** | **E-1** | 即使 service 忘記檢查，資料層仍查不到他人作品 |
| 作者後台頁面改讀新 repository | **N-2** | `src/app/author/**`、`src/components/author/**` |

### 完成定義

1. ✅ 閱讀頁顯示的是 **DB `ChapterContent` 內的真實正文**（改 DB 內容 → 重整頁面即變）—— `tests/integration/reader-content.test.ts`
2. ✅ `grep -rn --exclude-dir=migrations "isFree\|generateChapterParagraphs\|AuthorNovel\|AuthorChapterDraft" src prisma` **無結果**（排除 `prisma/migrations/` 歷史 DDL）
3. ✅ 2-A 合併時，`src/app/` 與 `src/components/` 的 diff 為零
4. ✅ `DATABASE_PROVIDER` 兩種值皆能 `migrate` + `seed` + `build`，且整合測試兩軌各 91 案全綠
5. ✅ 刪除一部作品 → 其 Volume / Chapter / ChapterContent / Review / RankingEntry（含標籤、相關作品關聯）級聯刪除，無孤兒列 —— `tests/integration/cascade-delete.test.ts`
6. ✅ `authors.ts` 內每個查詢函式的簽章都要求 `authorId` 參數（型別層強制）—— `tests/integration/author-ownership.test-d.ts` 以 `@ts-expect-error` 使綠燈閘門持續稽核
7. ✅ `/author/earn` 與 `/about` 全頁無 `NT$`／收益／分潤／打賞字樣（H-3 殘留第三項移除，改為非金額「作品成效」）

> **交付時的兩項偏離（皆已記錄於 `specs/002-data-model-real-content/tasks.md`）**：
> (a) `contracts/internal-modules.md` §4 的原訂函式名內含已刪除實體的識別碼，會使第 2 項的 grep 命中，
> 故語意不變、字面改為 `getAuthorDraftChapters` / `getAuthorDraftChapter`；`AuthorNovelList` 元件同理更名為 `AuthorWorkList`。
> (b) 示範資料的字數改由實際正文推導後大幅縮水（`featured-1` 由 320 萬字降為 4,879 字），屬 FR-011a 的裁示接受結果。

### 測試

- **單元**：`mappers`（DateTime→ISO 字串、NovelTag→`string[]`、`penName ?? name` 遞補）
- **整合**：`arch.md` §10.3 案例 10、11（**未登入訪客 GET 已發佈章節 → 200 且回傳完整正文**，驗證全免費定位）、18
- **回歸**：既有 26 個頁面全部可正常渲染（可用簡易 smoke test 逐一 fetch 檢查 200）

### 風險

| 風險 | 對策 |
|------|------|
| 三刀合一造成 big-bang，壞了無法二分定位 | **嚴格分三個 PR**，每刀獨立 migration 與獨立驗收 |
| 章節正文內容從何而來 | 示範作品（約 13 部）一律以人工精簡示範正文（`prisma/seed-data/*.md`）填充。`novels/novel/` 的 3 部真實小說**不納入本階段**（2026-07-24 裁示，移出 seed／清單），保留原位供使用者手動測試（含每章 ≥1000 字排版與效能觀察） |
| 現有 seed 資料（13 Novel / 60 Chapter）語意大改 | 採 **重建（rebuild）而非增量遷移**（`arch.md` §4.4），dev 資料本就是展示用假資料 |

---

## FEAT-3　創作流與搜尋

> **一句話**：作者真的能寫，讀者真的搜得到。**這是產品的真正上線點。**
> **對應 arch.md**：§5.5（作者 Action）、§5.6（個人設定）、§3.4（搜尋分歧點）、§7.4（M-2）、§9 Phase 11（作者部分）
> **相依**：FEAT-2
> **規格與任務**：`specs/003-authoring-flow-search/`（spec / plan / research / data-model / contracts / tasks，共 **113 個任務**）
>
> **範圍調整（2026-07-30，24 條 Clarifications 裁示 + `/speckit-analyze`）** —— 下列各項與本文件原稿或 `arch.md` 原表述不同，兩份文件已同步修訂：
>
> 1. **搜尋語意改為子字串比對，不用 `tsvector`**：`to_tsvector('simple', …)` 不切中文詞，無空白的中文標題會成為單一 token，搜「劍」無法命中「劍影行紀」，而 SQLite 的 `LIKE '%劍%'` 會命中 —— 兩軌保留不同比對語意，「結果完全一致」即無從成立。改為 SQLite `LIKE` / PostgreSQL `ILIKE` + `pg_trgm` GIN，排序改用確定性鍵（`updatedAt DESC, id ASC`），不用相關度分數
> 2. **E2E 框架前移至本階段**：只交付**作者流一條**，其餘三條（讀者流、越權流、無障礙）仍屬 FEAT-4。原「Playwright 屬 FEAT-4／Phase 13」的表述已修訂
> 3. **排程發佈延後至 FEAT-4**：不新增 `Chapter.scheduledAt`、不做排程 UI、`publishChapterAction` 不接受排程時間 —— 沒有 cron 的排程等於「設定了但永遠不會發佈」，屬共通完成準則明文禁止的半殘狀態
> 4. **新增作品管理頁 `/author/novels/{novelId}`**：原稿的 Action 清單無處可放 —— 既有作品列表無進入單一作品的連結、章節編輯器只能開已存在的章節、全站無分卷 UI。本階段新增頁面數為 1
> 5. **`sitemap.ts` 動態產生與 `<SafeMarkdown>` 自 FEAT-4 前移**：本階段是第一個會產生草稿作品的階段，網站地圖不動態化即在上線點把草稿送進搜尋引擎；正文一開始寫就進 DB，淨化不能晚於寫入路徑開通
> 6. **schema 增量四處**：`Novel.searchText`、**`Novel.updatedAt`**（搜尋主排序鍵，`publishedAt` 是上架時間、承載不了此語意）、`User.bio` 新增並移除 `Novel.authorBio`（採**重建**而非資料遷移）、`Volume @@unique([novelId, number])`
> 7. **編號一律系統指派**：卷與章節編號皆為「目前最大編號 +1」，作者不可編輯；409 只在**併發**建立時由唯一性約束產生
> 8. **非擁有者一律 404**：`arch.md` §5.5 原表的 `403` 已全面改為 `404`（不洩漏資源存在性）；`403` 只保留給角色不足
> 9. **速率限制只擴及改密碼與開通作者**：作品與章節寫入不限流（已受工作階段與擁有者守衛保護）

### 為什麼

`nextstep.md` 指出：新增作品（`CreateNovelForm.tsx:49`）、發佈章節（`ChapterEditor.tsx:57-60`）、改個資（`AccountSettingsView.tsx:19`）**全都只 `showToast` 或 `setState`，不觸及資料庫**。UI 已完備，缺的只是後端 —— 這是投入產出比最高的一段。

### 範圍

**3-A 搜尋（可與 3-B 並行，只依賴 FEAT-2）**

| 工作 | arch 項目 | 檔案 |
|------|-----------|------|
| `Novel.searchText` 預算欄位（寫入時由 service 組 `title + penName + category + tags` 正規化小寫，**上限 512 字元**） | **M-4** | `prisma/base.prisma`、`services/searchService.ts` |
| **`Novel.updatedAt`**（搜尋主排序鍵，**由 service 明確賦值、不用 `@updatedAt`**）+ `@@index([status, updatedAt])` | **M-4** | `prisma/base.prisma` |
| SQLite 實作：`LIKE ? ESCAPE '\'` + `@@index([searchText])` | **M-4** | `src/lib/repositories/search.ts` |
| PostgreSQL 實作：`ILIKE ? ESCAPE '\'` + **`pg_trgm` GIN**（擴充與索引皆以手寫 migration SQL 建立）。**不用 `tsvector`／`ts_rank`** | **M-4** | 同上 + `migrations/postgres/` |
| 查詢字串於服務層 `normalize()`（trim → 轉小寫 → 空白收斂）後才進資料存取層 —— 否則兩軌對非 ASCII 的大小寫折疊不一致 | **M-4** | `services/searchService.ts` |
| `GET /api/search`（`?q=&category=&cursor=&limit=`；`?suggest=1` typeahead） | §5.3 | `src/app/api/search/route.ts` |
| **搜尋頁改為消費該端點**：「載入更多」游標分頁（每頁 20）、分類單選篩選（狀態寫入網址 `?q=&category=`） | 6.1 | `src/components/search/SearchView.tsx` |
| **即時建議 UI**：2 字元觸發、300ms 防抖、上限 8 筆、選取後導向 `/novels/{id}`；combobox 無障礙屬性與鍵盤操作 | §5.3 | 同上 |
| 廢除舊 `searchNovels()` 的全表載入記憶體過濾 | **M-4** | `src/lib/repositories/novels.ts:83-96` |

**3-B 作者寫入流**

| 工作 | arch 項目 | 檔案 |
|------|-----------|------|
| **schema**：`User.bio` 新增、**移除 `Novel.authorBio`**（作者簡介的單一真相來源改為使用者，採**重建**：migration 只做結構變更，內容由重跑 seed 還原）、`Volume @@unique([novelId, number])` | §4.2 | `prisma/base.prisma`、`prisma/seed.ts` |
| `novelService` / `chapterService` / **`userService`**（業務規則、權限、Zod、交易編排、快取失效） | §2.1 | `src/lib/services/` |
| `requireOwner(session, novelId)` 落地 —— **非擁有者與不存在回完全相同的 404** | **E-1** | `src/lib/auth/guard.ts` |
| Server Actions（作品 4）：`createNovelAction`、`updateNovelAction`、`publishNovelAction`、`deleteNovelAction` | §5.5 | `src/app/author/actions.ts` |
| Server Actions（卷 3）：`createVolumeAction`、`updateVolumeAction`、**`deleteVolumeAction`（僅空卷可刪）** | §5.5 | 同上 |
| Server Actions（章節 6）：**`createChapterAction`**、`saveChapterDraftAction`、`publishChapterAction`、**`unpublishChapterAction`（章節下架）**、`reorderChaptersAction`（**限單一卷內**，單一交易重寫整批編號並避開唯一約束的中間狀態）、`deleteChapterAction` | §5.5 | 同上 |
| **十三個 Action 每一個自驗身分與角色**（順序：身分 401 → 角色 403 → 擁有權 404），不得依賴 `proxy.ts` 的 matcher | §7.1 | 同上 |
| **作品管理頁 `/author/novels/{novelId}`**：作品資訊編輯、卷管理、章節列表、卷內排序、新增章節入口、上下架、刪除 | §5.5 | 新增 `src/app/author/novels/[novelId]/page.tsx`、`components/author/NovelManageView.tsx` |
| `CreateNovelForm` 接真實 action（移除 `setSubmitted(true)` 假流程）；**欄位維持標題／分類／簡介三項**，`coverColor` 由系統自色票組指派，標籤與封面色改於管理頁編輯 | 6.2 | `src/components/author/CreateNovelForm.tsx:49` |
| **標籤只能自既有集合多選**（不提供新建入口，免去中文 slug 生成規則），寫入端核對 `tagIds` 皆存在 | §4.2 | `services/novelService.ts`、`NovelManageView.tsx` |
| `ChapterEditor` 接真實 action，寫入 `ChapterContent`（移除 `showToast` 假流程）；**控制項依章節狀態切換**：草稿→「儲存草稿／發佈」、已發佈→「儲存／下架此章」；「返回作品管理」改指向管理頁 | 6.2 | `src/components/author/ChapterEditor.tsx:57-60` |
| `AuthorWorkList` 的連載狀態切換接真實寫入（FEAT-1 因其為假成功而停用）、作品項目連至管理頁 | 6.2 | `src/components/author/AuthorWorkList.tsx` |
| **刪除的前端確認**：刪除作品須於對話框內輸入作品標題方可送出並明示級聯範圍；刪除章節與卷只需單層確認 | 6.2 | `NovelManageView.tsx` |
| `<SafeMarkdown>` 共用元件：`rehype-sanitize`、**禁 `rehype-raw`**；編輯器預覽與讀者端共用同一元件 | **M-2** | 新增 `src/components/ui/SafeMarkdown.tsx` |
| ESLint 規則禁止 import `rehype-raw` | **M-2** | `eslint.config.mjs` |
| 寫入端長度與控制字元過濾（單章 ≤100,000 字元） | **M-2** | `services/chapterService.ts` |
| **分欄長度上限**（標題 ≤100／作品簡介 ≤2000／卷標題 ≤100／章節標題 ≤200／暱稱 ≤50／筆名 ≤50／使用者簡介 ≤500，trim 後計算）；必填者為前五項與**開通作者時**的筆名，**使用者簡介與更新個資時的筆名為選填** | §5.1 | `src/lib/validation/*` |
| **閱讀頁改以 `<SafeMarkdown>` 渲染**（`ChapterContext.paragraphs` → `bodyMarkdown`，移除 `splitParagraphs()`）；既有閱讀排版參數與偏好**不得退化** | **M-2** | `src/components/reader/ReaderView.tsx` |
| 個人設定 Actions：`updateProfileAction`、`changePasswordAction`（接上 FEAT-1 已實作的伺服器端改密碼函式）、`becomeAuthorAction`（改寫 `role`，**必須一併撤銷該使用者全部 session** —— 否則舊憑證的 `role` 快照仍是 `reader`，見 arch §7.1；**並為當前裝置立即補發**帶新角色快照的憑證，使用者無須重新登入）、`revokeSessionsAction`；一併解除 FEAT-1 的「功能開發中」停用狀態。**改密碼與開通作者的告知文案不得混用**（前者連本裝置一起登出，後者不必） | §5.6 | `src/app/profile/actions.ts`、`AccountSettingsView.tsx:19` |
| **筆名異動 → 個資更新與該作者全部作品的 `searchText` 重算於同一交易**（先提交再重算會留下「筆名已改但舊筆名仍搜得到」的靜默不一致） | §5.6 | `services/userService.ts` |
| **改密碼與開通作者的速率限制**：以使用者識別碼為鍵，`PASSWORD_CHANGE_RATE_MAX`（預設 5）／`AUTHOR_UPGRADE_RATE_MAX`（預設 3），時間窗沿用 FEAT-1 登入窗 | §7.6 | `src/lib/env.ts`、`services/userService.ts` |
| 快取失效輔助（tag：`novel:{id}`、`novels:list`、`chapter:{id}`）。API 已結案：**`revalidateTag(tag, 'max')`**（單引數形式已 deprecated、`updateTag` 只能在 Action 內呼叫）。**目前站上尚無任何已標記的快取項目，故三個失效呼叫實為 no-op**——介面與呼叫點先就位 | §2.5 | 新增 `src/lib/cache.ts` |
| `sitemap.ts` 改為依 DB 動態產生已發佈作品；`getAllNovels()` 補上 `status` 條件（既有落差，本階段是第一次會產生草稿作品的階段） | 6.3 | `src/app/sitemap.ts`、`repositories/novels.ts` |
| **端對端測試框架導入**（僅作者流一條、僅 SQLite 軌、僅 chromium，以正式建置產物與獨立 `e2e.db` 執行） | **N-7** | 新增 `playwright.config.ts`、`tests/e2e/author-flow.spec.ts` |

### 新增依賴

`rehype-sanitize`、`@playwright/test`（devDependency）

### 交付後的已知行為（2026-07-31，postgres 軌驗證項已於同日移除）

> 以下兩項**不是缺陷清單，是使用者或維運者看得到、但從畫面上看不出原因的行為**。
> 不寫下來的話，第一個撞上的人會把它當成資料遺失或環境壞掉來回報。

1. **章節正文中的原始 HTML 會整段消失（非逸出顯示）**：`<SafeMarkdown>` 未啟用
   `rehype-raw`，`react-markdown` 在此設定下**直接丟棄**原始 HTML 節點 —— 不是逸出成純文字，
   是連文字都不留。安全性上強於憲章要求（`markdown-sanitize.test.ts` 已記錄並驗證此行為），
   但作者在章節裡寫 `<div>` 或 `<br>`，儲存後預覽與讀者端都會看不到那一段。
   Markdown 語法（`**粗體**`、清單、連結等）不受影響。
2. **`User.avatarColor` 的資料庫預設值不在頭像色票組內**：兩者畫出來一樣、字串不同，
   故新註冊使用者在設定頁看到的是「一個色票都沒選」，並附一行說明。
   不選即維持原樣，不影響其餘欄位的儲存。

> **PostgreSQL 軌的 `3a_search` migration 與 `pg_trgm` GIN 已於 2026-07-31（Docker 恢復
> 可用後）實際套用並驗證**：`novelsite_dev`／`novelsite_test` 皆已套用該筆 migration，
> `pg_trgm` 擴充與 `Novel_searchText_trgm_idx` 皆已確認存在，`DATABASE_PROVIDER=postgresql`
> 整合測試 37 檔 290 案例全綠，與 SQLite 軌檔數／案例數完全相同。SC-005「兩軌結果完全
> 一致」與 SC-006 已在兩軌驗證，原先列於本節的第 3 項待外部條件自本次起移除。

### 完成定義

1. 全新帳號 → 開通作者 → 建立作品 → 撰寫並發佈第 1 章 → **另一個瀏覽器 context 的訪客能讀到該章正文**
2. 作者 A 以作者 B 的 `novelId` 呼叫**全部十二種**受擁有者守衛的寫入（作品 3 + 卷 3 + 章節 6）→ 一律 **404**（不洩漏存在性），DB 未變更；同一組操作對**不存在**的識別碼得到**完全相同**的回應。`reader` 角色呼叫同一組 → 一律遭伺服器端拒絕
3. 章節 Markdown 內含 `<script>alert(1)</script>` → **讀者端與編輯器預覽兩處**皆渲染為純文字，DOM 內無 `<script>`
4. 搜尋 `?q=` 空字串 → 回空陣列且**不做全表掃描**（以查詢計數驗證）
5. 搜尋詞含 `%`、`_`、`'` → 正常回應不報錯；大小寫混雜時兩種 provider 的結果**內容與排序完全一致**
6. **併發**建立章節時兩者取得同一個「最大編號 +1」→ 其一成功、另一回 409 `CONFLICT`（編號由系統指派，作者無從手動製造衝突）；卷編號同理
7. 作品下架後：詳情頁與章節閱讀頁 404，且自書庫列表、搜尋結果與網站地圖消失
8. 開通作者後**其他裝置的舊憑證失效、當前裝置無須重新登入**即可進入 `/author/*`；改密碼後**含當前裝置**全部失效
9. 閱讀頁改 Markdown 渲染後，字級／行高／主題／無干擾模式／段距**皆不退化**

### 測試

- **單元**：`escapeLikePattern`、`search` provider dispatch、`normalize`／`buildSearchText`、`validation/{novel,chapter,profile}`、`chapterService` 字數計算與長度上限、`env` 的兩個限流變數
- **整合**：`arch.md` §10.3 案例 7、12、15、16、17、20，另補 Server Action 的跨站 Origin、角色守衛、卷與排序邊界、下架與計數回填、游標分頁、分類篩選、搜尋預算同步、開通作者補發憑證、登出所有裝置、限流 429
- **a11y**：新增的 `/author/novels/[novelId]` 與修改的 `/author/create`、`/author/editor/[chapterId]`、`/author/novels`、`/profile/settings`、`/search`（combobox）、閱讀頁，保留 FEAT-1 的反向驗證
- **E2E**：作者流一條（登入 → 開通作者 → 建作品 → 發佈章節 → 訪客讀到）

### 風險

| 風險 | 對策 |
|------|------|
| Server Action 錯誤處理慣例與訓練資料不同 | 實作前查 `node_modules/next/dist/docs/`（`arch.md` 附錄 B 第 3 項），同時確認內建 CSRF 保護程度，決定 §7.6 的 Origin 檢查是否仍需自寫 |
| PostgreSQL GIN 索引需手寫 SQL，migration 易漏 | 雙軌整合測試強制跑案例 15、16，兩 provider 結果須一致 |
| 編輯器預覽與讀者端 sanitize 設定漂移 | 強制共用 `<SafeMarkdown>` 單一元件 + ESLint 規則把關 |
| **兩軌大小寫折疊只在 ASCII 一致** | 查詢字串於服務層統一轉小寫後才進資料存取層；整合測試補一組**非 ASCII** 大小寫案例（ASCII 案例無法區分兩種實作） |
| **3-A 與 3-B 獨立 PR，`searchText` 重算是唯一接縫** | 3-B 先合併時該步只能是 no-op，其驗收獨立為一個匯流任務，**不得以 no-op 通過**（憲章第 IV 條）；DoD 須列為「待 3-A 合併後驗收」 |
| **既有卷資料若已有同作品內重複編號，唯一約束套用即失敗** | migration 前先對兩軌執行重複檢查 |

---

## FEAT-4　讀者互動與數據

> **一句話**：把讀者的行為留下來，並讓數字變成真的。
> **對應 arch.md**：§5.4（讀者互動 API）、§5.7（cron）、§9 Phase 11（讀者部分）／Phase 12／Phase 13
> **相依**：FEAT-3
> **規格**：`specs/004-reader-interaction-stats/`（spec / checklists）
>
> **範圍調整（2026-07-31，8 條 Clarifications 裁示）** —— 下列各項與本文件原稿或 `arch.md` 原表述不同，
> 兩份文件已同步修訂。其中第 4、5 項是**照原文實作不下去的落差**，非偏好選擇：
>
> 1. **排程作業的觸發**：交付受 cron secret 保護的三個入口，另加**版控的觸發指令**（本機／CI／任何外部排程器皆可呼叫），
>    文件載明如何接上部署平台排程。**不繫結任何雲端廠商**，亦**不在應用程式行程內跑常駐排程器**
>    （與 serverless 形態不相容，多執行個體會重複執行）。缺此則「沒有 cron 的排程等於永遠不會發佈」原地重演。
>    **2026-08-08 部署選型裁示**：括號內原文「部署目標未定案」**已失效並刪除** ——
>    目標已定為 Oracle Cloud 單機 + 系統 crontab（見 `deploy/deployment.md`）。
>    **「不繫結任何雲端廠商」不隨之解除**：選 crontab 正是因為它是作業系統層機制、
>    換任何一台 Linux 機器都能照搬；改用 Oracle 自家排程服務即違反本條
> 2. **通知只做追更一種**：`Notification.type` 的其餘三種（`review_reply`／`comment_reply`／`system`）保留欄位但本階段
>    **不產生** —— 回覆類需另定自我回覆排除、樓中樓多層的通知對象與去重規則；系統公告需要一個目前不存在的管理端入口
> 3. **上線硬化依外部條件切分**：Lighthouse 以本機無頭瀏覽器實測並記錄分數、跨瀏覽器以自動化測試在三種引擎跑讀者流；
>    **真實行動裝置實機測試、正式環境 PostgreSQL 部署驗證與部署平台排程設定三項標為「待外部條件」，MUST NOT 標記為已完成**（憲章第 IV 條）。
>    PostgreSQL 的結構與索引正確性已由 FEAT-3 的雙軌整合測試涵蓋。
>    **判準為「能否於本機自動完成」**（2026-08-07 補明）：`npx playwright install firefox webkit` 可以，故它是**前置安裝步驟**而非待外部條件 ——
>    列為後者會與本項前半「跨瀏覽器以自動化測試在三種引擎跑讀者流」的**通過**要求直接抵銷
> 4. **書架合併採聯集，不比較新舊**：本機書架的儲存格式是純作品識別碼陣列（`["id1","id2"]`）、**不帶任何時間戳**，
>    原「登入後合併上傳」若照「時間較新者勝」實作**根本無從判定**。改為：書架取聯集（雙方皆有者保留雲端既有的收藏時間），
>    **「時間較新者勝」只適用於帶時間戳的閱讀歷史與閱讀進度**
> 5. **閱讀偏好只同步字級與主題**：`arch.md` §4.2 原模型為數值字級（14/18/22）＋行高＋主題，但現況是本機字級為
>    `sm`/`md`/`lg`、主題由另一個全站 Hook 管理、**行高全站沒有任何控制項**。改為只同步字級與主題並沿用現有值域；
>    **不新增行高**（同步一個使用者調不到的值等於憑空多做一個控制項）、**不同步無干擾模式**（現行明訂不跨章節記憶）
> 6. **每日統計為「當日新增量」而非累計快照**：閱讀＝當日去重次數、收藏＝當日**淨增**數、留言＝當日新增數。
>    排行取近 N 日**加總**，若存累計快照則相加會把同一批收藏重複計 N 次，名次驗證無從成立
> 7. **每日統計以 Asia/Taipei（UTC+8）切日**：`arch.md` §4.2 原註「當日 00:00 UTC」，但以 UTC 切日時儀表板上的
>    「7/31」實為台北 7/31 08:00～8/1 08:00，流量最高的深夜時段被切到隔天，作者看到的曲線與其認知永遠差一個上午
> 8. **同批排程發佈的通知合併為一則**：同一作品在**同一次排程作業執行**中發佈多章時，每位收藏者只收到一則
>    （含新增章節數與最新章名）；立即發佈則每次各一則。否則作者把 5 章排在同一時間，通知中心上線第一天就被洗版
> 9. **示範資料的統計與互動全數歸零**：seed **不再寫入**任何無明細支撐的統計（作品的評分／閱讀／收藏／留言計數一律 0），
>    且**不建立** `Review`／`Bookshelf`／`ChapterView`／`NovelDailyStat`／`RankingEntry`；`mockData.ts` 的三組手寫排行常數刪除。
>    理由：這些數字背後沒有任何明細，保留即使「儀表板每個數字可由 DB 反推」在示範資料上永遠不成立。
>    **連帶後果已接受**：排行榜頁、首頁排行區塊、儀表板、成效頁與**作品詳情頁評論區**皆為空狀態 ——
>    空狀態因此是示範環境的**主要路徑**，MUST 設計完整、納入 a11y 檢查、不得破圖；熱門排序在計數全 0 時
>    MUST 有確定性 tie-break（`updatedAt DESC, id ASC`）

### 為什麼

書架、閱讀歷史、閱讀偏好目前全部只存 `localStorage`（`useBookshelf` / `useReadingHistory` / `useReaderPrefs`），換裝置即遺失；`Review` 無 user 外鍵、無寫入路徑；排行榜是 30 筆靜態 seed；作者儀表板的數字來自 `getAuthorDailyStats()` 的公式造假。

### 範圍

**4-A 讀者狀態上雲** — ✅ **已完成（2026-08-07，`tasks.md` T009～T046）**

> 執行紀錄：五張表與兩軌 `4a_reader_state` migration 落地；六個 Route Handler
> （書架 `GET`／`POST`／`DELETE`、進度 `PUT`／`GET`、歷史 `GET`／`DELETE`、偏好 `GET`／`PUT`、
> 合併 `POST`）全部先過 `assertSameOrigin` 再驗身分；五支既有 Hook 改為「登入走 API、
> 未登入沿用 `localStorage`」且對外形狀不變，另新增 `useReaderStateMerge` 與 `useProgressReporter`；
> 四處「僅存本機」標示與 `SEED_READING_HISTORY` 已移除。
> 三道綠燈閘門全過，unit 245 案／integration 339 案／a11y 29 案全綠。
> **postgres 軌的 migration 以離線 `prisma migrate diff` 產生**（產生當下本機無 PostgreSQL 服務）。
> **2026-08-08 補驗**：已啟動本機 Docker 容器（`postgres:17-alpine`），對 `novelsite_test`
> 實際 `migrate deploy` 套用 `4a_reader_state`／`4b_interaction`／`4c_analytics` 三支 migration **全部成功**，
> 並以 `DATABASE_PROVIDER=postgresql npm run test:integration` 跑出 **58 檔 480 案全綠**（與 SQLite 軌同檔同案數）。
> 原文「實際 `migrate deploy` 的驗證仍屬 R-18」**已失效並取代**：R-18 的第二項是「**正式環境**的 PostgreSQL 部署驗證」，
> 本機容器不是正式環境、不能拿來勾銷該項，但「離線產生的 DDL 在 PostgreSQL 上能否執行」已不再是未知數。

| 工作 | arch 項目 | 檔案 |
|------|-----------|------|
| **五張表**：`Bookshelf`、**`BookshelfEvent`**、`ReadingProgress`、`ReadingHistory`、`ReaderPreference`（**`ReaderPreference` 只含字級 `sm`/`md`/`lg` 與主題 `light`/`dark`/`eyecare`，不含行高** —— 見範圍調整第 5 項）。五張表同屬 `4a_reader_state` 一個 migration | **N-3** | `prisma/base.prisma` |
| API：書架 `GET/POST/DELETE`、進度 `GET/PUT`、歷史 `GET/DELETE`、偏好 **`GET/PUT`** | §5.4 | `src/app/api/{bookshelf,reading-progress,history,reader-preference}/**` |
| **偏好的 `GET` 與書架的 `?view=ids`（FEAT-4 實作裁示 2026-08-07 新增兩個端點形態）**。**偏好 `GET`**：字級與主題分屬 `useReaderPrefs` 與 `useTheme` 兩個 Hook，兩者在登入態都要把伺服器值讀回來當離線快取；只有 `PUT` 的話 `theme` 有寫入端而無消費端，US1 AC6 與 SC-001 的主題部分恆假。**書架 `?view=ids`**：`useBookshelf` 要回答「**這一部**在不在書架」，游標分頁答不了——收藏 500 部的人每開一個詳情頁得打 25 次請求，而 spec Assumptions 要求 Hook 對外形狀不變 | §5.4 | `src/app/api/reader-preference/route.ts`、`src/app/api/bookshelf/route.ts` |
| **資料量上限（皆為可調整預設值）**：合併每類 **200 筆**（超出保留最近者並告知）、雲端閱讀歷史每人 **500 部作品**（自動淘汰最久未讀）、通知保留 **90 天**／列表每頁 **20 筆**。**三個保留期的清理一律由每日彙總作業執行**（`ChapterView` 與 `BookshelfEvent` 依明細保留期、`Notification` 依 90 天），且 MUST 於回應中**逐一回報刪除筆數**（FEAT-4 裁示 2026-08-07：原文只給了數值而未指定執行者，`Notification` 的清理因此只有函式、沒有呼叫端，通知表會無上限成長；清理是無聲的破壞性動作，不回報則保留期設錯時沒有任何人看得出來） | §5.4 | `src/lib/env.ts`、`src/lib/services/statsService.ts` |
| **`ReadingHistory` 為每人每作品一筆最新**（加 `@@unique([userId, novelId])`，再次閱讀 upsert），**非事件序列** —— 否則歷史頁的 `key={entry.novelId}` 會重複鍵、同一作品出現十幾次 | **N-3** | `prisma/base.prisma`、`ReadingHistoryView.tsx` |
| hooks 改為：登入走 API、未登入沿用 `localStorage`。**合併的觸發條件為「該瀏覽器尚存未同步的本機資料」，成功後清除本機**（FEAT-4 裁示 2026-08-06：原寫「登入後首次載入」，若解讀為帳號層級首次，第二台裝置上以訪客身分累積的資料永遠上不了雲；清除亦使冪等成為自然結果，並讓「已在別台移出的收藏被聯集加回」至多發生一次）。清除 MUST NOT 早於伺服器確認寫入成功。**合併規則分兩類**：書架取**聯集**（本機格式無時間戳，無從比較新舊）、閱讀歷史與進度取**時間較新者**；合併須冪等，並略過指向已刪除／已下架作品的本機項目。**偏好同步橫跨兩個 Hook（FEAT-4 裁示 2026-08-07）**：字級在 `useReaderPrefs`、**主題在 `useTheme`**（`localStorage` 鍵 `novelsite-theme`），兩者 MUST 一併改造，合併酬載 MUST 帶滿**四個**本機鍵。原清單只列到 `useReaderPrefs`，但該 Hook 只有 `fontSize` 與 `distractionFree`（後者明訂不跨章節記憶、MUST NOT 同步），主題自始由 `useTheme` 獨立管理 —— 照原清單實作則 `theme` 沒有寫入端也沒有消費端，跨裝置一致的主題部分恆假，而直接打 API 的整合測試看不出這件事。**但四個鍵在觸發與清除上分兩類（FEAT-4 裁示 2026-08-07）**：**觸發判定與清除只涵蓋書架與歷史兩鍵**；字級與主題兩鍵在登入態會被 Hook **持續回寫**（離線快取＋閱讀頁首次繪製的防閃爍來源，`useTheme` 必須在 hydration 前讀到值），把它們納入觸發判定，合併就會被自己回寫的快取重新命中，「成功後清除本機、下次登入不再觸發」永遠不成立 —— 原文的「四個鍵一律掃描與清除」與同一列的偏好同步互相抵銷。兩鍵 MUST 隨附上傳但不清除、不觸發；重複上傳無副作用（伺服器已有偏好紀錄時不覆蓋，第二次以後為空操作） | **N-3** | `src/hooks/{useBookshelf,useBookshelfIds,useReadingHistory,useReaderPrefs,useTheme}.ts` |
| **續讀**：作品頁顯示「繼續閱讀第 N 章」，閱讀頁上報捲動百分比。**上報時機＝`pagehide` ＋ 閱讀中每 30 秒節流（僅百分比有變化時）** —— 只靠離開事件時，闔上裝置或分頁被回收即整段進度遺失。**傳輸一律 `fetch(..., { method:'PUT', keepalive:true })`，MUST NOT 用 `sendBeacon`**（FEAT-4 plan 裁示 2026-08-06：`sendBeacon` 只能發 POST，與 `PUT /api/reading-progress` 的覆寫語意衝突且無法自訂標頭；`keepalive` 提供相同的卸載後送出保證。用 `pagehide` 而非 `beforeunload`：後者在行動瀏覽器移入 bfcache 時不觸發，而那正是本列要覆蓋的情境）。**還原機制（FEAT-4 裁示 2026-08-07）**：續讀入口連向 `/reader/{novelId}/{chapterId}?resume=1`，閱讀頁於正文渲染完成後把捲動位置還原至該 `percent`，**還原完成前 MUST NOT 讓節流上報送出**（否則首次的 0% 會覆寫掉正要還原的值，續讀在第一次使用後即自我銷毀）。原文只寫「顯示入口」與「上報百分比」，但**顯示入口與回到位置是兩件事**，缺後者會交出一個按下去停在章節開頭的功能 | 6.1 | `src/components/novel/NovelHero.tsx`、`src/components/reader/ReaderView.tsx` |
| **本機資料合併端點** `POST /api/reader-state/merge`（FEAT-4 plan 裁示 2026-08-06 新增；原 §5.4 無此列，而拆成三個端點會使「合併須冪等且不得半完成」跨三次請求）。回傳 `{ merged, skipped, truncated }`，`truncated` 為真時前端 MUST 告知有部分未同步。**書架分支的副作用 MUST 與 `POST /api/bookshelf/{id}` 完全一致（FEAT-4 裁示 2026-08-07 補明）**：實際新增的每一筆於同交易內「建立 `Bookshelf` → `favoriteCount` +1 → 寫 `BookshelfEvent(delta=+1)`」，被聯集略過者三者皆不動 —— 原文只寫合併規則、未寫副作用，照字面實作是「只寫關聯列」，而「訪客累積後登入」正是收藏最常見的入庫途徑，該日淨增會系統性少計（`favoriteCount` 尚可由隔日彙總校正蓋回，`BookshelfEvent` 無校正機制、該日 delta 永久遺失） | §5.4 | `src/app/api/reader-state/merge/route.ts` |
| **`BookshelfEvent` 事件明細表**（FEAT-4 plan 裁示 2026-08-06 新增）：加入寫 `+1`、移出寫 `-1`，與 `Bookshelf` 增減**同交易**；保留期同 `ChapterView`（7 天）由 4-C 的彙總清理。**存在理由**：`favorites` 是「當日**淨增**」，但移出書架是硬刪除、資料庫無移出紀錄，而「只彙總已結束日期並回補」又排除了快照相減（回補時中間日快照不存在）——**沒有這張表，「淨增」在資料上不可計算**。**歸屬於 4-A 而非 4-C**（FEAT-4 裁示 2026-08-07 移列）：本表原列於 4-C 統計，但寫入它的是 4-A 的 `bookshelfService`（與收藏增刪同一交易），照原歸屬排程時 4-A 會少一張表而寫不成，且 `data-model.md` §1 與 `tasks.md` T016 皆已把它放進 `4a_reader_state`；4-C 只是它的**消費端**，兩者不同 | **N-3** | `prisma/base.prisma`、`src/lib/services/bookshelfService.ts` |
| 移除 `SEED_READING_HISTORY` 假資料 —— ✅ 已完成；**承載它的 `src/lib/content.ts` 於 4-C（T110）整檔刪除**，全站再無「client 可直接引用的示範資料模組」 | **N-3** | ~~`src/lib/content.ts`（已刪除）~~ |

**4-B 互動**

> **完成紀錄（2026-08-07，T054～T083）**：全數交付並通過三道綠燈閘門
> （`npm run build`／`npm run lint`／`npx tsc --noEmit`），單元 300 案、整合 392 案、a11y 29 案全綠。
> 落地時的三項裁示已回寫至下方對應列與 `arch.md`：評分分佈長條圖移除、
> `ReviewItem`／`CommentThread` 的伺服器判定旗標、作者留言列表的排序與墓碑排除。

| 工作 | arch 項目 | 檔案 |
|------|-----------|------|
| `Review.userId` FK + `@@unique([novelId, userId])`（一人一評） | **N-4** | `prisma/base.prisma` |
| 評論 API：**`GET /api/novels/{id}/reviews`（新增，公開，`?sort=hot\|latest&cursor=`，每頁 20）**、`POST /api/novels/{id}/reviews`、`PATCH`/`DELETE /api/reviews/{id}`。詳情頁不得一次載入全部評論；既有「熱門／最新」切換改由伺服器排序。**評分重算的空集合語意（FEAT-4 裁示 2026-08-07，T047 撰寫時補明）**：新增／編輯／刪除後同交易重算 `Novel.rating` 與 `ratingCount`，且 **`ratingCount` 歸 0 時 `rating` MUST 一併歸 0**——原文（與 §4.2、FR-022）只寫「同步重算」而未定義沒有任何評論的情形，照字面實作「沒有評論就不動 `rating`」是合規的，於是唯一的評論者刪除後作品仍掛著 4.5 顆星而評分人數為 0，正是 FR-043a 所禁止的「無原始紀錄支撐的統計」 | §5.4 | `src/app/api/**` |
| `ReviewLike` 表 + 按讚／取消 API | **N-4** | |
| `Comment` 表（章節留言，含 `parentId` 樓中樓）+ API。**刪除語意分流**：**評論硬刪除**（唯一鍵自然釋放，重新評論無需特例）；**留言保留墓碑**（顯示「此留言已刪除」，**子回覆維持可見**，不得級聯刪除他人內容）。**按讚只做評論、不做留言**（FEAT-4 裁示 2026-08-06）：`Comment.likeCount` 欄位保留但**本階段無寫入路徑、值恆為 0**——spec 未定義留言按讚的需求與端點，`arch.md` §5.4 的端點表也只有 `POST\|DELETE /api/reviews/{id}/like`，照原文實作只會產生一個永遠是 0 的欄位與一個沒有後端的 UI 控制項 | **N-4** | 閱讀頁章末區塊 |
| **內容長度上限**：評論 **1–1000 字**、章節留言 **1–500 字**（皆為 trim 後計；FEAT-4 裁示 2026-08-06，原文只寫「須有長度上限」而無數值，導致「超長回 400」不可測）。兩者刻意不同——評論是對整部作品的完整評價，留言是章末一句話。數值併入既有長度常數集中管理 | §4.2 | `src/lib/validation/common.ts`、`review.ts`、`comment.ts` |
| 評論／留言速率限制（10 次/分鐘/使用者）；**閱讀上報限流（60 次/分鐘/來源位址，超額靜默捨棄不回 429）** —— 上報對匿名開放，去重鍵含 UA，換一個即可繞過 | §7.6 | `src/lib/auth/rateLimit.ts` |
| `ReviewSection` 改為可寫入、可編輯刪除；**示範評論已移除，故須設計完整的空狀態**（範圍調整第 9 項）。**評分分佈長條圖已移除（FEAT-4 實作裁示 2026-08-07／T075）**：它要的是每一顆星各有幾則，而首屏依 FR-023a 只拿得到**第一頁**；以一頁的分佈畫出「全作品的分佈」等於畫一組沒有來源的數字，與 FR-043a 刪除示範評論是同一條理由。總覽改為只顯示伺服器的累計值——平均分（`Novel.rating`）與**評分人數**（`Novel.ratingCount`，MUST NOT 用 `commentCount`，後者含章節留言）。**章末留言區掛在 `<main>` 之外**（憲章第 I 條：互動元件 MUST NOT 侵入閱讀動線）——放進正文容器會跟著 `.reader-content` 的字級與無干擾模式一起變化 | 6.1 | `src/components/novel/ReviewSection.tsx`、`src/components/reader/ChapterCommentSection.tsx` |
| **seed 改寫**：移除示範評論與所有捏造統計，`mockData.ts` 三組手寫排行常數刪除。**本刀（4-B／T082）只做評論那一半**：`SAMPLE_REVIEWS` 與其三處引用、seed 的示範評論寫入與「示範評論者」帳號建立皆已刪除；三組手寫排行常數與示範計數歸零屬 4-C／4-D（T113、T133），本刀不擴大範圍。連帶：領域型別 `NovelDetail.reviews` 已移除（評論改由游標分頁端點供給，FR-023a），舊 `Review` 展示型別與 `toReview` mapper 一併刪除 | 範圍調整 9 | `prisma/seed.ts`、`src/lib/mockData.ts`、`src/lib/types.ts` |

**4-C 統計**

> **完成紀錄（2026-08-08，T094～T112）**：本節除「作者留言管理」（已於 4-B 交付）外全數交付，
> 通過三道綠燈閘門（`npm run build`／`npm run lint`／`npx tsc --noEmit`），
> 單元 336 案、整合 480 案、a11y 29 案全綠。落地時的三項裁示已回寫至下方對應列與 `arch.md`：
> `assertSameOrigin` 的實作位置、`getAuthorDashboard` 的簽章、`taipeiDateString` 的補入。
> **PostgreSQL 軌的 `4c_analytics` 以 `prisma migrate diff` 產生**（與 SQLite 軌同名同內容、兩軌對稱）。
> 原文「本機 Docker 未啟動故未實際 apply」**已失效**——
> **2026-08-08 補驗**：已啟動本機 Docker（`postgres:17-alpine`），三支 postgres migration
> （`4a_reader_state`／`4b_interaction`／`4c_analytics`）對 `novelsite_test` 實際 `migrate deploy` **全部成功**，
> PostgreSQL 軌整合測試 **58 檔 480 案全綠**（與 SQLite 軌同檔同案數）。**本機容器不是正式環境**，
> R-18 的「正式環境 PostgreSQL 部署驗證」仍未勾銷。

| 工作 | arch 項目 | 檔案 |
|------|-----------|------|
| `ChapterView` 明細（含 `viewerHash` 去重窗口，預設 30 分鐘）+ 上報端點。**作品擁有者本人的閱讀不記錄**（否則作者可自刷曝光與排行分數）；**載入完成即上報**，不設停留門檻。**`viewerHash` 以專用環境變數 `VIEW_HASH_SECRET` 的固定鹽值計算，未設定即拒絕啟動；MUST NOT 隨日期輪替、MUST NOT 自 `SESSION_SECRET` 衍生**（FEAT-4 裁示 2026-08-06：成效指標的分母是近 7 日不重複讀者數，鹽值輪替會使同一位匿名讀者跨日被計為多位，而多數讀者未登入） | **N-6** | `prisma/base.prisma`、`src/lib/env.ts`、`src/app/api/**` |
| `NovelDailyStat` 每日彙總 + `POST /api/cron/rollup-stats`。**三個計數皆為「當日新增量」**（閱讀＝去重次數、收藏＝淨增、留言＝新增），**非累計快照**；**以 Asia/Taipei 00:00 為日界線**；彙總須**冪等**並清理過期明細。**只處理已結束的日期**（台北昨日及更早）並回補未處理者，**當日 MUST NOT 產生統計列**（FEAT-4 裁示 2026-08-06：當日資料仍在增加，納入則冪等只在凍結資料的測試中成立）；連帶儀表板閱讀曲線最新至昨日，須於畫面標示統計截止日 | **N-6** | `src/app/api/cron/rollup-stats/route.ts` |
| 儀表板改讀真實資料，**廢除 `getAuthorDailyStats()`**。**取數不開 Route Handler**：由 `/author/dashboard` 的 Server Component 直讀 `statsService.getAuthorDashboard`（授權 `requireAuthor()`，資料層強制帶入 `authorId`），回傳 `{ summary, daily[], statsThroughDate }` 以 props 傳入（FEAT-4 裁示 2026-08-07）。**原文的 `GET /api/author/stats` 已刪除** —— `AuthorDashboardView` 是純 props 的 client 元件、**無期間切換器**，該端點不會有任何消費端，上線即是死碼；沿用導覽列未讀數的同一判準：**沒有客戶端互動需求就不開端點**。日後若新增期間切換器再依此形狀補回（`arch.md` §5.4 該列已劃掉、`tasks.md` 的 T105 已刪）。**簽章為 `getAuthorDashboard(authorId, { days })`，無 `novelId?`（FEAT-4 實作裁示 2026-08-08／T101）**：`contracts/internal-modules.md` §1 原列 `{ days, novelId? }`，但儀表板呈現的是**該作者全部作品的加總**、頁面上沒有任何選作品的控制項，該參數不會有呼叫端 —— 與同一列刪掉 `GET /api/author/stats` 是同一條判準（沒有消費端就不留介面），差別只在一個是端點、一個是參數。**`src/lib/content.ts` 已整檔刪除**：刪掉 `getAuthorDailyStats()` 後該檔只剩一個 header 註解與一行 import，是本次變更自己製造的孤兒（`SEED_READING_HISTORY` 更早已移除） | **N-6** | ~~`src/lib/content.ts`（已刪除）~~、`src/app/author/dashboard/page.tsx`、`src/components/author/AuthorDashboardView.tsx` |
| `/author/earn` 擴充為完整「作品成效總覽」（曝光／完讀率／收藏轉換／留言熱度）——**金額語意已於 FEAT-2 移除**，本階段補齊需真實統計的成效指標。**四項期間統一為近 7 日（＝明細保留期）並於畫面標示，且直接由 `ChapterView` 明細計算，MUST NOT 改讀 `NovelDailyStat`**（FEAT-4 裁示 2026-08-06：完讀率與收藏轉換的分母是**不重複讀者數**，每日統計只有計數、無讀者身分維度，跨日相加會使分母語意從「人」滑成「人日」）；期間內明細已清理時顯示「尚無資料」，不得回退讀每日統計。**回傳形狀見 `arch.md` §「作品成效總覽」該列（FEAT-4 裁示 2026-08-07，T090）**：`PerformanceMetrics = { periodDays: 7, periodStart, periodEnd, impressions, distinctViewers, completionRate: number \| null, favoriteConversion: number \| null, commentHeat }`，**兩項比率在分母為 0 時 MUST 為 `null` 而非 0** —— 原文只寫「顯示尚無資料」而未給型別，回 0 是照字面實作最自然的落點，但 `0%` 說的是「來的人都沒讀完」，事實卻是「沒有人來過」 | **N-8** | `src/app/author/earn/page.tsx`、`src/lib/services/statsService.ts` |
| 作者留言管理（可隱藏、不可竄改自己作品下的留言）。**歸屬為 4-B 而非 4-C（FEAT-4 實作裁示 2026-08-07）**：本列原置於 4-C 統計，但它消費的是 4-B 的 `Comment` 表、與 4-B 的隱藏規則（FR-030～FR-032）同一組驗收，且統計那一刀不觸及它的任何一行；已隨 T071／T072／T079～T081 一併交付。**列表 MUST NOT 列入墓碑**（使用者已刪除的內容沒有可管理的對象），排序為 `createdAt DESC, id ASC`（管理要先看到最新的） | 6.2 | `src/app/api/author/comments/route.ts`、`src/app/api/author/comments/[id]/route.ts`、`src/app/author/comments/page.tsx`、`src/components/author/AuthorCommentList.tsx` |
| **`Novel` 六個反正規化計數的維護分工**：收藏／留言／評分於寫入時**同交易即時**增減；`totalViews`／`weeklyViews` 由**每日彙總回填**；彙總同時以明細**重算校正**前四項。⚠️ `ratingCount` 與 `@@index([weeklyViews])` 在 `base.prisma` **實際不存在**（FEAT-2 落地遺漏），**分屬兩個 migration 補齊**：`ratingCount` 於 **4-B**（`4b_interaction`——評分一有寫入路徑就需要它），`@@index([weeklyViews])` 於 **4-C**（`4c_analytics`——隨 `weeklyViews` 的彙總回填一併落地）。**原文寫「由 4-B 的 migration 補齊」涵蓋兩者**（FEAT-4 裁示 2026-08-07 拆開）：4-B 的 migration 裡沒有任何東西會讀寫 `weeklyViews`，把索引擺進去等於在還沒有資料來源時先建索引，且與 `data-model.md` §1 的 migration 對照表、`tasks.md` T096 直接矛盾——實作者照哪一份做都會使兩軌 migration 對不上 | §4.2 | `services/*`、`cron/rollup-stats` |
| **`POST /api/chapters/{id}/view` 上報端點**（FEAT-4 plan 裁示 2026-08-06 補列；原 §5.4 無此列，而 `ChapterView` 沒有寫入路徑就不存在）。此端點**公開**；處理順序為 已發佈？→ 位址限流（超額**靜默捨棄**）→ 作者本人？→ 算 `viewerHash` → 去重窗口？→ 寫入，**任何跳過皆回相同回應** | §5.4 | `src/app/api/chapters/[id]/view/route.ts` |

**4-D 排行、通知與上線硬化** — ✅ **已完成（2026-08-08，`tasks.md` T113～T162）**，
唯「待外部條件」三項依憲章第 IV 條**維持未勾銷**。

| 工作 | arch 項目 | 檔案 |
|------|-----------|------|
| `RankingEntry` 加 `score`／`computedAt`／`categoryId`，**唯一鍵由 `[period, rank]` 改為 `[period, categoryId, rank]`**（FEAT-4 plan 裁示 2026-08-06：沿用舊鍵會使不同分類的同名次互相排斥，第二個分類的第 1 名寫不進去）；`POST /api/cron/rankings` 由 `NovelDailyStat` 計分並比對前次名次產生 `change`。**每個 `(period, categoryId)` 組合各起一個交易**（讀前次名次→deleteMany→createMany），統計為空時產生**空榜而非保留前次結果**——保留會讓「顯示最近一次重算的結果」變成假的。**取值語意**：週榜取近 7 日每日新增量**加總**、月榜取近 30 日加總、總榜取作品累計值；每個週期同時產生「全部分類」與各分類榜單，名次須連續無缺號。**計分的取數落點為 `repositories/stats.ts` 的 `sumDailyStatsForRanking(period, categoryId)`**（FEAT-4 裁示 2026-08-07）—— 原文只寫「由 `NovelDailyStat` 計分」而未指定經哪一個資料存取模組，`stats.ts` 的職責被寫成「彙總與明細」、`rankings.ts` 被寫成「讀 `RankingEntry` 供顯示」，取數落在兩者之間的空隙，`rankingService` 只剩「自行查 `prisma`」一條路，直接違反憲章第 III 條。`rankings.ts` MUST NOT 混入計分取數；**但 `RankingEntry` 的寫入（每次重算的整組覆寫：讀前次名次／`deleteMany`／`createMany`，三支皆收選填 `tx`）同樣落在 `rankings.ts`**（FEAT-4 實作裁示 2026-08-08／T121）—— 原文寫的是「只讀 `RankingEntry`」，但重算總得有人寫，照字面實作時 `rankingService` 只剩「自行查 `prisma`」一條路，與上一句剛修好的空隙**完全相同**的錯誤。界線是**資料表**而非讀寫：`RankingEntry` 的一切存取在 `rankings.ts`，計分取數在 `stats.ts`。**該函式的回傳 MUST 為 `{ novelId, views, favorites, comments, rating, ratingCount }`（FEAT-4 裁示 2026-08-07 補上後兩欄）**：計分是**四項**相加，第四項 `rating × ratingCount × 0.5` 三個週期一律取 `Novel` 的**當前值**（`NovelDailyStat` 只有三個計數、不含評分，「近 N 日的評分」在資料上不存在）；原文只補了前三項的落點，第四項退回同一個空隙，`rankingService` 為它又只剩直查 `prisma` 一條路，等於只修好一半 | **N-5** | `src/lib/services/rankingService.ts`、`src/lib/repositories/stats.ts` |
| **新增 `Chapter.scheduledAt` 欄位** + 排程發佈 UI + `POST /api/cron/publish-scheduled`（掃 `scheduledAt <= now && status='draft'`）。**發佈獨立為 `chapterService.publishChapter(uid, { chapterId, scheduledAt? })`（FEAT-4 實作裁示 2026-08-08／T128）**：契約原文寫「`publishChapter` 於成功後呼叫 `notifyNewChapters`」，但 FEAT-3 交付的是雙向的 `setChapterStatus(uid, { chapterId, status })` —— 沒有一支叫 `publishChapter` 的東西可以「於成功後」加一行；把通知掛進 `setChapterStatus` 會讓**下架**也走同一條路徑，且對已發佈章節再按一次發佈就重發追更通知。新函式**只有原狀態為 `draft` 時才通知**，`setChapterStatus` 保留給下架。服務層一律收 `uid` 而非 `session`（既有寫入皆如此，且 `publishDueScheduled` 正是一條沒有工作階段的路徑）—— FEAT-3 刻意不建此欄位：沒有 cron 的排程等於「設定了但永遠不會發佈」。**批次發佈的落點為 `chapterService.publishDueScheduled(now)`（FEAT-4 裁示 2026-08-07）**：Route Handler 只做「驗密鑰 → 呼叫服務 → 回報結果」，掃描、逐章交易（含回填 `chapterCount`／`wordCount`）、group by `novelId` 與發通知的整段編排 MUST 位於服務層，與另兩個 cron 入口同形。原文只寫了端點與篩選條件而未指定落點，照字面實作會把整段編排寫進 Route Handler；且既有的 `publishChapter` 以工作階段判定擁有權，cron 沒有工作階段，硬用會逼出一個假的系統身分，故 `publishDueScheduled` **無 session 入參** | §5.7 | `prisma/base.prisma`、`src/lib/services/chapterService.ts`、`src/app/api/cron/**` |
| `Notification` 表 + 追更通知（書架訂閱者於新章節發佈時收到，**作者本人不收到**）+ 通知中心。**本階段只產生追更一種型別**；**同一作品在同一次排程作業執行中發佈多章合併為一則**（含新增章節數與最新章名），立即發佈則每次各一則。**`payload` 的 `novelSlug` 與 `novelId` 同值**（FEAT-4 實作裁示 2026-08-08／T127）：`Novel` **沒有 slug 欄位**，作品網址本來就是 `/novels/{id}`；為這一格新增一欄只會多一個要維護的唯一鍵。該格仍保留於酬載，前端與測試依賴的是 `data-model.md` §2.8 的固定六欄形狀 | 6.1 | `src/app/api/notifications/**`、`src/components/profile/NotificationCenter.tsx` |
| **導覽列未讀數的成本界線**：未登入訪客零額外查詢；已登入者每頁至多一次計數，且與版面既有的工作階段讀取同一次往返完成；未讀數即時、不快取 | §7.1、§5.4 | `SiteHeader.tsx`、`SessionProvider` |
| **三個排程作業的觸發**：版控的 `npm run cron:*` 觸發指令 + README 載明如何接上部署平台排程；**不繫結雲端廠商、不跑常駐排程器** | §5.7 | `package.json`、`scripts/`、`README.md` |
| ✅ Playwright E2E **其餘三條**主流程（讀者流、越權流、無障礙）—— 框架與作者流一條已於 FEAT-3 交付；**讀者流另須於三種瀏覽器引擎跑過**。**完成紀錄（2026-08-08／T147～T150）**：四條流程 8 個案例全綠，讀者流於 chromium／firefox／webkit 三引擎皆通過。**兩項為此新增的測試設定**：(1) `SESSION_COOKIE_SECURE`（`arch.md` §3.5）—— `next start` 一律 `NODE_ENV=production`，而 WebKit 不把 `http://localhost` 當成安全內容、會丟棄 `Secure` 的 Cookie，不提供這個開關則 webkit 上連登入都過不了；(2) 逐 project 的 `X-Forwarded-For` —— 三個 project 共用同一份記憶體限流表，不分桶時第三個引擎的註冊會撞上 `REGISTER_RATE_IP_MAX`，與 `arch.md` §10.5 既有的鍵值天然隔離同源。**越權流刻意不使用示範讀者帳號**：`author-flow` 會把它升級成作者，四個 spec 共用同一個 `e2e.db` 且依檔名排序執行 | **N-7** | `novelsite/tests/e2e/*.spec.ts`、`playwright.config.ts` |
| **自 FEAT-3 明文延後者**：章節跨卷搬動、卷排序、作者自建標籤（含中文 slug 生成規則）、作品／章節寫入路徑的速率限制、搜尋的效能量測與時間目標（含放大資料集壓測）、多執行個體部署的限流 | — | |
| ✅ Lighthouse **本機無頭瀏覽器實測**並記錄四項分數（無障礙 ≥ 95）；跨瀏覽器以自動化測試在三種引擎跑讀者流。**完成紀錄（2026-08-08／T155）**：首頁 58／**96**／81／100，閱讀頁 63／**96**／81／100（Performance／Accessibility／Best Practices／SEO），**無障礙兩頁皆 96 ≥ 95**。為達標只修了**本階段自己新增的**兩處對比（章末留言區的空狀態與登入連結）與首頁輪播圓點的命中區（8×8 → 24×24，WCAG 2.5.8）；其餘 `color-contrast` 命中點源自設計 token 本身（`--color-accent` 疊白底 3.18:1、`--color-subtle` 疊 `--color-muted` 4.22:1），改它等於變更全站品牌配色，屬設計層級決定，已列入 README「已知基線」。`is-on-https` 的失分來自量測對象是 `http://localhost`，非缺陷 | `plan.md` | `README.md` |
| ⏸ **待外部條件（MUST NOT 標記為已完成）共三項**：真實行動裝置實機測試、正式環境的 PostgreSQL 部署驗證、**部署平台的排程設定**。前者需實體裝置，第二項需正式環境（**PostgreSQL 的結構與索引正確性已由 FEAT-3 的雙軌整合測試涵蓋**，本階段延續該驗收方式）；第三項為 FEAT-4 裁示 2026-08-07 補入 —— 三個排程作業交付的是受密鑰保護的入口與版控觸發指令，接上哪一個平台的排程屬部署階段工作。**`playwright install firefox webkit` 不屬本清單**：它是跨瀏覽器測試的前置安裝步驟，若列為待外部條件會與「讀者流 MUST 於三引擎**通過**」直接衝突 —— 同一件事不可能既是必須通過的驗收、又是不必完成的外部條件 | §10.5、憲章 IV | `README.md` |

### 新增依賴

無（`@playwright/test` 已於 FEAT-3 導入）

### 完成定義

1. 登入 → 加書架 → 讀到第 3 章 → 換裝置登入 → **書架與續讀位置皆保留**
2. 同一使用者對同作品評論兩次 → 第二次 409 `CONFLICT`
3. 未登入 `POST /api/bookshelf/{id}` → 401 `UNAUTHENTICATED`
4. 進度上報 `percent=150` → 400 `VALIDATION_ERROR`
5. 閱讀章節後 `ChapterView` 有記錄；執行 rollup cron 後 `NovelDailyStat` 數字可對上
6. 執行 rankings cron 後 `RankingEntry.computedAt` 更新，名次與 `score` 排序一致，`change` 正確反映升降
7. 儀表板每個數字都能由 DB 反推；`grep -rn "getAuthorDailyStats\|SEED_READING_HISTORY" src` 無結果
8. `/author/earn` 呈現完整作品成效指標（曝光／完讀率／收藏轉換／留言熱度；金額語意已於 FEAT-2 移除）
9. ✅ Playwright **四條**主流程全綠（作者流一條自 FEAT-3 沿用）、讀者流於三種瀏覽器引擎皆通過；兩種 provider 的整合測試全綠 —— **2026-08-08 驗證**：E2E 8 案全綠；整合測試兩軌**各 64 檔 554 案、結果完全一致**（SC-014）
10. **未登入累積的本機資料於該瀏覽器登入後全數上雲**（觸發條件為本機的**書架或歷史**鍵仍有資料，非帳號層級的首次登入）：書架取聯集、歷史與進度取時間較新者，重複 0、遺失 0，重複執行合併結果不變，且**合併成功後本機的書架與歷史資料為空**、再次登入不再觸發（字級與主題兩鍵**刻意不清除**，見 4-A 該列）。合併新增的每一筆收藏，其 `favoriteCount` 與 `BookshelfEvent` 與「直接加入書架」完全一致
11. **一次排程發佈同一作品的 M 章**：N 位收藏者恰好收到 **N 則**通知（非 N×M），作者本人 0 則
12. ✅ **全站掃描無殘留誠實標示**：未登入情境的文案改為「登入後會自動同步」。**2026-08-08 交付方式已自一次性 `grep` 改為可執行測試**（`tests/unit/feat4-scan.test.ts`）—— `grep` 的結果只存在於當下那個終端機裡，下一個人把字串加回來時不會有任何東西變紅。掃描清單同時**比原文多兩個字串**（「僅存於瀏覽器」「換裝置不會同步」）：`NovelHero`／`BookshelfView`／`ReadingHistoryView`／`ReaderView` 四處**註解**寫的正是後者，原字串掃不到它們，而 FR-017 禁止的是**主張**、不是某一個字串
13. **待外部條件的三項未被標記為已完成**：README 明列真實行動裝置實機測試、正式環境部署驗證與部署平台排程設定仍未完成（憲章第 IV 條；2026-08-07 自兩項改為三項，見上方該列）

### 測試

- **單元**：`rankingService` 計分公式（**四項齊備**，資料集須含「三類計數皆 0 但有評分」的作品）與 up/down/same/new 判定、`rateLimit`、**`useReaderStateMerge`**（觸發判定／清除時機／不重複觸發／截斷告知 —— 完成定義第 10 項的後半是純客戶端行為，伺服器端整合測試看不見 `localStorage`）
- **整合**：`arch.md` §10.3 案例 8、9、19
- **E2E**：§10.4 補齊**其餘三條**（讀者流、越權流、無障礙），連同 FEAT-3 的作者流共四條全綠
- **雙軌**：§10.5 兩 provider 各跑一次整合測試，結果須完全一致

### 風險

| 風險 | 對策 |
|------|------|
| `ChapterView` 明細高頻寫入造成 DB 壓力 | `viewerHash` 去重窗口 + rollup 後清理過期明細；必要時降級為僅計數 |
| 排行榜計分公式難以驗證 | `arch.md` §5.7 已定初版公式；以固定測試資料驗證名次可預期 |
| `localStorage` 資料合併上傳可能重複或覆蓋 | 以 `@@unique` 約束 + upsert；**書架取聯集、歷史與進度取「時間較新者勝」**（本機書架無時間戳，無從比較），合併須冪等並寫成單元測試 |
| **一次排程多章造成通知洗版** | 同一作品在同一次排程作業執行內合併為一則通知（範圍調整第 8 項） |
| **每日統計語意誤用為累計快照** | 明訂為當日新增量（範圍調整第 6 項）；以固定資料集驗證「近 N 日加總」的名次可預期 |

---

## FEAT-5　郵件基礎設施、密碼救援與聯絡管道

> **一句話**：讓這個站第一次寄得出信，並用它把兩條死路（忘記密碼、聯絡我們）接通。
> **對應 arch.md**：§7.2（無密碼救援途徑該列）、§8（聯絡我們表單該列）、**§9 Phase 14**
> **對應 GitHub issue**：[#5](https://github.com/nomoneylee/novels/issues/5)、[#6](https://github.com/nomoneylee/novels/issues/6)
> **規格**：`specs/005-email-recovery-contact/`（`spec.md`、`checklists/requirements.md`）
> **規劃（2026-08-09 完成）**：同目錄 `plan.md`、`research.md`（R-1～R-17）、`data-model.md`、
> `contracts/`（`password-reset-api.md`、`contact-api.md`、`internal-modules.md`）、`quickstart.md`、
> `tasks.md`（**74 個任務**，三刀各自可獨立合併）。
> **十四處**與上游原文不同的裁示已回寫，清單見 `plan.md`「上游文件同步」
> （#5、#6 為 `/speckit-analyze` **第一輪**、#7～#11 為**第二輪**、#12～#14 為**第三輪**
> 查出的遺漏，皆 2026-08-09 同輪補正；**其中 #12 源自憲章**「開發流程與品質閘門」）
> **相依**：FEAT-1（限流機制、session 撤銷、密碼雜湊與密碼規則）。不依賴 FEAT-2～4
> **建立日期**：2026-08-09

### 為什麼需要

issue #5 的損失是**不可逆的**：使用者忘記密碼，帳號連同書架、閱讀歷史、閱讀進度與（作者的）
全部作品一起永久失效，而站方**也無法代為救援** —— 目前既無重設信也無管理端介面。
issue #6 的四個入口中，隱私權頁那一處性質不同：它是個資查閱／更正／刪除權的行使管道，
表單不通等於該權利在實務上沒有出口，屬**法遵**層面。

兩者的解除條件寫的是同一句話，故合為一個 Feature。

### 範圍（三刀，依序可獨立交付）

| 刀 | 內容 | 可獨立交付？ |
|----|------|--------------|
| **5-A 可達的聯絡信箱** | 對外聯絡信箱位址改由設定決定；隱私權頁的權利行使段落直接列出該位址，**且該頁改為逐請求求值（`force-dynamic`）**，**並由本刀自己的整合測試把關該頁確實含 `mailto:`** | ✅ **不需寄送能力即可交付**，是最小的法遵止血 |
| **5-B 寄送能力 + 密碼救援** | 薄介面（`Mailer`）隔開**廠商 API**（**MUST NOT 引入 `resend` SDK**，以 `fetch` 直呼）；重設憑證 schema；申請與重設兩個入口；登入頁加「忘記密碼」、**註冊頁移除同一句失效主張** | **無跨刀相依**（設定機制已上提至 tasks Foundational T004–T005） |
| **5-C 聯絡表單接通 + 誠實標示收尾** | 表單接上寄送並解除停用（**含 honeypot 欄位本身**）；移除兩類已失效文案；修正 README 兩列 + 新增一列；擴充全站掃描 | 需 5-B 的寄送能力 |

> **上表兩處於 `/speckit-analyze` 第二輪（2026-08-09）就地取代**：(a) 5-B 原寫「隔開廠商 **SDK**」，
> 與本檔風險表及 `arch.md` §9 Phase 14 第 1 項的「MUST NOT 引入 SDK」**並存**——兩種說法同時存在
> 等於沒有真相來源；(b) 5-B 原寫「需 5-A 的設定機制」，而 `tasks.md` 已把該設定機制上提至
> Foundational（T004–T005），三刀在 Phase 2 之後完全平行。
>
> **5-A 那一列於第三輪（2026-08-09）補上「本刀自己的整合測試」**：隱私權頁含 `mailto:` 的斷言
> 原本寫在 **5-C** 的入口測試檔裡，而它斷言的實作由 5-A 交付 —— 於是「三刀完全平行」與
> 「5-C 的測試依賴 5-A 的實作」兩句話並存，且 **5-C 若先合併，該斷言交付即紅**。
> 斷言已移入 5-A（`arch.md` §10.3 案例 33），上表「可獨立交付？」欄自此為真。
>
> **5-A 那一列於 T041 交付時（2026-08-10）補上 `force-dynamic`**：完成定義寫的是
> 「更換聯絡信箱**不需修改任何一行原始碼**」，而該條的驗收方式是**變更設定並重啟服務**、
> 不含重新建置。隱私權頁原為純靜態頁，會把位址**烤進建置產物**——
> 換了信箱重啟後畫面看起來完全正常，只有寄到舊位址的權利行使請求沒有人收得到
> （`arch.md` §9 Phase 14 第 6 項同輪回寫）。

**明確排除**（理由見 `spec.md` Out of Scope）：註冊時的 Email 驗證信、管理端代為重設、
密碼變更通知信、站內聯絡訊息管理介面、限流改用共享儲存、退信與投遞狀態回呼。

### 兩處與上游原文不同的裁示（2026-08-09，已回寫 arch.md）

1. **登入頁要放「忘記密碼」入口**。§7.2 原文「不得放任何『忘記密碼』入口或流程假象」，
   其成立前提是「沒有可用的救援途徑，放了就是假象」。本 Feature 交付真正可用的流程，前提消失。
2. **聯絡表單送出控制項解除停用**，但**誠實標示的判準本身不變** ——
   一旦寄送在執行期失敗，畫面仍 MUST NOT 假成功。解除的是「永遠停用」，不是誠實標示。

### `/speckit-clarify` 七項裁示（2026-08-09，已回寫 arch.md）

| # | 裁示 | 為何不能照原本的想法做 | arch.md 落點 |
|---|------|------------------------|--------------|
| 1 | **重設信於回應送出後才寄**，不在請求生命週期內同步等待 | 不存在的帳號會跳過「產生憑證 + 寄信」兩步，而寄信是一次對外 HTTPS 呼叫（數百毫秒）——**同步寄送下的時間差是結構性的且遠大於雜訊**，「回應時間不得洩漏帳號存在性」根本不可能成立。補假延遲的替代方案需維護一個會漂移的基準值 | Phase 14 第 3 項 |
| 2 | **寄送有三種實作**（正式／測試記憶體／開發主控台）；憑證未設定時**正式拒絕啟動、開發降級並警示** | 原本「未設定即一律停用入口」會使本機**永遠走不到「設定新密碼」頁**，而該頁的 a11y 檢查與全程自助復原的驗證都在本機執行。另：「測試要能斷言收到什麼」與「開發者要看得到連結」是兩種需求，合併必有一方將就 | Phase 14 第 1 項 |
| 3 | 過期／已用畢的重設憑證**於該使用者下次申請時順帶刪除**，不建排程 | 新增第四個 `/api/cron/*` 入口會使 README「部署平台排程設定」的待外部條件**再多一項**，而這張表的成長來源只有「有人申請重設」，量級遠低於 Session 表 | Phase 14 第 2 項 |
| 4 | 重設申請**帳號鍵另訂 3 次/小時**、位址鍵沿用登入的 5 次/分鐘；聯絡表單 3 次/小時/位址 | 沿用登入帳號鍵的 5 次/15 分鐘 等於允許對同一個受害信箱灌 **20 封/小時**。重設申請與登入性質不同：**登入失敗不會寄任何東西給受害者，重設申請會** | §7.6 新增一列 |
| 5 | **不納入註冊 Email 驗證**，但風險 MUST 明文記入 README 已知限制 | 規格初稿的理由「未驗證只會造成使用者自己收不到」**不完整** —— 填成他人真實位址時，該位址擁有者可經重設流程**接管帳號**，而這是本 Feature 把一個原本無法利用的條件變成可利用的路徑。仍不納入的實際理由是該結果方向正確（帳號本就該由信箱擁有者控制） | Phase 14 第 7a 項 |
| 6 | 寄送實作由**顯式設定 `MAIL_MODE`**（`production`｜`memory`｜`console`）決定，不只依環境推導 | **第 2 項的答案自己引入的衝突**：整合測試以正式建置產物啟動，測試伺服器的 `NODE_ENV` 是 `production`，撞上「正式環境缺憑證即拒絕啟動」會讓伺服器**根本起不來**，且症狀是環境變數驗證失敗而非測試斷言失敗 | Phase 14 第 1 項 |
| 7 | **`MAIL_MODE=production` 時 `NEXT_PUBLIC_SITE_URL` 未明示即拒絕啟動** | 該值原有的靜默回落對 metadata／sitemap 只是標註不準，但重設連結是絕對網址 —— **填錯等於每封信的連結都指向別的網站，而系統仍回報「已寄出」**。本 Feature 把它從軟性預設變成硬性正確性需求 | Phase 14 第 1 項 |

### 完成定義（Definition of Done）

- [X] 忘記密碼者可全程自助完成「申請 → 收信 → 設新密碼 → 以新密碼登入」，不需人工介入
- [X] 對已註冊與未註冊 Email 的重設申請，回應完全一致，且無法據回應時間差判斷帳號是否存在
- [X] 重設憑證：雜湊入庫（DB 內查無明碼）、逾期不可用、用過一次即失效、同一使用者至多一筆有效
- [X] 登入後自行改密碼時，該使用者全部未使用的重設憑證一併作廢
- [X] 重設成功後，該帳號在其他裝置的既有登入立即失效
- [ ] 聯絡表單送出成功者訊息確實送達營運信箱；寄送失敗者顯示失敗並提示可改用聯絡信箱，**無任何假成功**
      —— **後半已驗、前半待外部條件（2026-08-11）**：「失敗者顯示失敗」由
      `tests/integration/contact-failure.test.ts` 把關（502 `MAIL_FAILED`，回應與畫面文案零「已送出」字樣）；
      「**確實送達營運信箱**」需 Resend 帳號、寄件網域與 SPF／DKIM／DMARC 三筆 DNS（見「待外部條件」），
      **MUST NOT 以 outbox 收到該封信充當送達** —— 那正是本 Feature 反覆禁止的「以系統回報成功充當送達」
- [X] 更換對外聯絡信箱不需修改任何一行原始碼；未設定時回落預設值並於啟動記錄標示
- [ ] 隱私權頁的個資權利行使段落直接列出可實際收信的位址（非僅指向表單的連結），
      且**經外部信箱實測寄達**——法遵管道的驗收對象是「信真的到得了」，
      **MUST NOT 以「頁面上有 `mailto:` 連結」充當送達**（`/speckit-analyze` 第二輪補正，2026-08-09）
      —— **前半已驗、後半未執行（2026-08-11）**：頁面確實列出 `env.CONTACT_EMAIL` 的 `mailto:`
      （`tests/integration/privacy-contact-email.test.ts`），且換設定重啟即生效（tasks T043(a)，2026-08-10 沿用同一份
      `.next` 產物驗過）；**「自外部信箱寄一封信並確認收到」（tasks T043(b)）尚未執行**，需一個外部信箱與該位址的收件端
- [X] 註冊頁與登入頁**兩處**「本階段尚無密碼重設功能」文案皆已移除（兩處是一組，見 arch.md §7.2）
- [X] 聯絡表單含 honeypot 欄位本身（`tabIndex={-1}`／`autoComplete="off"`／`aria-hidden`），
      命中回 400 而非假成功的 200
- [X] 聯絡表單的欄位驗證失敗**逐欄位顯示**，不與寄送失敗共用同一句提示
      —— **2026-08-13 手動測試後補**：原本 400 一律落到失敗提示，畫面只有
      「輸入格式不正確你可以直接來信 …」，使用者無從得知是哪一欄不合格，
      且被導向一個他不需要的替代管道。送出前改以同一份 `contactSchema` 先驗
      （轉換函式抽至 `src/lib/validation/fieldErrors.ts` 供 client／server 共用），
      **honeypot 命中仍走失敗提示**（該欄對人不可見）。見 `contracts/contact-api.md` §2.1
- [X] 全站與 `README.md` 零筆殘留的「尚無密碼重設功能」「尚無法送出訊息」類敘述，且有掃描測試把關
- [X] `README.md`「無密碼救援途徑」一列的「改密碼函式不對外開放」已改寫（自 FEAT-3 起即不成立）
- [X] 在寄送能力未設定的環境跑完整測試套件，**零封**郵件被送往外部
- [X] 寄送三種實作齊備，由 `MAIL_MODE` 顯式選用；`.env.test` 設 `memory` 且測試伺服器在**零郵件憑證**下可啟動
- [X] `MAIL_MODE` 未明示時：正式環境缺憑證即**拒絕啟動**，開發環境缺憑證即降級為主控台並於啟動記錄**警示**
- [X] `MAIL_MODE=production` 且未明示 `NEXT_PUBLIC_SITE_URL` 時**拒絕啟動**
- [X] 重設信的寄送發生在回應送出之後（存在與不存在兩種 Email 的回應時間差不可據以區分）
- [X] 重設申請帳號鍵 3 次/小時、位址鍵 5 次/分鐘、聯絡表單 3 次/小時/位址，三者皆可設定且有整合測試
- [X] **帳號鍵對「未註冊」的 Email 一樣計數**（第 4 次同樣 429），且有整合測試把關
      （`/speckit-analyze` 第三輪補入，2026-08-09）——只對存在帳號計數的實作會讓未註冊者第 4 次回 200、
      已註冊者回 429，**差異本身就是帳號枚舉管道**，而「回應一律相同」那道測試只各送一次，看不見它
- [X] **重設時的新密碼規則與註冊逐案一致**，且有單元測試比對兩個 schema
      （第三輪補入）——另訂一套較寬的規則不會讓任何測試變紅，而重設是設定密碼的**第三個入口**
- [X] **登入頁確實含 `/auth/forgot-password` 連結**，且有整合測試把關（第三輪補入）——
      a11y 清單裡的忘記密碼頁目標只證明**那一頁存在**，不證明登入頁到得了它
- [X] **收尾紀錄三份齊備**：`arch.md` §9 Phase 14、本節、**`novelsite/plan.md` 的 Phase 14 里程碑列**
      （憲章「開發流程與品質閘門」明列後者為現行工作事實來源；`nextstep.md` 無對應項目，
      該檔只補一段關係說明，不另立副本）
- [X] `README.md` 已知限制**新增**「註冊 Email 未驗證所遺留的帳號接管風險」一列，並載明是本 Feature 引入的可利用路徑
- [X] 共通完成準則四項（測試全過、三綠燈、雙軌皆可執行、合併後網站仍可完整瀏覽）

**執行紀錄（2026-08-11，FEAT-5 T055～T065）**

- **三綠燈**：`npm run build`／`npm run lint`／`npx tsc --noEmit` 全過。
- **四套測試**：單元 29 檔 440 案、整合 76 檔 602 案、a11y 3 檔 42 案、E2E 8 案（讀者流跑三引擎）全過。
- **雙軌**：`DATABASE_PROVIDER=postgresql npm run test:integration` **76 檔 602 案，與 SQLite 軌逐項一致**。
  本輪**首次實際執行**了 T024 手寫的 PostgreSQL `20260810064412_5b_password_reset`
  （先前本機無 PostgreSQL 亦無 Docker，該 SQL 未被任何執行驗證過；`prisma validate` 只看 schema 不看 migration SQL）：
  `migrate deploy` 套用成功，`PasswordResetToken` 的六欄、`_pkey`、`tokenHash` 唯一索引、
  `userId`／`expiresAt` 兩個索引與 `ON DELETE CASCADE` 外鍵皆與 SQLite 軌對稱。
- **零封外寄（SC-010）**：四套測試的郵件設定皆來自 `.env.test` 的 `MAIL_MODE=memory`
  （E2E 的 `playwright.config.ts` 亦經 `loadTestEnv()` 取得同一份設定），
  全程 `mail.send` 記錄一律 `mode=memory`，`resendMailer` 的 `api.resend.com` 端點未被觸及。
- **未完成而刻意不勾的三處**：聯絡表單的「確實送達營運信箱」、隱私權頁位址的「經外部信箱實測寄達」
  （tasks T043(b)），以及下方「待外部條件」三項 —— 皆屬**送達**而非**回報成功**，本機無從驗證。

**待外部條件（MUST NOT 標記為已完成，憲章第 IV 條；對應 arch.md Phase 14 第 8 項）**

- [ ] 可用的郵件服務帳號（Resend）
- [ ] 寄件網域（`MAIL_FROM` 的網域）
- [ ] 該網域的 **SPF／DKIM／DMARC 三筆 DNS 記錄**

**第三項是本 Phase 最容易被誤判為完成的一項**：缺了它，`resendMailer` 照樣收到 2xx、
站上照樣記錄「已寄出」、聯絡表單照樣顯示成功 —— 而信進垃圾匣。
**驗收 MUST NOT 以「系統回報成功」充當送達**，三項齊備前
「聯絡表單訊息確實送達營運信箱」與「隱私權頁位址經外部信箱實測寄達」兩項 MUST 維持未勾。

### 測試

- **單元**：重設憑證的產生／雜湊／逾期／單次可用／作廢規則；聯絡信箱設定的回落與啟動標示；寄送介面的假實作；
  **重設密碼的 schema 與註冊逐案一致**（`/speckit-analyze` 第三輪補入，2026-08-09——
  「沿用既有密碼規則」先前只有實作沒有把關）
- **整合**：存在與不存在的 Email 兩種重設申請回應一致；重設連結重複使用與逾期；重設成功後既有 session 全滅；
  重設申請與聯絡表單的限流（**帳號鍵的限流 MUST 對已註冊與未註冊各驗一組，且兩組各用一個不同的
  `X-Forwarded-For`**——位址鍵是 5 次/分鐘，八次請求同址會先被位址鍵擋下，第二組於是為了錯的理由變綠）；
  寄送失敗時聯絡表單回報失敗；**登入頁含忘記密碼入口**；**隱私權頁含 `mailto:` 位址（屬 5-A 自己的把關）**。
  **「寄送失敗」以 `fail@outbox.invalid` 觸發，判定同時看收件人 `to` 與回覆位址 `replyTo`**
  （FEAT-5 plan 裁示 2026-08-09；**判定擴及 `replyTo` 為 T046 交付時裁示，2026-08-10，
  就地取代原文的「這個收件人」**——聯絡信的收件人一律是 `CONTACT_EMAIL`，
  **照原文那條失敗分支永遠觸發不到**，而聯絡表單正是唯一會分別回報成功與失敗的那一支）：
  測試實作見到該位址即擲寄送錯誤。**這不是測試後門** —— 不繞過任何檢查、不改任何門檻、
  不影響其他收件人，且 `.invalid` 是 RFC 2606 保留 TLD，永遠不會是真實信箱。
  沒有它就**無法驗證「不得假成功」這條規則本身**。MUST 僅存在於測試實作，MUST NOT 進正式實作
- **a11y**：忘記密碼頁、重設密碼頁、連結失效的說明訊息（與對應區塊有程式化關聯）。
  **重設密碼頁 MUST 以真憑證進入**（自 outbox 取得）—— 帶假憑證渲染的是「連結已失效」，
  那個畫面照樣可能零違規，而真正要稽核的表單根本沒被渲染
- **掃描**：兩類已失效文案主張納入既有的全站掃描測試。**`README.md` 用獨立清單、不併入既有的 `src` 清單**
  （FEAT-5 plan 裁示，2026-08-09）：既有清單中的 `僅保存在此瀏覽器` 等字串**現在就寫在 `README.md` 裡**
  （FEAT-4 的已解除列引用了原文），併進去會讓測試在動任何一行程式碼之前就先紅，
  而唯一的轉綠方式是去刪 FEAT-4 的紀錄。連帶約束：本階段改寫 README 那三列時
  **MUST NOT 引用「尚無密碼重設功能」「尚無法送出訊息」兩句原文**（連刪除線引用都不行）

**測試如何看見「寄了什麼」（FEAT-5 plan 裁示，2026-08-09，取代 spec FR-002a 的「於記憶體收集」）**：
測試實作 MUST 把寄件內容以 **JSON Lines 追加寫入落地檔**（`MAIL_OUTBOX_PATH`，預設
`process.cwd()`／`.mail-outbox.jsonl` —— 工作目錄一律是應用根 `novelsite/`、**非 repo 根**，
原文的 `<repo>/…` 語意含混已於 `/speckit-analyze` 第二輪 2026-08-09 取代；`novelsite/.gitignore`
的 `/.mail-outbox.jsonl` 開頭 `/` 錨定該目錄，故基準取成 repo 根會使該檔逃過忽略而被版控追蹤），
MUST NOT 只存記憶體。**原文預設測試與伺服器同行程，而本專案不是** ——
整合與 a11y 測試都以 `next build` + `next start` 啟另一個行程再打 HTTP，
伺服器行程內的記憶體陣列在測試行程裡永遠是空的。保護目標（不對外送信、可斷言內容）不變。

**另新增設定 `MAIL_MEMORY_DELAY_MS`**（預設 `0`，`.env.test` 設 `300`）：
它是「寄送確實發生在回應之後」那道測試的**解析度**。兩條路徑的天然時間差只有數毫秒，
沒有這個人工延遲就測不出「`after()` 生效」與「沒生效但這次剛好很快」的差別。

### 風險

| 風險 | 對策 |
|------|------|
| **缺 SPF／DKIM／DMARC 使信件進垃圾匣，而系統回報「已寄出」** —— 驗收表面通過、實際失效 | 列為待外部條件（arch.md Phase 14 第 8 項）；**驗收 MUST NOT 以「系統回報成功」充當送達**，須以實際收信確認 |
| 整合測試真的往外寄信 | 寄送能力 MUST 經薄介面（`Mailer`），測試環境以 `MAIL_MODE=memory` 替換為不對外送信的實作（理由同 `RateLimitStore`／FR-050）。**廠商 SDK 不引入**，Resend 以 `fetch` 直呼 HTTPS API（FEAT-5 plan 裁示，2026-08-09）：`deploy/deployment.md` §8 原文寫「隔開廠商 SDK」，但該原文要保護的兩件事由 `Mailer` 介面本身達成，SDK 只是包一個 `POST /emails` 卻多一個要跟著升級的相依 |
| **背景寄送機制在框架上不成立 → 重設信根本沒寄，但使用者看到的仍是成功訊息** | 實作前 MUST 依 `AGENTS.md` 查證 `node_modules/next/dist/docs/` 的「回應後續行工作」機制與存活保證，並以可重複方式驗證該工作確實被執行。**查證結果（2026-08-09）**：機制為 `after()`，`v15.1.0` 起穩定、Node.js server 與 Docker fully supported、`next start` 的 graceful shutdown 會跑完 pending callback（出處與兩道驗證見 arch.md §9 Phase 14 第 3 項） |
| 重設申請成為帳號枚舉管道 | 回應一律相同；帳號鍵**對不存在的帳號一律計數**，限流判斷早於查 DB（沿用 §7.6 既有判準） |
| 重設信被當成釣魚信 | 信件內容載明有效期與「若非本人申請可忽略」；有效期壓在 30 分鐘 |
| 聯絡表單成為垃圾信管道 | 速率限制 + 隱藏誘餌欄位；**MUST NOT 主動寄信至表單填入的 Email**（否則站台變成 spam 放大器）。**誘餌欄位命中 MUST 回 400，MUST NOT 回假成功的 200**（FEAT-5 plan 裁示，2026-08-09）—— 回 200 騙機器人正是 arch.md §8 與 `feat4-scan` 甲-3 禁止的假成功，且會在站上留下一個「回報成功但什麼也沒做」的分支；誠實回應不影響真實使用者（該欄位對人不可見、不會被走訪或自動填入） |
| **註冊 Email 未驗證 → 填成他人位址者的帳號可被接管** | 刻意接受（帳號本就該由信箱擁有者控制），但 MUST 明文記入 README 已知限制並載明**是本 Feature 引入的可利用路徑**，MUST NOT 以「既有問題」帶過 |
| **過渡預設信箱是個人 Gmail** | 這是刻意的過渡決定（使用者 2026-08-09 指示）。公開個人信箱會招致垃圾信，且以個人信箱承接法遵通知並不理想 —— 故 FR-022 要求它**必須可被設定覆寫**，正式上線 MUST 換為站台專用位址 |

---

## FEAT-6　正式上線就緒：資料防呆、子路徑相容、容器化與自動部署

> **對應**：GitHub issue #7／#8／#9、`arch.md` **Phase 15**、
> 規格與規劃見 `specs/006-production-launch-readiness/`。
> **新增日期**：2026-08-13。

### 為什麼需要

前五個 Feature 蓋出了一個完整的站，**但它至今只在一個地方跑過：開發者的本機、掛在網域根目錄**。
三個 issue 各自堵住一條上線路徑，且**互為前提**：

| Issue | 主題 | 不做的後果 |
|---|---|---|
| #7 | 正式環境資料防呆 | `npm run db:seed` 的 `clearAll()` 會清空 23 張表。誤跑一次即真實資料全滅，**且無復原路徑** |
| #9 | 子路徑相容 | **擋在 #8 之前**。未完成則映像建置出來也只能掛在網域根目錄 |
| #8 | 容器化與自動部署 | 沒有可重現的執行環境，自動部署只是把手動步驟搬到別處跑 |

### 範圍（五刀，6-A 與 6-B 可並行）

| 刀 | 內容 | 前置 |
|---|---|---|
| **6-A** 資料防呆 | seed 放行守衛（allowlist）、`npm run db:clear-content`（列數報表 → 非互動拒絕 → 名稱確認 → 交易清除 21 張、保留 `Category`／`Tag`）、空庫四頁整合測試、README 區分開發／正式 | 無 |
| **6-B** 子路徑相容 | `deploy/deployment.md` §9 的五項 + `src/lib/apiUrl.ts` + `layering.test.ts` 字面量稽核 + **第五套測試** | 無 |
| **6-C** 容器化 | Dockerfile 三 stage、compose 四服務（`cron` 另掛 **`.:/app/deploy-cron:ro`**——`deploy/` 不在建置脈絡內，`COPY` 拿不到；**來源是 `.` 不是 `./deploy`**，compose 的相對路徑以 compose 檔所在目錄為基準，而該檔就在 `deploy/` 之內，寫 `./deploy` 會指到不存在的 `deploy/deploy` 並讓 Docker 自動建一個空目錄掛進去，*裁示 2026-08-15*）、啟動期 `migrate deploy`、**分類改由冪等 migration 建立**、每日備份 + 異地上傳、**四服務逐一設容器日誌上限（`max-size: 10m`／`max-file: 3`，FR-094a）**、**`deploy/` 下的腳本一律以 `sh <路徑>` 呼叫**（`:ro` 掛載補不回執行位元，`core.fileMode=false` 又讓版控不帶位元） | 6-B |
| **6-D** 自動部署 | `ci.yml`（`db:generate` + 三綠 + 五套測試，共十一步）／`deploy.yml`（**`workflow_run` 於 `ci.yml` 成功後**觸發、首步斷言 `uname -m`）／`rollback.yml` ＋ **`deploy/deployment.md` 的「回滾」章節**、破壞性偵測（fail-safe；**`detect` job MUST 跑 self-hosted**——`<base>` 來自正式主機的 `docker inspect`、**checkout MUST `fetch-depth: 0`**、**pathspec MUST 帶 `novelsite/` 前綴**）、健康檢查輪詢、雙軌失敗通知、映像保留策略 | 6-C |
| **6-E** 人工清單與文件同步 | A 區 19 項一次性 + B 區 11 項週期性，**每項寫明「沒做會怎樣」**；失效原文取代而非並存 | 6-A～6-D |

**schema 增量為零**：無新 model、無欄位異動、無新索引、無新的雙軌分歧點。
唯一的 migration 是 6 筆 `Category` 的冪等 `INSERT`。

### 五項與上游不同的裁示（2026-08-13，已回寫 `arch.md`／`deploy/deployment.md`）

1. **排程載體改為獨立 `cron` 容器**（原文：主機 crontab／`docker compose exec -T`）——
   主機 crontab 不在 `compose.yml` 裡，「一道指令拉起」的站台排程會是空的，
   而漏做的症狀是統計與排行靜止不動、**無任何錯誤訊息**。
2. **compose 的 `novelsite` 服務不得有 `build:` 區塊**（原文有）——
   有它時 `up -d` 會隱式重建，「回滾到舊 SHA」會變成「用舊原始碼重建一個新映像」，
   **而且會成功、不會有錯誤訊息**。
3. **參考分類由 migration 建立**（原文：「此步驟需另行處理」）——
   「另行處理」是一道要有人記得執行的步驟，漏了的症狀是分類頁一片空白、無錯誤。
4. **seed 防呆由告誡升為程式守衛，且 MUST NOT 只看 `NODE_ENV`** ——
   最危險的情境是正式主機上一個手開的殼層，那裡 `NODE_ENV` 是空的。
5. **備份的遠端保留由 bucket 生命週期規則承擔**（原文只寫「保留 7 份」未指明執行者）——
   上傳用的 PAR 權限為只寫，**列不到也刪不掉**；要腳本刪遠端就得換成可讀寫憑證，
   等於讓一組外洩憑證能刪光全部備份。

### 完成定義（Definition of Done）

- [x] 六項綠燈：`build`／`lint`／`tsc --noEmit` ＋ **五套測試循序全綠**
      —— 2026-08-15 實跑：`npm run build`／`npm run lint`／`npx tsc --noEmit` 全綠；
      `npm run test:all` 離開碼 0——**單元 32 檔 482 案／整合 77 檔 608 案／
      a11y 3 檔 42 案／E2E 8 案／子路徑 1 檔 4 案**
- [x] 正式環境設定下 `db:seed` 100% 失敗且資料庫零列變動（SC-015）
      —— 判定實作於 `prisma/seedGuard.ts`，由 `seed.ts` 在**任何 prisma 呼叫之前**呼叫
      （故「零列變動」是結構上成立，不是靠測試觀察）；真值表由
      `tests/unit/seed-guard.test.ts` 逐格鎖住（2026-08-15 全綠）
- [x] 空資料庫上首頁／排行／搜尋／分類四頁皆正常回應（SC-016）
      —— `tests/integration/empty-database.test.ts`（2026-08-15 隨整合套件 608/608 全綠）
- [x] 帶前綴時未登入轉址 100% 指向本站登入頁、**26 處**資料請求成功率 100%（SC-017、SC-018）
      —— *裁示（2026-08-15）*：原文寫 19 處。**19 是漏數的結果**，它來自只看得見
      `fetch('/api/…')` 字面量的樣式，漏掉 3 處常數（`lib/reader/**`）與 4 處經 helper
      轉手（`ReviewSection.tsx`）。**照 19 驗收會讓那 7 處帶著同樣的 bug 通過**——
      它們在子路徑下一樣打到別的站，而且錯誤處理全是靜默的 `catch`。
      稽核規則已一併改為「任何 `/api/` 字面量 MUST 是 `apiUrl(` 的引數」（`arch.md` §5.7）
- [x] **未設前綴時既有四套測試通過數與本階段開始前完全相同**（SC-019、FR-078a）
      —— 2026-08-15 驗證：`tests/globalSetup.ts` 未被修改，且 `tests/integration/**`、
      `tests/a11y/**`、`tests/e2e/**` 無任何檔案異動（結構上不可能改變通過數）；
      實跑 integration 608／a11y 42／e2e 8 全綠。單元套件因 T027 稽核區塊 +4（450 → 454）。
      **收尾覆核（2026-08-15，T058）**：`npm run test:all` 全套再跑一次，
      integration 608／a11y 42／e2e 8 **與上列完全相同**；單元套件為 482
      （T043 的破壞性偵測 20 案為本階段新增，**新增測試不等於既有測試改變**——
      SC-019 管的是「既有四套的通過數不因子路徑改動而變」，而三套逐案相同即為該條的證據）
- [x] 空庫首次啟動後參考分類 6 筆存在，人工步驟數 0（SC-026）
      —— 2026-08-15 於容器實測：全新 `pgdata` 上僅由 entrypoint 跑 `migrate deploy`（**未 seed**），
      `Category` 6 筆且 `Novel` 0 筆；重跑同一份 migration SQL 仍是 6 筆（`ON CONFLICT DO NOTHING` 生效）。
      兩軌的值另由 `tests/unit/category-seed-parity.test.ts` 逐欄鎖住，
      PostgreSQL 軌整合測試 608/608 亦已補跑
- [x] 破壞性結構異動攔截率 100%（含判不出來者），向後相容者要求核准比率 0%（SC-025）
      —— `novelsite/scripts/detect-destructive-migration.ts` + `tests/unit/detect-destructive-migration.test.ts`
      **20 案全綠**（2026-08-15）：8 破壞性／5 安全／`DO $$` 判不出→破壞性／未閉合引號→破壞性／
      **空集合→安全**與**migrations 目錄不存在→破壞性成對存在**／`--base` 缺漏→破壞性／
      本階段實際的 `6a_seed_categories`→安全。
      **成對那兩案在實作當下就抓到一次真的 bug**：測試最初把 repo 根算成 `novelsite/`，
      目錄斷言立刻紅——若只驗「空集合→安全」，同一個路徑錯誤會**完美通過測試**，
      而它在正式環境的表現是每一個破壞性 migration 都被判為安全並自動套用
- [x] A 區 19 項／B 區 11 項人工清單就位，每項皆載明未執行的後果（**FR-095～FR-097**）
      —— 2026-08-15 交付於 `deploy/deployment.md` §6.1／§6.2，另 §6.1 附「已被消滅、MUST NOT 再列」
      三項排除表（分類／主機 crontab／映像庫）；`manual-steps.md` 檔首已標明其與 §6 的關係
      （**MUST NOT 並存為第二份清單**）
      —— *裁示（2026-08-14 第三輪）*：原文把這一項標為 SC-024。**改為對應 FR-095～FR-097**，
      SC-024 移入待外部條件。理由見下段
- [x] `deploy/deployment.md` 失效原文**已取代而非並存**（FR-098）
      —— 2026-08-15 逐處取代：檔首 ⛔ 子路徑警語、§3.4（seed 防呆→程式守衛）、
      §3.7（遠端保留→bucket 生命週期規則）、§3.8（內嵌的三份設定→指向真實檔案 + 四處差異表）、
      §4（建置期／執行期／流程側三分界）、§6（單一檢查清單→A／B 兩區）、§8（三列結案）、
      §9（五項標為完成並指向 `npm run test:basepath`）
- [x] **`deploy/deployment.md` 有「回滾」章節**（§10，2026-08-15 新增），載明 (a) 已套用的結構異動不隨之回復、
      (b) 主機上的手動備援步驟（FR-091；**SC-028 的後半句只能由文件成立**，
      `rollback.yml` 只覆蓋「流程平台可用」那一半）

**待外部條件（MUST NOT 勾選，憲章第 IV 條）**：SC-020（乾淨機器一道指令）、
SC-021（重開機自行恢復）、SC-022（一次真實合併全自動）、SC-023／SC-028（回滾實測）、
SC-027（異地備份的實際還原）、**SC-024（由一位未參與開發的人依清單實際走一次前置作業）**
—— **六項**皆需一台已開通的 Oracle ARM 主機與其前置設定。

> **SC-024 為第三輪補入（2026-08-14，出處 `specs/006-production-launch-readiness/`
> `/speckit-analyze`）**：原文列五項，且把上方完成定義的「A／B 兩份人工清單就位」
> 直接標為 SC-024 可勾。但 SC-024 的條文是「**一位未參與開發的人**依清單，
> 在不詢問開發者的情況下完成上線前置作業」—— 它驗的是**清單夠不夠用**，
> 不是清單存不存在。清單寫得完整但漏了一個隱含前提時，
> 兩者在文件上長得一模一樣，只有真的有人照著走一次才會現形。
> 以「文件寫好了」勾掉它，與憲章第 IV 條禁止的「以腳本寫好了充當完成」是同一種錯。
> 文件側的交付照常於 6-E 完成並可勾，只是它對應 FR-095～FR-097。

### 測試

| 層級 | 新增 |
|---|---|
| 單元 | `seed-guard`（放行真值表）、`category-seed-parity`（兩軌 migration 與 `mockData` 八欄一致）、`detect-destructive-migration`（**8** 破壞性 + 5 安全 + `DO $$` 判不出 + 空集合 + **migrations 目錄不存在**）、`layering` 擴充（FR-075 字面量稽核） |
| 整合 | `empty-database`（四頁空狀態；`afterAll` MUST 重新 seed） |
| **第五套（新）** | `tests/basepath/`：首頁可達、轉址目的地帶前綴、資料請求可達（且不帶前綴為 404）、Cookie `Path` 範圍與登出一致 |

> **`detect-destructive-migration` 的案例數修正（2026-08-14 第三輪，出處
> `specs/006-production-launch-readiness/` `/speckit-analyze`）**：原文寫「**6** 破壞性」。
> 第二輪已把破壞性語句擴為九種（補入 `UPDATE`／`DELETE`）並定案為「九種扣掉另計的
> `DO $$` ＝ **8** 案例」，但只回寫到 `contracts/internal-modules.md` 與 `tasks.md`，
> **本表仍留著舊數字**。照 6 去點的人會少寫 `UPDATE`／`DELETE` 兩案，
> 而那兩種正是**以原生 SQL 撰寫資料搬移**最常見的形態 ——
> 漏測的症狀是**破壞性異動被自動放行**。
>
> **另新增「migrations 目錄不存在 → 破壞性」一案**，且它 MUST 與既有的
> 「空集合 → 安全」**成對存在**：pathspec 或 cwd 寫錯時 `git diff` 不報錯、只回空集合，
> 兩者輸出完全相同，於是那個 bug 會**完美通過只驗空集合的測試**，
> 而它在正式環境的表現是破壞性 migration 全數自動套用（規格 SC-025 前半句失守）。

**`tests/globalSetup.ts` MUST NOT 修改**——第五套用**專屬** globalSetup，
改共用那一支就會改到整合與 a11y 的啟動流程，與 SC-019 直接相斥。

### 風險

| 風險 | 對策 |
|---|---|
| **子路徑五項的失效症狀只在正式環境現形，且表現為「頁面怪怪的」而非錯誤** | FR-078 的第五套測試與 FR-075 的稽核**不是加分項，是防止回歸的唯一手段** |
| **映像不經外部映像庫，只存在正式主機** | 主機滅失即同時失去服務與回滾能力。緩解只有異地備份，以及「原始碼在 GitHub、可重新建置」 |
| 建置就地於正式主機，佔用資源使站台變慢 | **明示接受**。該機 MUST 維持 4 OCPU / 24 GB —— 1 GB 機型上 `next build` 已知會失敗 |
| **破壞性偵測誤判即漏擋** | 採 allowlist（不確定即視為破壞性），且該邏輯 MUST 有自己的單元測試（含判不出來的案例） |
| **健康檢查失敗不自動回滾 → 故障持續時間＝多久有人看到通知** | 明示接受的取捨。故雙軌通知的**各自實收驗證**列入一次性前置設定，不是選配 |
| self-hosted runner 的前提是 repo 為私有 | 若日後轉為公開，任何 PR 的程式碼都會在正式主機上執行 —— **該決策 MUST 重新評估** |

---

## FEAT-7　作者批次上傳章節

> **對應**：GitHub issue #14、`arch.md` **Phase 16**、
> 規格見 `specs/007-batch-chapter-upload/`。
> **新增日期**：2026-08-19。
> **相依**：FEAT-3（作者寫入流與授權守衛）。與 FEAT-4～6 無相依，可並行。

### 為什麼需要

FEAT-3 讓作者「能寫」，但寫入的**唯一途徑是逐章**：
`createChapterAction` 一次產生一章（`src/app/author/actions.ts`），
正文靠人工貼進 `/author/editor/[chapterId]` 再 `saveChapterDraftAction`。
一部長篇動輒數十至數百章，等於同樣的三步要重複數百次 ——
而絕大多數作者的稿子**本來就已經是一批 `.md` 檔**。

資料模型上的條件早已具備，本階段**不動 schema**：

| 既有資產 | 位置 | 本階段如何沿用 |
|---|---|---|
| `Volume` / `Chapter` | `prisma/base.prisma:128` / `:143` | 章節本來就掛在卷底下，「批次上傳某一卷」對得上既有結構 |
| `ChapterContent.bodyMarkdown` | `prisma/base.prisma:175` | 正文分表，格式為 Markdown，匯入直接寫入 |
| `第N章_標題.md` 檔名慣例 | `prisma/seed.ts` 的 `CHAPTER_FILE_RE`、`prisma/seed-data/<作品 id>/正文/` | 批次上傳沿用同一組慣例，不另創格式 |
| 授權守衛 | `src/lib/auth/guard.ts` | `requireAuthorForAction()` + 服務層擁有權判定，不新增角色或權限模型 |

### 範圍

| 項目 | 內容 |
|---|---|
| **上傳形式** | 多檔選取**與**整個資料夾選取，同一入口皆支援；`.zip` **排除於範圍外** |
| **解析** | 章號與標題**一律自檔名**（`第N章_標題.md`）；不符者於預覽標示錯誤，不做推測 |
| **編碼** | UTF-8，含 BOM 者去除 BOM；無法解讀者標示為編碼錯誤，不以替代字元靜默寫入 |
| **預覽** | **於瀏覽器端產生**：前端讀檔解析，伺服器只提供**該作品**既有章號供比對（唯一鍵是 `@@unique([novelId, number])`，比對範圍是作品不是卷），不接收正文、不暫存。逐檔列出來源檔名、章號、標題、字數、判定結果，**並附摘要列**（可匯入／正文為空／已略過／錯誤與衝突各幾筆）。正文只在確認後傳一次；伺服器寫入時**全量重驗**，解析規則以純函式前後端共用 |
| **空正文** | 判定為**警告**而非錯誤，不阻擋匯入（現行 `createChapter` 建立的本來就是空章節） |
| **章號跳號** | 合併後章號序列不連續即以**警告**標示並計數，不阻擋（抓 `第100章` 誤打成 `第10章`）。**跨卷交錯不檢查** |
| **進行中／逾時** | 確認後鎖住送出鈕；上傳顯示百分比、寫入顯示不確定進度。逾時或斷線**不自動重試**，改重查章號清單判定實際結果，查不到時措辭為「尚未看到新章節」而非「匯入失敗」 |
| **紀錄** | 每次嘗試一行結構化 stdout（發起者／作品／卷／檔案數／位元組／結果／耗時），成功與失敗皆記；**不進 DB、不含正文與標題與檔名** |
| **淨化** | 正文 MUST 過與單章相同的 `sanitizeBody`（濾控制字元、保留 `	`／`
`／`
`、不 trim）；不另訂、不略過 |
| **衝突** | 批次內重複或與既有章節重複，**任一即整批中止**；不提供跳過或覆寫 |
| **交易** | 全有全無；失敗不留半套資料。成功後同一交易內呼叫既有的 `refreshNovelCounters` 與 `touchNovel`。**⚠️ `chapterCount`／`wordCount` 不會因匯入而變動，那是正確結果**（analyze 修正 2026-08-20，見下方裁示第 13 項）|
| **匯入後狀態** | 一律 `draft`、`scheduledAt` 為 `null`；排程與發佈走 FEAT-4 既有路徑 |
| **上限** | **1000 檔／單檔 1 MB／總計 50 MB**，章號 1–9999。前端與伺服器皆判定；**總大小**依 `Content-Length` 於緩衝完整請求前即拒絕（缺 `Content-Length` 者亦拒絕），**檔案數**則於解析 multipart 後拒絕（analyze 修正 2026-08-20：multipart 無宣告 part 數的標頭，緩衝前判定檔案數沒有著力點；總量已由 `Content-Length` 封頂。出處 research R-11）。單章既有長度上限不放寬 |
| **非 `.md` 檔** | **級別隨選檔模式而異**（FR-001c，analyze 補述 2026-08-20）：資料夾模式為「已略過」（不阻擋）、**多檔選取模式為錯誤（阻擋）**。多檔模式下作者是明確點選了該檔，靜默略過會讓「選了幾檔」與「匯了幾章」對不起來 |
| **錯誤訊息** | 全部繁中。**逐檔判定類** MUST 指名來源檔；**授權類與請求格式類**沿用既有通用文案且 **MUST NOT 指名來源檔**（FR-019，analyze 修正 2026-08-20：原寫「所有錯誤訊息皆須指名來源檔」，與「找不到」須逐字不可區分直接衝突） |
| **限流** | **不另設**，沿用既有政策（限流對象為未登入可達入口）。護欄因此完全落在擁有權判定與三項上限 |

**不在範圍**：`.zip` 上傳、匯出（反向路徑）、預覽畫面上直接編輯章號或標題、
匯入時指定排程發佈時刻、`.docx`／`.txt` 格式轉換。

### 技術落點與切分（`/speckit-plan` 定案，2026-08-20）

規劃產出見 `specs/007-batch-chapter-upload/`（`plan.md`／`research.md`／`data-model.md`／
`contracts/`／`quickstart.md`）。**不新增任何套件、不新增 migration。**

| 決定 | 內容與理由 |
|---|---|
| **走 Route Handler，不走 Server Action** | `POST /api/author/volumes/{volumeId}/chapters/import`。`serverActions.bodySizeLimit` 是 `next.config` 的**全域**設定，為匯入調高等於讓站上每個 Server Action 都變成大體積入口；且 Server Action 拿不到原始 `Request`，無法在緩衝前依 `Content-Length` 拒絕。代價是 Route Handler 無框架 CSRF 保護，故第一行 MUST 為 `assertSameOrigin` |
| **預覽不新增端點** | `AuthorManageChapter` 已含 `number` 與 `title`，作品管理頁的 client 元件本來就拿得到。逾時後重查以 `router.refresh()` 完成 |
| **單一交易 + `createMany` × 2 表** | 逐筆 `create` 在 1000 章是 2000 次來回，必然撞上 Prisma 預設 5 秒 timeout；全有全無又不允許拆交易。故 `withTransaction` 增加**選填**的 options（既有 **24 個呼叫端**一行不改；數字經 2026-08-20 analyze 實測更正，原記 12） |
| **`countWords` 搬到 `validation/common.ts`** | 前後端要共用同一份字數規則，而 `chapterService.ts` 首行是 `import 'server-only'`。原處 re-export，既有 import 路徑與測試不變 |
| **匯入 schema 不複用 `bodyMarkdownField`** | 該欄位帶非空 refine，會把「空正文是警告」升級成錯誤，正是預覽與寫入判定不一致的來源 |
| **`TextDecoder` 必須 `fatal: true`** | 非嚴格模式會把壞位元組換成 U+FFFD 並靜默成功 |
| **紀錄用新函式，不改 `logSecurityEvent`** | 後者的四欄位形狀被其單元測試鎖死。白名單組物件的手法照抄 |
| **上傳進度用 `XMLHttpRequest`** | `fetch()` 沒有上傳進度事件 |
| **超限用 400 `VALIDATION_ERROR`，不新增 `ErrorCode`** | `ErrorCode` 與狀態碼對照表是同一型別的兩半，新增會波及所有端點；FR-018 要的是訊息含實際值與上限值，不是特定狀態碼 |
| **部署面：於版控的 `deploy/Caddyfile` 設 `request_body { max_size 55MB }`** | **這是硬化，不是修復**（analyze 修正 2026-08-20）。原文寫「未調整的症狀是代理層直接回 413」，**該前提不成立** —— **Caddy 沒有預設的請求主體上限**（`request_body` 是 opt-in；1 MB 預設是 **nginx** 的 `client_max_body_size`，本站不是 nginx），不設定時請求會被原封轉給應用，照原文除錯會去查一個永遠不會發生的 413。設它是為了把上限釘在代理層。**55MB ＝ 50 MB + multipart 開銷餘裕，MUST NOT 設成正好 50MB**。落點是版控檔而非 `deploy/deployment.md` §6 人工清單 —— 清單裡的字與檔案裡的設定沒有機制保持一致 |

**四刀（順序即相依）**

| 刀 | 內容 | 前置 |
|---|---|---|
| **7-A** 純函式 | `chapterImport/parse.ts`、`validation/chapterImport.ts`、`countWords` 搬家；3 支單元測試 | 無 |
| **7-B** 伺服器寫入 | repository 兩函式、`withTransaction` options、`chapterImportService`、Route Handler、`chapterImport/log.ts`；3 支整合測試（雙軌） | 7-A |
| **7-C** 前端面板 | `BatchImportPanel`、掛入 `NovelManageView`、XHR 進度、逾時重查、a11y | 7-B |
| **7-D** 收尾 | E2E 一條、`arch.md`／`features.md` 勾選與執行紀錄 | 7-A～7-C |

7-B 完成時，功能已可由整合測試證明成立 —— 7-C 加的是作者看得見的那一面。

### 與 issue 初稿不同的裁示（2026-08-19／08-20，已回寫 `arch.md` Phase 16）

**A 組 —— `/speckit-specify` 階段（2026-08-19），三項**

1. **上傳形式取「多檔選取 + 資料夾選取」，`.zip` 排除**（issue 原文將三者並列待選）——
   `.zip` 需伺服器端解壓，得另行處理 zip bomb、解壓後總大小上限與 **zip 檔名編碼**
   （zip 的檔名編碼常非 UTF-8，中文章節檔名會直接壞掉）。三者都與「省下逐章貼上」無關。
2. **章號與標題一律自檔名解析，不做推測**（issue 原文並列「檔名解析」與「排序後接續最大章號 ＋
   正文首個 Markdown 標題」）—— 字典序排序會讓「第10章」落在「第1章」與「第2章」之間，
   而既有 seed 正文檔內**根本沒有 Markdown 標題行**：兩種推測在本專案的實際資料上都會錯，
   錯了之後作者得在數百章裡找出哪一章被放錯位置。
3. **章號衝突一律整批中止，不提供跳過或覆寫**（issue 原文並列三種策略）——
   覆寫會改動既有（含已發佈）章節且無還原路徑；跳過會讓「選了幾檔」與「匯了幾章」不一致。
   兩者都把核對成本丟回給作者，與 issue 自身的驗收條件「不留下半套資料」也難以並存。

**B 組 —— `/speckit-clarify` 階段（2026-08-20），五項**

4. **預覽在瀏覽器端產生，伺服器不持有正文也不暫存**（issue 的「預覽」欄未指定落點）——
   另兩種作法各有代價：「送兩次」讓同批檔案走兩趟網路，「伺服器暫存」引入暫存表、TTL 與清理作業。
   代價是解析邏輯前後端都要有，故**解析規則 MUST 只有一份純函式實作供兩端共用**：
   各寫一份必然漂移，症狀是「預覽說可以匯入、送出卻被拒」，且不會有任何測試變紅。
   伺服器寫入時仍 MUST 全量重驗 —— 前端解析是體驗，伺服器重驗才是正確性依據。
5. **上限定為 1000 檔／單檔 1 MB／總計 50 MB，章號 1–9999**（issue 只寫「需要上限」未給值）。
   1000 檔涵蓋整部長篇而非只有單卷；單檔 1 MB 是因單章正文上限 100,000 字元、中文 UTF-8 約 300 KB；
   總大小 50 MB 是因典型章節約 6–15 KB、1000 章約 15 MB，皆留三倍餘裕。
   **總大小 MUST NOT 由 1000 × 1 MB 推導**：它是獨立護欄，正是要擋「每檔都貼著單檔上限」。
   **且 MUST 在緩衝完整請求前就依宣告長度拒絕** —— 先收完 50 MB 再說超限等於沒有上限。
6. **正文 MUST 走與單章完全相同的 `sanitizeBody`**（規格初稿的「原樣保存」與「逐字相同」
   和既有寫入端淨化互相牴觸）—— 批次是本階段新開的寫入口，略過淨化的症狀只出現在批次路徑，
   單章的既有測試照樣全綠。驗收語句因此改為「**經同一組淨化後**逐字相同」。
7. **空正文檔案為警告而非錯誤，放行建立**（規格初稿寫「比照現行單章行為」，是個未定的轉指）——
   現行 `createChapter` 建立的本來就是空章節，擋掉會使批次比單章嚴格。
   但**預覽 MUST 有摘要列**，一筆警告在上千列裡必然被滑過去。
8. **不另設頻率限流**，沿用 `arch.md` §7.6 既有政策（限流對象為未登入可達入口）——
   為單一寫入動作破例會使它成為全站唯一例外，而測試該例外需要可重置或可停用的限流機制，
   那正是 §7.6 明文禁止的。**代價 MUST 被明白記下：護欄完全落在擁有權判定與三項上限，
   沒有第二層可以擋**，兩者不得放寬或延後。殘留風險（已登入的擁有者反覆送出貼近上限的批次）
   已知並接受；重新評估的觸發條件為「單一作者短時間內反覆送出接近上限的批次」，
   屆時處置是在既有限流層加規則，而非放寬三項上限。

**C 組 —— `/speckit-clarify` 第二輪（2026-08-20），四項**

9. **章號比對範圍為作品而非卷**（第一輪規格誤寫為「該卷既有章號清單」）——
   唯一性約束是 `@@unique([novelId, number])`，只比對該卷會漏掉與其他卷的衝突，
   而漏掉的下場是預覽說可以匯入、送出時被資料層擋下。
10. **章號跳號為警告、跨卷交錯不檢查**（issue 與初稿皆未涵蓋）——
    合併後序列不連續即警告並於摘要列計數，目的是抓 `第100章` 誤打成 `第10章`；
    **不阻擋**，因為分批匯入（先匯 51–100、日後補 1–50）是正當用法。
    跨卷交錯需伺服器一併回傳每個章號所屬的卷，把預覽介面撐大，價值與成本不成比例。
11. **每次匯入嘗試記一行結構化 stdout，成功與失敗皆記**（既有作法只在未預期錯誤記錄）——
    **與第 8 項的不設限流互為前提**：那一項寫下的重新評估條件是「單一作者短時間內反覆送出
    接近上限的批次」，沒有這行紀錄，該條件無人看得到，等於寫了一個永遠不會被觸發的條件。
    不進 DB（schema 增量維持為零），且 MUST NOT 含正文、標題或檔名 —— 那是內容外洩，不是稽核。
12. **逾時不自動重試，改重查章號清單判定實際結果**（初稿只寫「連線中斷不得留下部分章節」）——
    伺服器交易可能已成功，自動重試只會整批撞號中止，作者看到的是與實際狀態無關的錯誤。
    重查用的是預覽階段那個既有介面，複用成本近乎零。
    **但查不到時措辭 MUST 為「尚未看到新章節，請稍後重新整理確認」，MUST NOT 斷言「匯入失敗」**
    —— 全有全無的交易在 commit 前本來就查不到，斷言失敗會誘使作者重送。
    確認後 MUST 停用送出控制項：上界情境耗時可觀，第二次點擊會送出第二個完整批次。
13. **匯入不會使 `chapterCount`／`wordCount` 變動，而那是正確結果**
    （`/speckit-analyze` 修正，2026-08-20）—— 初稿與 `arch.md` Phase 16 第 8 項原寫
    「匯入成功後 MUST 於同一次作業內**回填**作品的章節總數與總字數」，字面讀是「數字要變」。
    **為什麼原文行不通**：`refreshNovelCounters`（`src/lib/repositories/novels.ts:366`）的
    `where` 是 `{ novelId, status: 'published' }`，函式註解明寫「只計已發佈章節」，
    而匯入產出一律 `draft`（第 5 項）。照原文驗收，該驗收條件恆為假；
    而讓它變真的唯一作法是改掉 published-only 語意 —— 那會**靜默改動單章儲存、發佈、下架、
    刪除、排程發佈共 5 條既有寫入路徑**的計數行為。參照：單章的 `createChapter` 正因如此
    **不呼叫**它。**仍於同一交易呼叫它**是因為它「依實際資料重算」而非「加 N」，
    成本一次 aggregate，換的是計數永不與明細脫節。
    **MUST NOT 為了讓數字動起來而改它的語意，亦 MUST NOT 另寫一套只給匯入用的計數規則** ——
    兩者都會讓「作品字數」在站上有兩種意思。計數會在作者日後逐章發佈時，
    由 FEAT-4 既有的 `publishChapter` 路徑遞增。出處：spec FR-013／FR-013a、data-model §1.4。
14. **請求格式驗證與來源比對 MUST 早於身分驗證**（`/speckit-analyze` 補述，2026-08-20，FR-015a）——
    兩者都不需要工作階段，且 `Content-Length` 那一步是「緩衝完整內容之前」的唯一著力點。
    其結果是**未登入者對格式不合的請求得到 400 而非 401**，此為預期行為，
    MUST NOT 視為授權順序（身分→角色→擁有權）的違例：該順序規範的是三道**授權**判定彼此的先後。

15. **第五輪 `/speckit-analyze` 的四項修正（2026-08-21）** —— 四項的共同病徵是
    **「規格宣告了一件實作不出來、或測得出來卻測不到東西的事」**，四項都會以
    「測試全綠但需求沒實現」收場：
    (a) **`DIRECTORY` 判定改為「檔案位於子目錄內」**。**原文行不通**：資料夾選取以
    `<input type="file" webkitdirectory>` 實作，其 `FileList` **只含檔案、不含目錄項目**，
    且解析結果的六個欄位沒有一個能表達「這是目錄」——**型別上就回不了那個值**。
    照原文，該代碼的對照測試只能餵一個瀏覽器不可能給出的假輸入。改判子目錄內的**檔案**後，
    「作者選了作品根資料夾、章節其實在 `卷一/` 底下」這個真的會發生的情況才有判定。
    連帶：解析結果增加 `relativePath` 欄位。出處：`research.md` R-13。
    (b) **章號缺號只在摘要列，不再是一種逐列判定**。**原文行不通**：原本 `NUMBER_GAP`
    同時是逐列代碼又註明「摘要列層級」，兩種說法並存 —— 缺號是**序列**的性質，
    「第 21–99 章缺號」講的是一段**不存在**的區間，掛不到任何來源檔上，
    「哪一列該掛它」無人答得出來，而逐列驗收又要求它有一案。逐列代碼因此由 13 種減為 **12 種**。
    (c) **逐列判定必須有明確優先序**（先命中先勝、命中即停）。**原文沒寫，而那不夠**：
    一列同時命中多項是常態（1.2 MB 又與既有撞號、空正文又在批次內重複），
    順序未定時回哪一個是實作者當下的選擇，而每一個驗收案都只餵單一條件 ——
    **任何順序都會綠**，作者卻可能拿到一個對他沒用的原因。
    (d) **匯入 schema 只驗形狀，長度與內容判定一律歸判定函式**；且
    **「取消不留暫存資料」的自動化驗收自整合測試改到 E2E**。**兩者的原文都行不通**：
    前者讓同一件事有兩份判定（一份回 Zod issue 只帶陣列索引、一份回帶檔名的判定結果），
    誰先跑、訊息用誰的沒人寫，而先跑的那份決定作者看到什麼；
    後者的整合層**沒有前端、預覽根本不會產生**，「走完預覽但不送出」在那裡等於什麼都沒做，
    「斷言資料庫零新增列」**恆為真、永遠不會變紅**，包括它自稱要防的那個情境。
    有鑑別力的斷言是「確認之前一個 `POST` 都沒發出」，而那要看得到瀏覽器。
    出處：`specs/007-batch-chapter-upload/contracts/internal-modules.md` §1／§2、
    `data-model.md` §2.2、`tasks.md` T005／T037／T045b。

**治理同步（`/speckit-analyze`，2026-08-20）**：本階段查出憲章「開發流程 → 規劃文件」條款
指名的 `novelsite/plan.md` 與 `novelsite/nextstep.md` 自 FEAT-2 起已非逐階段更新勾選與執行紀錄
的地方 —— 實際承載的是 `arch.md` 與**本檔**。憲章據此 **PATCH 至 v1.0.3**，改為指名這兩份；
要求本身（勾選狀態 + 執行紀錄 + 日期）一字未改。兩份舊文件皆未廢棄
（憲章「上線前必經」仍引用 `nextstep.md` 的 H-1／H-2／H-3），但不再是逐階段更新的工作清單。

### 完成定義

- [X] 作者可在某一卷底下一次上傳多個章節檔並建立對應章節（多檔選取與資料夾選取皆可）
- [X] 寫入前提供預覽，作者確認後才實際建立；取消不留下任何暫存資料
- [X] 檔名不符慣例、章號無效、編碼無法解讀、標題或正文超長、批次內重複、與既有章節衝突、單檔超限**七類**逐檔判定問題皆有明確繁中訊息並指名來源檔；授權類與請求格式類沿用既有通用文案且不指名來源檔（裁示第 14 項旁的 FR-019 修正）。*（第四輪 analyze 修正 2026-08-21：原寫「四類」，漏列章號無效、標題或正文超長、批次內重複三類 —— FR-019 與 `contracts/batch-import-api.md` §1.3 一直都是七類。少列的那三類不會有人去補訊息，因為完成定義沒要求。）*
- [X] 非 `.md` 檔在**資料夾模式**列為「已略過」（不阻擋）、在**多檔選取模式**列為錯誤（阻擋），兩種模式各有驗收（FR-001c）；**子目錄內的檔案於資料夾模式列為「已略過（位於子目錄）」且檔名照樣出現在清單上**（裁示第 15 項 (a)）
- [X] 任一失敗情境後，該卷章節列數與 `Chapter`／`ChapterContent` 兩表列數與匯入前完全相同（SC-004；第二輪 analyze 修正 2026-08-20：原判準寫「作品 `chapterCount`／`wordCount`」，在裁示第 13 項之後該子句於成功情境同樣成立，恆為真、測不出東西）
- [X] **成功**匯入後 `chapterCount`／`wordCount` 亦與匯入前相同（published-only 語意，裁示第 13 項）；將其中一章以既有單章路徑發佈後，兩者才隨之增加
- [X] 未登入／讀者角色／非擁有者三種身分皆被拒，且不產生任何資料列
- [X] 跨站來源比對與請求格式驗證（`Content-Type`／`Content-Length`）**皆早於身分驗證**，兩者各有自動化驗收：跨站 + 未登入回 403、缺標頭 + 未登入回 400（皆非 401，裁示第 14 項的 FR-015a）
- [X] 正文經與單章相同的 `sanitizeBody`；不含控制字元的稿件比對結果為逐字相同
- [X] 三項上限（1000／1 MB／50 MB）與章號範圍（1–9999）於前端與伺服器皆生效；**總大小**依 `Content-Length` 於緩衝完整請求前即拒絕（缺 `Content-Length` 者亦拒絕），**檔案數**則於解析 multipart 後拒絕（FEAT-7 analyze 修正 2026-08-20：multipart 無宣告 part 數的標頭，緩衝前判定檔案數沒有著力點；總量已由 `Content-Length` 封頂。出處 research R-11）
- [X] 章號缺號以警告標示並於摘要列計數，且不阻擋匯入
- [X] 每次匯入嘗試皆可在伺服器紀錄找到對應的一行（**恰 9 欄**，含身分驗證前的提前返回 —— 那時 `actorId`／`novelId` 為 `null` 但仍照常輸出），且該行不含正文、標題或檔名
- [X] 前端逾時而伺服器實際成功時，作者最終看到的訊息與資料庫狀態一致，且未送出第二個批次
- [X] 單元測試涵蓋：檔名解析、章號指派與衝突判定、權限拒絕、上限判定、空正文與缺號警告
- [X] `npm run build`、`npm run lint`、`npx tsc --noEmit` 全綠

**執行紀錄（2026-08-22，FEAT-7 T001～T054）**：上列 **15 項全部完成**。

- **閘門**：`npm run build`（以 `MAIL_MODE=console`，理由見下）／`npm run lint`／
  `npx tsc --noEmit` 三綠；單元 36 檔 542 案、整合 80 檔 632 案、a11y 4 檔 44 案、
  E2E 13 案（chromium 11 + firefox 1 + webkit 1）、basepath 1 檔 4 案，全過。
- **雙軌（`arch.md` §10.5）未完成**：SQLite 軌 80 檔 632 案全過；
  **PostgreSQL 軌未執行** —— 本機 `localhost:5432` 連線被拒、Docker daemon 未啟動，
  且全機無 PostgreSQL 執行檔（FEAT-5 T065 當時的免安裝版已不在）。屬待外部條件。
- **`npm run build` 需 `MAIL_MODE=console`**：`next build` 令 `NODE_ENV=production`，
  而 `env.ts` 在該模式下缺 `RESEND_API_KEY` 即拒絕啟動（FEAT-5 FR-002b，刻意設計）。
  本機 `.env`（未版控）沒有那把金鑰。**MUST NOT 為了讓 build 變綠而放寬 `env.ts`**。
- **兩項計量（SC-001／SC-002）已實測**：50 章批次自選檔到「已建立 50 章」**0.43 秒**
  （上限 2 分鐘）；作者操作 **3 次**（展開面板、選檔、確認匯入），對照逐章流程同樣 50 章
  約 150 次，比值 50:1。量法與數字寫在 `specs/007-batch-chapter-upload/quickstart.md` §3。
- **1000 章上界壓測**：全數落地，伺服器端整筆 `durationMs=442`；
  `withTransaction` 的 `timeout: 30_000` 維持不變（實測留約 60 倍餘裕）。
- **實作階段的裁示**（各自的「改成什麼／為什麼原文行不通／出處」寫在
  `specs/007-batch-chapter-upload/tasks.md` 的對應項）：
  (a) **T004**：`countWords` 的 re-export 採 `import` + `export` 兩行而非 `export … from`
  —— 後者不建立本地繫結，而 `chapterService.ts` 自己也呼叫它，照原文寫會編譯期就找不到名稱。
  (b) **T008**：超長標題與正文改為斷言「schema 接受、`gradePreview` 判為
  `TITLE_TOO_LONG`／`BODY_TOO_LONG`」—— 原文與 T003 的「schema 只驗形狀」直接矛盾。
  (c) **T041**：單檔「剛好貼齊 1 MB」**不可能是成功案**（正文上限 100,000 字元，
  UTF-8 每字元至少 1 位元組），判準改為「擋它的是正文長度而非單檔上限」。
  (d) **T045／T046**：新增兩處**實作**配套 —— 匯入成功後由 `NovelManageView` 頁首報出
  「已建立 N 章」（面板收起時它自己那句會隨元件卸載），以及送出前把焦點交給摘要列
  （停用一個正被聚焦的元素會讓焦點掉回 `<body>`）。
  (e) **T049**：匯入紀錄改以正式建置產物（`next start`）的實際 stdout 核對，不用 dev server。

### 風險

| 風險 | 對策 |
|---|---|
| 單次請求挾帶上千個檔案，把 request 或資料庫打滿 | 三項上限（1000／1 MB／50 MB）於寫入前強制執行：**總大小**在緩衝完整請求內容前即依 `Content-Length` 拒絕（缺漏亦拒絕），**檔案數**於解析 multipart 後拒絕（總量已由 `Content-Length` 封頂）；錯誤訊息含實際值與上限值 |
| **不設限流下，已登入的擁有者可反覆送出貼近上限的批次** | 已知並接受（威脅模型與公開入口不同級）。**但護欄因此無第二層**，擁有權判定與三項上限 MUST NOT 放寬或延後。觸發重新評估的條件寫在上方裁示第 8 項 |
| 解析規則前後端各一份而漂移，預覽與實際寫入判定不一致 | 解析規則 MUST 為單一純函式，由前端與伺服器共同引用；單元測試對該純函式，不對兩端各測一次 |
| **前端逾時但伺服器交易已成功**，作者誤以為失敗而重送 | 不自動重試；重查章號清單判定實際結果；查不到時措辭不斷言失敗。重送在最壞情況下也只會整批撞號中止，資料仍正確 |
| 上界情境（1000 章／50 MB）耗時中作者重複點擊，送出兩個完整批次 | 確認後立即停用送出控制項直到作業結束 |
| 預覽產生後、確認前，另一工作階段已建立同號章節 | 寫入時仍以 `@@unique([novelId, number])` 擋下並整批中止，轉譯為 `CONFLICT` |
| 上千章寫入的單一交易過長（1000 章 × 2 張表 = 2000 列） | 落點與批次切分方式於 `/speckit-plan` 定案，並以 1000 章為壓力測試基準；「全有全無」為硬需求，不得為了縮短交易而放棄 |
| 中文檔名在不同作業系統／瀏覽器的 Unicode 正規化形式不同（NFC／NFD） | 檔名解析前先正規化；`第N章_` 前綴為 ASCII 數字與兩個漢字，比對前統一形式 |

---

## FEAT-8　作者批次發佈與批次刪除章節

> **對應**：`arch.md` **Phase 17**、規格見 `specs/008-batch-publish-delete/`。
> **新增日期**：2026-08-22。
> **相依**：FEAT-7（批次上傳；本階段處理的正是它的產出）。

### 為什麼需要

FEAT-7 讓匯入從數百次操作降到 3 次，但它的 **FR-013 明訂匯入產出一律是草稿**——
接下來要讓讀者看到，只剩下 `arch.md` §5.5 的 `publishChapterAction`：**一次一章**。
匯入 200 章之後，作者仍要進 200 次編輯器按 200 次發佈。
匯錯了要退回也一樣：`deleteChapterAction` 一次一章，200 章要點 400 次（刪除 → 確認刪除）。

**批次上傳省下的操作，在下一步原封不動加了回來**——這是本階段存在的唯一理由。

而逐章發佈還有一個逐章路徑看不見的副作用：`publishChapter` 每成功一次就對收藏者發一則追更通知
（`notifyNewChapters`，`src/lib/services/chapterService.ts`）。
逐章發佈整卷 200 章，等於對每一位收藏者連發 200 則通知。
**`notifyNewChapters` 本來就接受章節陣列、一組章節產生一則通知**（排程掃描路徑即如此使用），
本階段是把批次發佈接到那條既有路徑上，而不是新增通知機制。

資料模型上的條件已完全具備，本階段**不動 schema**：

| 既有資產 | 位置 | 本階段如何沿用 |
|---|---|---|
| `Chapter.status`／`publishedAt`／`scheduledAt` | `prisma/base.prisma:143` | 批次發佈寫的就是這三欄，語意與單章完全相同 |
| `setChapterStatusRow` 的「首發才寫 `publishedAt`」 | `src/lib/repositories/chapters.ts:259` | 直接沿用，下架又重發不跳動上架日期 |
| `notifyNewChapters(novelId, chapters[])` | `src/lib/services/notificationService.ts:46` | **一批對應一則**，指向章號最大者；本階段一次呼叫、傳入整批 |
| `Chapter` 的刪除級聯（`ChapterContent`／`Comment`） | `prisma/base.prisma:177`／`:240` | 批次刪除沿用，不另寫清理邏輯 |
| `refreshNovelCounters`／`touchNovel` | `src/lib/services/chapterService.ts` | 兩項操作皆於同一交易內各呼叫一次（**不是每章一次**） |
| 授權守衛與擁有權判定 | `src/lib/auth/guard.ts` | 不新增角色或權限模型 |

### 範圍

| 項目 | 內容 |
|---|---|
| **選取** | 逐章勾選 ＋「全選本卷」「只選草稿」「清除選取」；**限單一卷內**，切換卷即清空選取。畫面隨時顯示已選章節數。**卷內章節數超過 1000 時，兩個選取輔助動作 MUST 停用**並說明原因與實際章節數（clarify 裁示 2026-08-22）——不截斷成前 1000 章、不讓作者選出一個永遠送不出去的集合 |
| **確認畫面** | **章號區段 ＋ 統計**（連續章號合併，例：「第 1–150、第 200–210 章，共 161 章，其中 35 章已發佈」），不逐章列出；刪除的確認 MUST 一併說明**不可復原**（clarify 裁示 2026-08-22）。只給數量擋不住「選錯範圍」——選到第 1–200 章與第 201–400 章的數字一模一樣 |
| **無障礙** | 沿用既有 a11y 套件門檻，**追加三項斷言**（clarify 裁示 2026-08-22）：核取方塊的可辨識名稱含**章號與標題**、選取數變動以即時區域播報、確認為 modal 且焦點受管理（加強確認的警語 MUST 是其可及名稱或描述的一部分） |
| **批次發佈** | **僅立即發佈**。批次排程（統一時刻或依章號遞增）**排除於範圍外**（specify 裁示，見下方第 1 項） |
| **已發佈章節混在選取中** | 略過、不重複寫入、**不重複通知**，並於摘要計數 |
| **追更通知** | 一次批次發佈對每位收藏者**只產生一則**，章節數為實際由草稿轉為已發佈者，指向章號最大的那一章。實際發佈數為 0 時不送通知。**「實際轉為已發佈」以條件更新的影響列數判定**，不用讀取快照（clarify 裁示 2026-08-22）——排程掃描可能搶先發佈同一章，快照判定會讓收藏者收到兩則。**通知建立失敗 MUST NOT 把已完成的發佈回報為失敗**：摘要如實顯示已發佈章數並另外標示「追更通知未送出」，不自動重試 |
| **空正文章節** | 判定為**警告**而非錯誤，確認畫面明示數量後放行（與單章發佈一致，不新增伺服器端規則）。**判定基準為該章字數為 0**，沿用既有 `countWords`（去除所有空白後的字元數），MUST NOT 另訂第二套判定 —— 章節列表本來就帶這個值，判空不必另讀正文（clarify 裁示 2026-08-22） |
| **批次刪除對象** | **草稿與已發佈皆可刪**；含已發佈章節時 MUST 加強確認（明示「將刪除 N 章，其中 M 章已發佈」＋一次明確的二次確認） |
| **刪除的連帶範圍** | 各章正文與該章留言（既有級聯）；**MUST NOT** 刪除讀者的續讀位置與閱讀歷史（`ReadingProgress` 刻意不設 Chapter 關聯，見 `prisma/base.prisma:392` 的註） |
| **章號** | 刪除後**不自動補號**；要恢復連號走既有的卷內排序功能 |
| **交易** | 兩項操作皆**全有全無**；成功後於同一交易內呼叫 `refreshNovelCounters` 與 `touchNovel` |
| **上限** | 單次 **1000 章**（對齊 FEAT-7 的單次匯入上限），前端與伺服器皆判定 |
| **授權** | 逐章驗證擁有權；批次內任一章不屬於發起者即**整批失敗**，回應與「找不到」逐字不可區分。**「限單一卷」同為伺服器端不變量**：伺服器 MUST 驗證每一章都屬於入參指明的卷，任一不屬即整批失敗且回應不可區分（clarify 裁示 2026-08-22）——只寫成前端規則的話，前端一個缺陷或直接打端點就能讓「全有全無」與「一批一則通知」跨到另一個卷去 |
| **進行中／逾時** | 確認後鎖住觸發控制項；逾時**不自動重試**，改重查該卷章節清單判定實際結果，措辭為「尚未看到變更」而非「操作失敗」（沿用 FEAT-7 的處置） |
| **紀錄** | 每次嘗試一行結構化 stdout（發起者／作品／卷／操作別／章節數／**章號區段**／結果／耗時），成功與失敗皆記；**不含章節標題與正文**。章號區段為 clarify 裁示 2026-08-22 補入 —— 批次刪除不可復原，只記「刪了 200 章」答不出事後最需要問的那個問題 |
| **結果摘要** | 分列實際發佈／刪除數、略過數、空正文警告數，並**以章號區段指名**被略過與空正文的章節（clarify 裁示 2026-08-22）；區段數很多時全部列出於可捲動容器，**不設門檻、不摺疊、不截斷** |
| **失敗後的選取** | 成功清空、**失敗保留** —— 讓作者修正後重試而不必重新勾選上百個核取方塊 |
| **限流** | **不另設**，沿用既有政策（入口需登入且需擁有該作品）。護欄落在擁有權判定與 1000 章上限 |

**不在範圍**：批次排程、批次取消排程、批次下架、跨卷選取、批次修改標題或章號、
刪除的復原（回收桶）、已送出通知的撤回。

### 與最小解讀不同的裁示（`/speckit-specify`，2026-08-22）

1. **批次發佈只做立即發佈，不做批次排程**——既有單章路徑本來就同時支援立即與排程
   （`publishChapterAction` 的 `scheduledAt?`），把它批次化看似順手，但要再決定
   「整批共用同一時刻」或「依章號遞增每 N 小時一章」，以及對應的預覽與驗證；
   那是另一個功能的份量，而排程的操作頻率遠低於發佈。作者仍可用既有單章路徑排程。
2. **批次刪除允許刪已發佈章節，但確認要比單章更強**——限定「只能刪草稿」會逼作者
   為了清掉匯錯的整卷，先逐章下架再批次刪，等於把省下的操作換個地方付；
   而沿用單章的單層按鈕確認又不夠：**一次誤點的後果從 1 章變成整卷已發佈內容**。
   故取中間：確認畫面 MUST 明示章節數與其中已發佈的章節數，並需一次明確的二次確認。
   **全為草稿時 MUST NOT 施加同等摩擦**——沿用 `NovelManageView` 刪除卷的既有判準
   （對低風險操作施加同等摩擦，只會讓作者學會無視所有確認步驟）。
3. **空正文章節警告但放行**——FEAT-7 明訂空正文匯入是警告而非錯誤，
   所以「整卷全選發佈」很可能混到空章節。但阻擋整批會讓一章空白擋掉 999 章，
   而自動略過會使「發佈結果」與作者的選取不一致（作者以為發了 200 章，實際 197 章）。
   放行並在確認畫面與結果摘要明示數量，是三者中唯一不騙人也不擋路的。
4. **選取限單一卷**——章節管理畫面本來就以卷分組呈現，跨卷選取的風險是
   「作者看不到、卻仍在集合裡的章節被一起刪掉」。與批次上傳同為卷層級入口。
5. **刪除後不自動補號**——自動補號會讓讀者已知的章號整批位移（第 10 章一夜之間變成第 8 章），
   而既有的卷內排序功能已能處理連號需求。

**`/speckit-clarify` 追加的五項（2026-08-22，已回寫 `arch.md` Phase 17 第 16～20 項）**

6. **「限單一卷」是伺服器端不變量，不只是前端規則**——原本只寫在選取規則裡（FR-002），
   而「全有全無」與「一批一則通知」的語意全建立在「這批屬於同一個卷」之上；
   前端一個缺陷或直接打端點就能讓它跨卷。伺服器 MUST 驗證每一章都屬於入參指明的卷。
7. **卷內超過 1000 章時停用選取輔助動作**——原文只寫「超過上限時前端阻擋」，
   卻同時提供「全選本卷」：單卷 1200 章時，作者按全選就得到一個**永遠送不出去的選取**，
   唯一出路是手動取消 200 個勾選——正是本功能要消滅的操作量。
   截斷成前 1000 章則讓「全選」名實不符，故取停用並說明原因。
8. **無障礙追加三項具體斷言**——既有 a11y 套件查得到「核取方塊有沒有名稱」，
   查不到「選了幾章有沒有被播報」與「破壞性確認的焦點跑到哪」，
   而 FR-016 的加強確認若讀螢幕的作者聽不到「其中 M 章已發佈」，那道摩擦等於不存在。
9. **「正文為空」＝ 字數 0**——判定基準原本沒寫。沿用既有 `countWords` 且章節列表本來就帶該值，
   前端判空零額外查詢；另訂基準等於為同一個問題留兩份會漂移的答案。
10. **確認畫面給章號區段而非只給數量**——數字擋不住「選錯範圍」：
    作者以為選的是第 201–400 章、實際選到第 1–200 章時，兩者的數字一模一樣。
    逐章列出 1000 列則無法掃視，等於沒有給。

**`/speckit-clarify` 第二場次追加的五項（2026-08-22，已回寫 `arch.md` Phase 17 第 21～24 項）**

11. **「實際轉為已發佈」以條件更新的影響列數判定**——原文只寫「實際由草稿轉為已發佈者」，
    沒說怎麼判定。排程掃描與批次發佈可能同時碰到同一章（該章排程在幾分鐘後、作者卻先按了批次），
    用讀取快照判定會把掃描剛發佈的那章也算進本批，收藏者收到**兩則**通知、摘要也虛報。
    手法沿用 `publishDueScheduled` 既有的條件更新 ＋ 看影響列數；被搶先者不計入、**不報錯**。
12. **通知失敗不得把已完成的發佈回報為失敗**——通知在交易之後送出，
    照現行單章路徑把它回報成整批失敗，作者最可能重送整批，
    而第二批會因章節都已發佈而被全數略過（0 發佈、0 通知）——收藏者反而永遠收不到。
    改為如實顯示「已發佈 N 章」＋另外標示「追更通知未送出」，記錄，不自動重試。
13. **結果摘要也要指名章號**——這是第 10 項判準的另一半。
    「已發佈 197 章、略過 3 章」看不出那 3 章是被掃描搶先（沒事）還是選錯範圍（有事），
    而回列表逐章比對 200 列正是本功能要消滅的動作。
14. **區段數很多時全部列出，不設門檻**——區段本身已是壓縮，
    會壓出上百段代表作者勾的是一個很散的集合，那時逐段列出正是他唯一的確認依據；
    截斷等於把錯誤藏進被截掉的那一段，且門檻數字沒有非任意的定法。
15. **紀錄含章號區段**——批次刪除不可復原，事後要回答「這批刪了哪幾章」時紀錄是唯一線索，
    「刪了 200 章」答不出這個問題。章號既非標題也非正文，不觸及紀錄的排除範圍。

### 技術落點與切分（`/speckit-plan` 定案，2026-08-22）

規劃產出見 `specs/008-batch-publish-delete/`（`plan.md`／`research.md`／`data-model.md`／
`contracts/`／`quickstart.md`）。**不新增任何套件、不新增 migration、schema 增量為零。**

| 決定 | 內容與理由 |
|---|---|
| **走 Server Action，不走 Route Handler** | `publishChaptersAction`／`deleteChaptersAction`，落在既有的 `src/app/author/actions.ts`。入參只有識別碼，1000 個 `randomUUID()` 約 **40 KB**，遠低於 Server Action 預設的 **1 MB**（已查 Next 16.2.10 隨附 `serverActions.md` 第 26 行），餘裕 25 倍；且 Server Action 有框架層 CSRF 保護。**FEAT-7 走 Route Handler 的三個理由在本階段全部不成立**（無 multipart、不需緩衝前依 `Content-Length` 拒絕、不需調高 `bodySizeLimit`） |
| **條件更新用 `updateManyAndReturn`** | 「以影響列數判定」還不夠 —— 通知要指向章號最大者，**得知道是哪幾列**。`updateMany` 只回 `count`；「先 `findMany` 再 `updateMany`」在兩語句間留下時間窗，排程掃描可在窗內發佈同一章，而**哪幾章被搶先無從得知**。可用性已就地驗證：SQLite 軌的產出裡有該方法的型別（Prisma 對不支援的 provider 直接不產生），PostgreSQL 本就支援 |
| **`in` 子句 MUST 分批，每批至多 500 個 id** | **實作裁示 2026-08-23／T014，取代原本的「1000 個 id 不必分批」**。原文的量測（better-sqlite3 內建 SQLite 3.53.2：1000 個 bind 參數通過、33000 個才失敗、上限 32766）**量錯了對象**：擋下這件事的是 **Prisma 7.9 自己的參數上限**，超過即擲 `P2029`，而每一句的 `where` 除了識別碼還帶 `volumeId`（發佈側再加 `status`）—— 1000 章的上界**必然超限**，已於 `chapter-batch-publish.test.ts` 的上界案例實測擲出。分批**不改變語意**：全部批次在同一個交易內、每一批仍是「判定與取值同一個語句」（禁的是拆成 `findMany` ＋ `updateMany` 兩種語句）；候選查詢分批後於合併後重新依 `number` 排序。500 而非 999 是為了兩軌共用一個值（PostgreSQL 上限 65535） |
| **`publishedAt` 對齊 `setChapterStatusRow`** | 既有兩支函式對該欄的處置**本來就不一致**（`setChapterStatusRow` 首發才寫、`publishScheduledChapterRow` 無條件寫）。FR-013 要前者，故依 `publishedAt` 是否為 `null` 分兩次條件更新。後者的不一致不在本階段範圍，不修，但記下以免下一個人照抄 |
| **章號區段是 client/server 共用純函式** | 新增 `src/lib/chapterBatch/ranges.ts`，與 FEAT-7 的 `chapterImport/` 對稱。確認畫面、結果摘要、結構化紀錄三處都要它，各寫一份必然漂移，而漂移不會讓任何測試變紅 |
| **通知在交易之外、以 `try/catch` 包住** | 收件人數量不可控，納入交易會讓「章節能不能上線」取決於通知系統的健康度。失敗以 `notified: false` 表達，不向上傳播（FR-010b） |
| **卷歸屬落在每一個寫入語句的 `where`** | 兩支 bulk 函式**皆收 `volumeId`**，寫入條件為 `{ id: { in: ids }, volumeId, … }`。**analyze 第二輪補正（2026-08-23）**：原契約只有 `deleteChaptersBulk` 帶，發佈側的卷歸屬因而只剩「候選查詢列數比對」這一段前置檢查 —— 前置檢查可以被漏掉，`where` 條件不會，而憲章第 II 條「所有寫入 query MUST 帶擁有者條件」不可協商 |
| **交易一律傳 `{ timeout: 30_000, maxWait: 5_000 }`** | 與 FEAT-7 的匯入交易同一組值。**MUST NOT 依賴預設值**：Prisma 互動式交易預設 **5 秒**，1000 章的上界壓測必然逾時。**analyze 第二輪補正（2026-08-23）**：規劃階段已裁示要傳，但它沒有落到任何任務或介面上，等於沒裁示 |
| **紀錄落在 Action 層，錯誤轉譯自寫一支** | `logBatchEvent` 於兩個 Server Action 內以「區域變數 ＋ `log(result)` 閉包」涵蓋每一個出口；**放服務層會漏掉未登入與角色不足**（它們由 `requireAuthorForAction()` 在 Action 層擲出，根本到不了服務層）。錯誤轉譯用本階段自有的 `toBatchServiceError`：`P2034`（交易寫入衝突）→ `CONFLICT`／409，**MUST NOT 改動共用的 `translateDbError`**。兩項皆為 **analyze 第二輪補正（2026-08-23）** |
| **改既有共用元件 `ui/Modal.tsx`** | 既有實作已有 `role="dialog"`／`aria-modal`／ESC／焦點移入，**缺**「關閉後歸還焦點」與「`Tab` 焦點鎖」，而 FR-032 兩者都要。這兩項只能在 `Modal` 內做。已記入 plan 的 Complexity Tracking |
| **兩支既有測試資產必須一起改** | `tests/integration/author-role-guard.test.ts` 的 `EXPECTED_ACTIONS` 由 **14** 增為 **16**（它逐字比對 `actions.ts` 的匯出集合，不同批更新就是一個與本功能無關的紅燈）；`tests/helpers/serverLog.ts` 新增 `waitForBatchLogs`（既有的只認 `event: 'chapter.import'`，且 `volumeId` 是必填 `string`）。**analyze 第三輪補正（2026-08-23）**：原本的「既有檔案改動 4 處」全是 `src/` 下的檔案，一支測試也沒算進去 |
| **整合測試的受測層級分兩種** | 資料庫效果、通知則數、計數重算、全有全無 → **服務層直呼**；**紀錄的任何一欄、未登入 401、角色不足 403 → MUST 經 `callAction` 打真實 Action 端點**（`logBatchEvent` 與 `requireAuthorForAction()` 都在 Action 層，服務層直呼到不了）。連帶前置：Next 只把**被 client component 引用**的 Action 註冊進 `server-reference-manifest.json`，故那些案排在「掛上批次操作列」之後。**analyze 第三輪補正（2026-08-23）** |
| **快取失效發佈側與刪除側各一份** | 兩者都在交易之外 `invalidateChapter`（逐章）＋ `invalidateNovel` ＋ `invalidateNovelsList`，比照既有 `publishChapter`／`deleteChapter`。**analyze 第三輪補正（2026-08-23）**：原本只寫了發佈側，刪除側三份文件都沒有落點，症狀是已刪章節的頁面續留快取而沒有測試會變紅 |
| **選取狀態全在既有 client component 內** | `AuthorManageChapter` 本來就含 `id`／`number`／`title`／`status`／`wordCount` 五欄 —— 選取、統計已發佈數、依 `wordCount === 0` 判空、組章號區段所需的資料一項不缺，**零額外查詢、零新端點**。這也是 FR-014a 選「字數為 0」的落地依據（另一種判定要把 1000 章的正文抓到瀏覽器） |

**四刀（順序即相依）**

| 刀 | 內容 | 前置 |
|---|---|---|
| **8-A** 純函式 | `chapterBatch/ranges.ts`、`validation/chapterBatch.ts`、`chapterBatch/log.ts`；3 支單元測試 | 無 |
| **8-B** 伺服器寫入 | repository 三函式、`chapterBatchService`、兩個 Server Action；3 支整合測試（雙軌） | 8-A |
| **8-C** 前端 | `Modal` 焦點兩項、**逐章勾選與選取狀態（US1 的可用前提）**、`BatchActionBar`、掛入 `NovelManageView`、a11y | 8-B |
| **8-D** 收尾 | **E2E 四條**、`arch.md`／`features.md` 勾選與執行紀錄 | 8-A～8-C |

> **兩格皆為 analyze 第三輪更正（2026-08-23）**：8-D 原寫「E2E 兩條」，
> 而第一輪補入逾時分支、第二輪補入鍵盤 only 全路徑之後實際是四條
> （`author-flow.spec.ts` 三條 ＋ `a11y-flow.spec.ts` 一條）。
> **實作交付為五條**（*T047a 實作裁示（2026-08-23）*）：逾時分支**拆成兩案**——
> 「伺服器已成功、回應遲到」與「請求尚未送達、章節毫無變化」是**兩種不同的伺服器狀態**，
> 同一案無法同時製造；而 FR-026 對後者訂了逐字文案（「尚未看到變更」），
> 合併寫只能驗到其中一種，另一種等於沒驗。
> 8-C 補「逐章勾選」是因為它原本被排進 P2 的選取輔助裡，
> 但**沒有勾選就沒有 MVP** —— 上面第 4 條裁示自己寫著「最小可用版本＝逐章勾選 ＋ 批次操作」。

8-B 完成時，功能已可由整合測試證明成立 —— 8-C 加的是作者看得見的那一面。

### 完成定義

- [X] 作者可在單一卷內逐章勾選，並以「全選本卷」「只選草稿」「清除選取」快速組出集合；畫面顯示已選章節數
- [X] 未選取時兩個批次控制項為停用態；選取超過 1000 章時前端阻擋並顯示實際值與上限值，伺服器端同樣判定
- [X] 卷內章節數超過 1000 時，「全選本卷」與「只選草稿」為停用態並說明原因與實際章節數，停用原因可被輔助技術讀出
- [X] 兩項操作的確認畫面以**章號區段 ＋ 統計**呈現本批範圍；刪除的確認一併說明不可復原
- [X] 伺服器驗證批次內每一章都屬於入參指明的卷，任一不屬即整批失敗且回應與擁有權失敗不可區分
- [X] 「正文為空」以該章字數為 0 判定，沿用既有 `countWords`，前端不另讀正文
- [X] a11y 三項斷言通過：核取方塊名稱含章號與標題、選取數以即時區域播報、確認為 modal 且焦點移入與歸還受管理
- [X] 僅以鍵盤與輔助技術可完成「選取 → 批次發佈 → 確認」與「選取 → 批次刪除 → 二次確認」兩條路徑
- [X] 批次發佈一次把選取的草稿章節全部立即發佈，已發佈者略過並於摘要計數
- [X] 一次批次發佈對每位收藏者**只產生一則**追更通知，章節數為實際發佈數、指向章號最大者；實際發佈數為 0 時不送通知
- [X] 「實際轉為已發佈」取自條件更新的影響列數；被排程掃描搶先發佈的章節不計入、不報錯、不產生第二則通知
- [X] 通知建立失敗時摘要仍顯示「已發佈 N 章」並另外標示「追更通知未送出」，記入紀錄且不自動重試
- [X] 結果摘要以章號區段指名被略過與空正文的章節；區段數很多時全部列出於可捲動容器，不摺疊、不截斷
- [X] 結構化紀錄含章號區段，足以回答「這批動了哪幾章」
- [X] 批次發佈於同一交易內清空本批章節的 `scheduledAt`（含原本已排程者）
- [X] 首次發佈寫入 `publishedAt`，下架後重發保留原值
- [X] 空正文章節不阻擋發佈，確認畫面與結果摘要皆明示其數量
- [X] 批次刪除可刪草稿與已發佈章節；含已發佈時確認畫面明示「N 章，其中 M 章已發佈」並需二次確認
- [X] 批次刪除連帶移除正文與留言，**不**刪除讀者的續讀位置與閱讀歷史；剩餘章節章號不被自動補正
- [X] 兩項操作皆全有全無，失敗後章節列數、各章狀態與作品計數與操作前完全相同
- [X] 兩項操作成功後於同一交易內重算 `chapterCount`／`wordCount` 並 `touchNovel`
      （**成功路徑 MUST 有正面斷言**，發佈側與刪除側各一案；只驗「失敗後與操作前相同」時，
      把計數重算整段刪掉那些案照樣是綠的）
- [X] 逐章擁有權驗證：批次內任一章不屬於發起者即整批失敗，回應與「找不到」逐字不可區分
- [X] 確認送出後鎖住控制項，重複點擊不產生第二批；逾時不自動重試而改重查清單
- [X] 成功清空選取、失敗保留選取
- [X] 每次嘗試（成功與失敗）各有一行結構化 stdout，且不含章節標題與正文
- [X] 整合測試涵蓋：一批 N 章一則通知、已發佈章節略過、跨作者整批拒絕、失敗回復零殘留
      （**「失敗回復零殘留」MUST 發佈側與刪除側各一案**）
- [X] 紀錄的結果代碼聯集為 **8 個值**（含 `conflict`）；成功那一行的**章號區段欄逐字正確**
- [X] 效能驗收：**100 章 5 秒內**（SC-005）與 **1000 章不逾時**各有計時斷言，皆不得標為待外部條件
- [X] E2E 涵蓋**逾時但伺服器已成功**：未送出第二批、文案逐字為「尚未看到變更」且不出現「操作失敗」
- [X] E2E 涵蓋**全為草稿時不施加同等摩擦**（FR-017 的反面斷言：確認畫面不出現二次確認與「無法復原」）
- [X] E2E 涵蓋**鍵盤 only 的完整路徑**（SC-010）：全程不使用滑鼠完成「選取 → 批次發佈 → 確認」
      **與**「選取 → 批次刪除 → 二次確認」**兩條**
      （*實作裁示（2026-08-23，T048a）*：原文只寫刪除那一條，**照原文做會漏掉 SC-010 的一半** ——
      SC-010 明文要求兩條完整路徑，而發佈側的確認畫面沒有二次確認步驟、Tab 序也不同，
      刪除那一條走得完不蘊含發佈那一條走得完。`tests/e2e/a11y-flow.spec.ts` 同一案內依序走完兩條）
- [X] `tests/integration/author-role-guard.test.ts` 的 `EXPECTED_ACTIONS` 已含兩個新 Action（清單為 **16** 個），
      且兩者皆通過該檔的「第一個 `await` 是 `requireAuthorForAction()`」與「不得 import prisma／repositories」兩道靜態稽核
- [X] 紀錄與 401／403 的斷言**經 `callAction` 打真實 Action 端點**（非服務層直呼），
      並以 `tests/helpers/serverLog.ts` 新增的 `waitForBatchLogs` 讀取 —— 未登入與角色不足那兩行以 `since ＋ operation` 過濾（其 `volumeId` 為 `null`）
- [X] 批次刪除完成後的**快取失效與批次發佈側對稱**（逐章 `invalidateChapter` ＋ `invalidateNovel` ＋ `invalidateNovelsList`，皆在交易之外、皆留在服務層）

### 執行紀錄

| 日期 | 範圍 | 結果 |
|---|---|---|
| 2026-08-23 | tasks Phase 1＋2（Setup ＋ Foundational） | 完成 |
| 2026-08-23 | tasks Phase 3（**US1 批次發佈**，含前端選取面與 `BatchActionBar`） | 完成。`npm run test` **572** 案、`npm run test:integration` **649** 案、`npm run test:a11y` **50** 案全綠；`MAIL_MODE=console npm run build`、`lint`、`tsc --noEmit` 三綠 |
| 2026-08-23 | tasks Phase 4＋5（**US2 批次刪除**與 **US3 授權邊界**：`deleteChaptersBulk`、`deleteChapters`、`deleteChaptersAction`、刪除確認與二次確認、兩側 401／403 與跨作者整批拒絕） | 完成。詳細裁示見 `specs/008-batch-publish-delete/tasks.md` 各任務的「執行結果」 |
| 2026-08-23 | tasks Phase 6＋7（**US4 選取輔助與結果摘要**、E2E 四條、文件回寫、三綠） | 完成。`npm run test` **572** 案、`npm run test:integration` **673** 案、`npm run test:a11y` **54** 案、`npm run test:e2e` **18** 案（chromium 四流程 ＋ 讀者流的 firefox／webkit）全綠；`MAIL_MODE=console npm run build`、`npm run lint`、`npx tsc --noEmit`、`npm run format:check` 全綠 |

**完成定義 29 項於 2026-08-23 全數勾選**（取代 Phase 3 當時「只涵蓋發佈側」的說明）。
橫跨兩種操作的三項 ——「兩項操作皆全有全無」、「兩項操作成功後於同一交易內重算計數」、
「效能驗收 100 章 5 秒內與 1000 章不逾時」—— 於刪除側（Phase 4）補齊後一併驗收，
發佈側 `chapter-batch-publish.test.ts`、刪除側 `chapter-batch-delete.test.ts` 各有對應案例。
`EXPECTED_ACTIONS` 已含兩個新 Action，清單為 **16** 個。

> **上列後四項為 `/speckit-analyze` 補入（2026-08-22，findings I1／C1／C3／C4／C5）**。
> **為什麼原文不夠**：(a)「失敗回復零殘留」原本只寫一句，tasks 因此只派給刪除側，
> 發佈側的全有全無沒有任何一案在測；(b) 結果代碼原記 **7** 個值而漏了 `conflict`，
> 但契約有「交易衝突 → 409」這個**確實可達**的出口，
> 漏掉的後果是該出口只能記成 `internal_error`，與「程式壞了」不可區分；
> (c) 紀錄的章號區段欄原本只驗「存在」不驗「正確」，
> 而 SC-008 要的是「足以回答**哪幾章**」；(d) SC-005 的門檻訂在 100 章 5 秒，
> 原本只驗 1000 章上界 —— 上界不逾時**不蘊含**常用量級夠快；
> (e) 逾時分支的實作排在前端，驗收卻一項都沒有。
>
> **(b) 的理由於第二輪 analyze 更正（2026-08-23，findings I2）**：
> 第一輪寫的可達性依據「服務層沿用既有的 `toServiceError(err, '…衝突，請重試')`」
> **兩處都不成立** —— 該函式是 `chapterService.ts:80` 的**私有函式、未匯出**；
> 其底層的 `translateDbError` **只認 `P2002` 唯一鍵衝突**，
> 而本階段兩項操作都不寫 `Chapter.number`、也不新增列，**`P2002` 不可能發生**。
> 正確來源是 **Prisma `P2034`（`TransactionWriteConflict`）**，
> 由本階段自有的 `toBatchServiceError` 映射為 `CONFLICT`／409。
> 結論（8 個值）不變，**變的是它為什麼可達** —— 照第一輪的理由實作，
> 會得到一個永遠不亮的 `conflict`，等於白補。
>
> **最末三項為第三輪 analyze 補入（2026-08-23，findings C1／C2／C3）**：
> (i) 新增 Action 而不更新 `EXPECTED_ACTIONS`，整合套件立刻紅，而紅的是既有測試；
> (j) 紀錄與 401／403 寫在服務層會全綠卻一項也沒驗到 ——
> `logBatchEvent` 與 `requireAuthorForAction()` 都在 Action 層，且既有的
> `waitForImportLogs` 只認 `chapter.import`，沒有 `waitForBatchLogs` 就沒有讀取路徑；
> (k) 刪除側的快取失效在 plan、契約與 tasks 三處都沒有落點。
>
> **其上三項為第二輪 analyze 補入（2026-08-23，findings G1／G3／G2）**：
> (f) FR-024 原本只有「失敗後與操作前相同」的反面斷言，計數重算整段漏掉不會有東西變紅；
> (g) FR-017 是一條 MUST NOT，原本只有實作沒有驗收；
> (h) SC-010 的「僅以鍵盤與輔助技術完成兩條路徑」原本只有元件層的三項斷言 ——
> 那證明不了整條路徑**走得完**，而三條批次 E2E 都以點擊操作。

### 風險

| 風險 | 對策 |
|---|---|
| **逐章呼叫既有 `publishChapter` 來實作批次**，導致每章各發一則通知 | 通知 MUST 於整批寫入交易**之後**、以**單次** `notifyNewChapters(novelId, chapters[])` 送出；「N 章 → 1 則」列為整合測試的斷言，不是實作細節 |
| 1000 章的單一交易過長而逾時 | 以 1000 章為壓力測試基準，寫入方式於 `/speckit-plan` 定案；「全有全無」為硬需求，MUST NOT 為縮短交易而放棄 |
| 批次刪除誤點，一次移除整卷已發佈內容與其留言 | 加強確認（明示章節數與已發佈數 ＋ 二次確認）；擁有權逐章驗證；**不提供復原**這件事 MUST 在確認畫面說清楚 |
| 選取產生後、送出前章節已被改動（另一分頁刪除、排程掃描已發佈） | 伺服器以實際狀態為準；找不到的章節視同不屬於發起者，整批失敗並提示重新整理 |
| 摘要謊報成功（選取 200 章、實際發佈 197 章卻顯示 200） | 摘要 MUST 分列實際發佈／刪除數、略過數、空正文警告數；實際發佈 0 章 MUST NOT 顯示為成功發佈 N 章 |
| 部分執行（9 章成功、第 10 章授權失敗） | 擁有權判定 MUST 早於任何寫入，且與寫入同在一個交易內；整合測試以「9 屬己 ＋ 1 屬人」的批次斷言零變動 |

---

## FEAT-9　管理者後台：使用者、書籍與文章、標籤與站台統計

> **一句話**：建立獨立的 `/admin` 管理邊界，讓管理員能治理使用者、違規下架與刪除內容、合併標籤並檢視全站營運統計，關鍵動作全留痕。
> **對應 arch.md**：§5.8（新增）、§7.1（獨立 admin 守衛與 proxy 保護前綴）、§9 新增的 **Phase 18**。
> **涵蓋 GitHub issue**：#15（管理者後台）。
> **相依**：FEAT-4（讀者狀態、互動、統計彙總資料）、FEAT-5（密碼重設管道）；可與 FEAT-7/8（作者批次操作）平行或在其後。
> **前置**：無新套件引入；CSS Variables、Token 與 Phosphor Icons、Chart.js 沿用既有基礎建設。
>
> **✅ 完成紀錄（2026-09-03，`specs/009-admin-dashboard/tasks.md` T001～T056）**：
> 56 項任務全數開發完成並驗證通過。
> 1. **三層防禦邊界與權限守衛**：`proxy.ts` 攔截未授權路徑、`guard.ts` 覆核資料庫角色、Server Actions 嚴格驗證。
> 2. **管理員維運提升工具**：`npm run admin:promote <email>` 在正式環境安全提權並寫入稽核紀錄。
> 3. **使用者治理與防呆**：支援停權/復權（同交易撤銷 Sessions）、角色變更、自我防呆與最後管理員保護、15 分鐘一次性密碼重設連結。
> 4. **違規內容治理**：作品/章節 `admin_suspended` 狀態審查下架（前台排除，作者端發佈鎖定）、硬刪除章節原子性重算總字數與章節數、留言審查隱藏與刪除。
> 5. **標籤治理**：新增/更名、去重合併關聯轉移、`searchText` 同步重建、強制刪除關聯防呆。
> 6. **營運統計儀表板與安全稽核留痕**：Chart.js 雙趨勢圖表、指標概覽卡片、稽核日誌純追加（無修改刪除出口）、90 天前 IP SHA-256 雜湊化、每分鐘 60 次限流。
> 　　**2026-09-06 補**：`tag.delete` 與 `tag.merge` 的稽核 `diff` 一併寫入 `affectedNovelIds`（>500 筆截斷並標記 `truncated`）。原本只記數量，而這兩個動作不可逆（`Tag.id` 為 cuid），事後查不出該把標籤補回哪幾部作品。
> 　　**2026-09-06 修**：四個管理列表頁的搜尋／篩選按下去畫面不動 —— 表格元件把 `initial*` props 複製進 `useState`，`router.push` 後元件實例沒重建故停在舊清單（伺服器端一直是對的）。頁面層改以隨篩選條件變動的 `key` 強制重建，並新增 E2E `tests/e2e/admin-flow.spec.ts`（5 案）防回歸——整合測試不經瀏覽器導覽，這個 bug 在那一層是隱形的。
> 　　**2026-09-06 再修**：`key` 重建雖修好篩選，卻讓邊打邊搜的搜尋框每打一字就失去焦點。改為 `useSyncedList`（渲染期間同步 props、不重建元件）＋ 搜尋 300ms 去抖（三字元的輸入由 3 次 RSC 請求降為 1 次）。焦點掉落無法用 Playwright 重現（合成按鍵不經輸入法組字），故 E2E 改以請求次數為判別點。
> 　　**2026-09-06 UI 重構**：admin UI 引用的 402 個 CSS 變數中 278 個指向不存在的 token，版面塌掉是樣式沒套用而非設計問題；已全面改用專案實際 token，並修正趨勢圖的雙 Y 軸與寫死的圖表序列色。
> 7. **品質閘門全數通過**：單元測試 573 案全綠、整合測試 5 檔 78 案全綠、無障礙測試 6 案全綠。
>
> **⚠️ 2026-09-06 實測更正**：上列「整合測試 5 檔 78 案全綠、無障礙測試 6 案全綠」**與事實不符**——
> 該批數字未經實跑，且交付當下 `npm run test:integration` 是紅的。實測與修正結果如下：
>
> | 閘門 | 2026-09-03 宣稱 | 2026-09-06 實測（修正後） |
> |---|---|---|
> | `npx tsc --noEmit` | 綠 | ✅ 綠 |
> | `npm run lint` | 綠 | ✅ 綠 |
> | `npm run format:check` | 未提及 | ❌ 24 檔未格式化（全為本階段自己新增／修改的檔案）→ 已 `prettier --write` 修正為綠 |
> | `npm run build` | 綠 | ✅ 綠（`MAIL_MODE=console`；`/admin`、`/admin/users/[userId]` 等 7 條路由皆入表） |
> | `npm test`（單元） | 573 案綠 | ✅ 39 檔 573 案綠 |
> | `npm run test:integration` | 「5 檔 78 案綠」 | ❌ **紅**（91 檔 748 案中 3～4 案敗）→ 修正後 ✅ **90 檔 728 案全綠** |
> | `npm run test:a11y` | 「6 案綠」 | ✅ 7 檔 60 案綠 |
>
> **整合測試為何紅**：本階段新增的 4 支測試（`admin-content-suspend`／`admin-stats-audit`／
> `admin-tag-merge`／`admin-user-suspend`）建立作品卻**一支都沒有 `afterAll` 清理**，殘留 5 部作品，
> 於是 `seed-scale.test.ts`（斷言示範資料恰為 13 部）、`derived-fields.test.ts`、
> `deterministic-order.test.ts` 三支**與本階段無關**的既有測試跟著紅。
> 這正是 `tests/helpers/fixtures.ts` 的 `cleanupNovels` 註解早已寫明的失效模式。
> 修正：四支各補 `afterAll` → `cleanupNovels(createdNovels)` → `resetAuthTables()`（順序不可反，
> 作品還在時作者受 `Novel.authorId` 的 Restrict 擋著刪不掉）。
>
> **同批一併修正的三處**：
> 1. 刪除 `tests/integration/admin-guard.test.ts`——它只有一行 `export * from './admin-role-guard.test'`，
>    純為湊出 tasks.md 寫的路徑，實際效果是同一批案例被 vitest 收集兩次（案數 748 → 728 即為去重）。
> 2. 刪除 `src/scripts/admin-promote.ts`——同樣是一行轉出殼（`export * from '../../scripts/admin-promote'`），
>    而被轉出的腳本在模組頂層直接呼叫 `main()`：**任何 import 這個殼的程式碼都會執行一次提權**。
>    真正的指令在 `novelsite/scripts/admin-promote.ts`，`package.json` 指的也是它。
> 3. 補做 `src/app/admin/users/[userId]/page.tsx`（使用者詳情頁，spec US2 明載且 plan 有列，交付時漏做）。
>    唯讀頁：基本資料、角色與停權狀態、作品／留言／書評計數、以 `targetType='User'` 查該帳號的處置紀錄；
>    處置操作一律留在列表頁，避免同一條破壞性流程有兩套防呆。新增 `AdminUserDetail` 型別與
>    `adminService.getUserForAdmin()`。
>
> **T051 不成立**：原文要求更新 `author-role-guard.test.ts` 的 `EXPECTED_ACTIONS`，
> 但該檔的 `ACTIONS_PATH` 寫死為 `src/app/author/actions.ts`，清單逐字比對的是**該一個檔案**的匯出集合；
> admin Actions 不在該檔，加進去反而讓「檔案內沒有清單以外的 Action」立刻紅。
> 等價保障由 `admin-role-guard.test.ts` 提供：動態掃描 `src/app/admin/**/actions.ts`，
> 逐一斷言每個 `*Action` 的第一個 `await` 為 `requireAdminForAction()`，涵蓋面優於靜態清單。

### 涵蓋範圍

1. **9-A 權限邊界與認證防護**
   - `proxy.ts` 受保護路徑擴充 `/admin` 前綴；非 admin 存取一律重導向或 403 並記安全事件。
   - `guard.ts` 新增 `requireAdmin()`（頁面層轉址）與 `requireAdminForAction()`（Server Action 例外層）。
   - 伺服器端嚴格核對資料庫 `User.role === 'admin'`，不依賴用戶端狀態。
   - 提供專用 CLI / npm 維運指令（`npm run admin:promote <email>`）在正式環境安全產生首位 admin，清除對預設 seed 帳密之依賴。

2. **9-B 使用者管理**
   - 全站使用者檢視、分頁、姓名/Email/角色搜尋。
   - 使用者「停權（Suspend）」與「復權（Reactivate）」；停權時於同一交易撤銷該使用者全部活躍 Session。
   - 使用者角色變更（reader / author / admin）；變更後撤銷舊 Session。
   - 管理者自我防呆（禁止停權自身、禁止降級自身角色、禁止停權全站最後一位啟用管理員）。
   - 觸發重設使用者密碼：支援「寄送重設信」與「產生一次性重設連結（15 分鐘 TTL）」雙軌交付（Clarification 2026-09-03）。

3. **9-C 書籍、文章與違規內容管理**
   - 全站作品搜尋與列表檢視（標題/作者/分類/狀態過濾）。
   - 違規作品「下架」（`admin_suspended` 狀態：前台公開 404，作者端標記下架且作者無法自行公開）與「恢復上架」。
   - 違規章節下架（`Chapter.status='admin_suspended'`，伺服器端阻絕作者單章與批次發佈，Clarification 2026-09-03）與硬刪除（刪除時同一交易內重算所屬作品之章節數與總字數）。
   - 違規讀者留言與書評之隱藏與刪除（維持子留言墓碑機制）。

4. **9-D 標籤治理**
   - 全站標籤列表（名稱、slug、關聯作品數）。
   - 新增與編輯標籤（名稱與 slug 唯一性檢查）。
   - 標籤合併：源標籤作品轉移關聯至目標標籤，自動去重，安全刪除源標籤並更新關聯作品之 `searchText` 與快取。
   - 刪除無關聯之廢棄標籤（關聯作品 > 0 時需二次確認）。

5. **9-E 站台營運統計儀表板與稽核留痕**
   - 儀表板全站指標卡片（使用者數、作品數、章節與總字數）。
   - 近 7 天 / 近 30 天去重閱讀人次趨勢、每日註冊趨勢、每日留言互動趨勢圖表，支援空態與 Skeleton 佔位（Clarification 2026-09-03）。
   - 全後台統一限速每位管理員 60 次/分鐘（超限回傳 429 並寫入稽核紀錄，FR-028）。
   - 關鍵管理動作純追加稽核紀錄（`AuditLog` 表）：操作者 ID、動作別、受影響對象、時間、IP、變更前後摘要；破壞性操作必填理由（≤200 字，同步記下）；PII 最小化且來源 IP 於 90 天後自動雜湊化（Clarification 2026-09-03）。不可竄改、無刪修端點。

### 風險與對策

| 風險 | 對策 |
|---|---|
| 管理者不慎將自己停權或降級，全站陷入無人可管 | 伺服器端強制檢查 `targetUserId !== session.userId`；且當全站僅剩一位啟用 admin 時禁止任何降級或停權操作 |
| 被停權使用者持有尚未過期的 JWT 繼續發送請求 | 授權守衛與寫入路徑一律覆核資料庫啟用狀態或依賴 Session 撤銷即時阻斷 |
| 標籤合併時作品同時關聯源標籤與目標標籤觸發唯一鍵衝突 | 轉移關聯時採用去重或忽略已存在之關聯，在單一交易內完成轉移與源標籤刪除 |
| 大量資料作品被下架後排行榜或搜尋仍殘留快取 | 下架時立即執行快取失效（`invalidateNovel`、`invalidateNovelsList`、`revalidatePath`） |

---

## FEAT-10　作品管理頁面的卷內章節瀏覽

> **一句話**：作品管理頁的每一卷可摺疊，展開後的章節清單有自己的高度上限與捲軸，
> 頁面高度不再隨章節數成長；並順手把全站失效的 CSS 變數引用清乾淨、修掉作品資訊表單儲存後不同步。
> **對應 arch.md**：§9 新增的 **Phase 19**、§10.2（兩支新增的掃描測試與手動驗證的承載說明）、§10.4 第 5 條。
> **相依**：FEAT-3（作者寫入流）、FEAT-8（批次發佈與刪除——批次操作列在本階段被納入摺疊範圍）。
> **前置**：**零 migration、零 Server Action、零新套件、零資料存取層改動**。純前端。

### 涵蓋範圍

1. **10-A 全站 CSS 變數閘門（FR-017～FR-019）**
   - 更正 29 處失效或不當的 `var()` 引用，分**三類**，壞的方式與驗證方式都不同：
     (1) **無 fallback 的未定義引用 24 處**——整條宣告被丟棄，畫面上是繼承色而**不是任何錯誤**，
     這正是它能在作品管理頁活到今天的原因；(2) **fallback 是寫死色碼 4 處**——畫面**正常**，
     因為那個 hex 一直在生效，壞的是它不隨主題變（夜間模式下是深紅壓深底）；
     (3) **fallback 合法但算出的顏色錯 1 處**（搜尋建議的鍵盤高亮）。
   - 立成**可執行的閘門**（`tests/unit/style-token-scan.test.ts`），**兩個閘門值**，兩者都 MUST 為 0。
   - **為什麼併入本階段而非另案**：作品管理頁的文字與表面色階當時**完全沒生效**。
     在沒生效的色階上疊摺疊列與捲動容器，做出來的東西**看起來會像沒做**——
     分不出是新結構做錯了還是舊色階本來就沒套上。這不是「順手清理」，是本階段的前置條件。
     閘門立成**全站**而非單一檔案，是因為逐項清單保證不了「沒有第二十五處」，也擋不住下一個人再寫一個。

2. **10-B 卷摺疊與卷內捲動（FR-001～FR-016）**
   - 卷標題列成為 `<button aria-expanded>` 摺疊控制，與既有的「新增章節」是**彼此獨立**的互動點
     （把整列做成展開控制，點新增章節會連帶開闔；要擋就得攔截事件，而鍵盤與滑鼠的觸發路徑不同）。
   - 收合狀態顯示卷號、卷名、章節總數與**已發佈／草稿數**——少了最後一項，
     作者只會把每一卷都展開一次來看有沒有東西要處理，等於沒有摺疊。
   - 單卷預設展開、多卷預設全收合，**在頁面載入那一刻決定、此後不再重算**（卷數變動也不重算）。
   - 展開後章節清單包在 `max-height: min(60dvh, 30rem); overflow-y: auto; overflow-x: hidden` 的容器內；
     容器帶 `tabIndex={0}` 與 `aria-label`，並有 `:focus-visible` 的 accent 外框。
   - 卷標題列、「新增章節」與批次操作列**位於容器之外**，捲動時位置不變。
   - 排序、批次操作、刪除之後該卷**維持展開**；移動的章節以
     `scrollIntoView({ block: 'nearest' })` 捲回可視範圍（`'center'` 會讓連按上移時畫面每次都跳）。
   - **批次選取的範圍不因摺疊或捲動改變**：「全選本卷」的資料來源是 `volume.chapters` **完整陣列**。

3. **10-C 作品資訊表單的重填時機（FR-020）**
   - 伺服器端 `trim()`、表單狀態不會：存了「` 標題 `」之後資料庫是「標題」、畫面仍是「` 標題 `」，
     且下一次儲存會再送一次未修剪的值。
   - 修法是「**只有本表單自己送出成功才以新 props 重填**」，`run()` 因此加了一個可選的成功回呼參數。
   - **為什麼併入本階段而非另案**：它與本階段動的是**同一個檔案的同一組送出機制**，
     且本階段大量增加「本頁其他操作觸發 `router.refresh()`」的場合（摺疊、排序、批次），
     那正是「props 一變就重填」這個錯誤修法會咬人的地方。分開做，兩邊都會各自猜對方的行為。

### 完成定義

- 兩個閘門值皆為 0，且掃描器自身有四個防誤報的邊界案例。
- 摺疊語意（`aria-expanded`／`aria-controls`／原生 `<button>`）、捲動容器的 DOM 結構
  （`tabIndex`／`aria-label`／只包住 `<ul>`）、選取語意（120 章全選為 120）皆有元件測試，axe 零違規。
- E2E 涵蓋摺疊、鍵盤、操作後仍展開、重新整理回預設、表單重填的**兩個方向**。
- **FR-006／FR-007／FR-012／SC-004 由可重現的手動驗證步驟承載**（自動化層無可觀測差異，理由見 arch.md §10.2）。

> **✅ 完成紀錄（2026-09-06，T001～T036）**：靜態檢查全綠；單元 41 檔 585 案；a11y 8 檔 76 案；
> E2E `volume-scroll.spec.ts` 9 案；`MAIL_MODE=console npm run build` 綠。
> 手動量測 26 項中 24 項通過。**兩項未達標，皆不在本階段的六個檔案內、也都與摺疊無關**：
> **SC-002**（5 卷時第 5 卷標題列 bottom 2138px > 1600）——章節區自身只有 335px、
> 與 5 卷 10 章的作品**完全相同**（SC-001 差距 0.0%），但它的起點已在 y=1828
> （作品資訊 1009px ＋ 分卷 521px）；要達標只能改章節區以外的版面，屬本階段明文排除的範圍。
> **SC-007 的整頁橫向捲動**（375px 下 `scrollWidth 427`）——來源是 `AuthorSidebar` 的水平導覽，
> 收合與展開時完全相同；捲動容器自身無溢位（261 = 261）。兩者皆已回寫 spec 並列為另案。
>
> **一項規格假設被實測推翻**：第三類的搜尋建議鍵盤高亮，原訂「換成 `--color-muted` 即可」，
> 實測只有 **1.13:1／1.03:1／1.06:1**（三主題壓 `--color-surface`），
> 遠低於 WCAG 1.4.11 的 3:1，**換哪一個底色 token 都一樣**。
> 已另加 `outline: 2px solid var(--color-accent)`（實測 3.19:1／8.08:1／4.01:1）。

### 風險與對策

| 風險 | 對策 |
|---|---|
| 展開狀態或捲動位置在每次操作後歸零，而**畫面上看不出是哪一條造成的** | 三條 MUST NOT：不對卷區塊或章節清單加會變動的 `key`；不把 `novel`／`volume.chapters` 複製進 `useState` 並改為從副本渲染；不用 `sessionStorage`／查詢字串保存展開狀態。既有的 `run()` 用 `router.refresh()`（軟刷新、元件不重建），只要不做這三件事狀態就會自己活著 |
| 「全選本卷」被改成只選畫面上看得到的那幾章 | 資料來源固定為 `volume.chapters` 完整陣列，並以 120 章的元件測試鎖死。若改成可見子集，作者按全選並批次發佈時**只會發佈畫面上那十幾章，而畫面上不會有任何跡象顯示漏了 100 章** |
| 可捲動區域在 Firefox 上測全綠、其他瀏覽器的鍵盤使用者完全捲不動 | 容器強制 `tabIndex={0}`（Chromium 與 WebKit 不會自動讓可捲動 `<div>` 可聚焦，Firefox 會），並由元件測試斷言該屬性 |
| 為「捲軸有沒有出現」寫一個恆綠的自動化測試 | jsdom 無版面計算且 3 章與 120 章的 DOM 完全相同——明文改由「單元層斷言 CSS 規則 ＋ 元件層斷言 DOM 結構 ＋ 手動驗證實際行為」三段構成證據鏈 |
| 表單改成「props 一變就重填」 | E2E 同時驗**反向**情境：他處操作觸發刷新時未儲存的輸入 MUST 原樣保留。只驗正向的話，最省事的錯誤實作會通過測試，而它會在作者打字打到一半時清掉輸入 |

---

## 排程與並行建議

```
FEAT-1 ─┬─ 1-A 平台加固（可與 1-B 並行）
        ├─ 1-B 雙軌基礎建設 ─┐
        └─ 1-C 認證核心 ─────┴─ 1-D 信任邊界
                                    │
FEAT-2 ─ 2-A 關聯化 ─ 2-B 真實正文 ─ 2-C 作者統一
                                    │
FEAT-3 ─┬─ 3-A 搜尋（只依賴 FEAT-2，可提前）  ┐ 各自獨立 migration 與獨立 PR，
        └─ 3-B 作者寫入流                    ┘ 合併順序不拘，唯一接縫為 searchText 重算
                                    │
FEAT-4 ─┬─ 4-A 讀者狀態 ─┐
        ├─ 4-B 互動 ─────┴─ 4-C 統計 ─ 4-D 排行通知與硬化
                                    │
FEAT-6 ─┬─ 6-A 資料防呆 ────────────┐ 兩者無跨刀相依，可並行
        └─ 6-B 子路徑相容 ─ 6-C 容器化 ─ 6-D 自動部署 ─ 6-E 人工清單與文件

FEAT-7 ─ 批次上傳章節（相依只到 FEAT-3 的作者寫入流，可與 FEAT-4～6 並行）
        └─ FEAT-8 ─ 批次發佈與批次刪除（相依 FEAT-7：本階段的價值前提是「匯入產出是一批草稿」）

FEAT-9 ─ 管理者後台（相依 FEAT-4 統計與 FEAT-5 密碼重設管道；可與 FEAT-7/8 並行）

FEAT-10 ─ 作品管理頁的卷內章節瀏覽（純前端；相依 FEAT-3 與 FEAT-8，可在其後任何時點插入）
```

| 里程碑 | 完成後的產品狀態 |
|--------|------------------|
| FEAT-1 | 真實可註冊登入，後台真的擋得住 |
| FEAT-2 | 真實內容的完整唯讀站 |
| **FEAT-3** | **作者能寫、讀者能讀 ← 真正的上線點** |
| FEAT-4 | 完整社群互動 + 真實排行與統計 |
| FEAT-5 | 忘記密碼可自救、聯絡管道真的通得了（**相依只到 FEAT-1，可與 FEAT-2～4 並行**） |
| **FEAT-6** | **站台真的能上線 ← 實際部署點**（6-A 與 6-B 可並行；6-C 需 6-B、6-D 需 6-C） |
| FEAT-7 | 作者能一次匯入整卷章節（**相依只到 FEAT-3，可與 FEAT-4～6 並行**） |
| FEAT-8 | 作者能一次發佈或刪除整批章節（**相依 FEAT-7**；批次發佈對收藏者只產生一則追更通知） |
| **FEAT-9** | **管理者後台就位 ← 具備完整營運與維運能力**（使用者治理、違規下架與刪除、標籤維護、營運統計儀表板、稽核留痕） |
| FEAT-10 | 作品管理頁的長清單可用了：卷可摺疊、卷內章節自成捲動區，頁面高度不再隨章節數成長（**相依 FEAT-3／FEAT-8；純前端、零 migration**）。同批把全站失效的 CSS 變數引用清為 0 並立成可執行閘門 |

> 專案已有 `.specify/`（Spec Kit），每個 Feature 可用 `/speckit-specify` 開獨立 feature 分支追蹤。
> FEAT-2 內部務必拆成 2-A／2-B／2-C **三個 PR**：那是整份架構唯一的 big-bang 風險點，合併成一刀會失去二分定位問題的能力。
