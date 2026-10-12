# 🏗️ NovelSite 系統架構文件（Architecture）

> **版本**：v1.0
> **日期**：2026-07-23
> **狀態**：架構定案，實作待核准
> **取代關係**：`plan.md` 保留為 UI/UX 與 Phase 0–8 的設計依據；`nextstep.md` 保留為 2026-07-22 的安全審核紀錄。**本文件為後端與系統架構的唯一真相來源（Single Source of Truth）**，兩者衝突時以本文件為準。

---

## 目錄

1. [定位與範圍](#1-定位與範圍)
2. [系統架構](#2-系統架構)
3. [雙軌資料庫方案](#3-雙軌資料庫方案)
4. [資料模型](#4-資料模型)
5. [API 與 Server Action 規格](#5-api-與-server-action-規格)
6. [功能與特色清單](#6-功能與特色清單)
7. [安全機制](#7-安全機制)
8. [nextstep.md 項目修正對照表](#8-nextstepmd-項目修正對照表)
9. [里程碑](#9-里程碑)
10. [驗證與測試計畫](#10-驗證與測試計畫)

---

## 1. 定位與範圍

### 1.1 目標

把 NovelSite 從「**唯讀展示原型**（Read-only Showcase）」推進為「**可註冊、可創作、可互動的全免費繁體中文小說平台**」。

現況（`nextstep.md` 實測結論）：

- 全專案 **無 `route.ts`、無 `"use server"`**——不存在任何後端寫入路徑
- 登入態存在瀏覽器 `localStorage`，帳密寫死在 client bundle
- 所有「寫入」操作只呼叫 `showToast()` / `setState()`，不觸及資料庫
- 章節「正文」由 `generateChapterParagraphs()` 依章節編號拼裝假段落——**資料庫裡根本沒有小說內容**

因此本架構的核心工作是：**建立伺服器端信任邊界 → 建立真實內容儲存 → 建立寫入 API → 建立真實統計**。

### 1.2 已定案決策

| 決策項 | 選擇 | 理由 |
|--------|------|------|
| **付費機制** | **平台全免費，無付費章節、無金流** | 移除付費牆後，`nextstep.md` H-3（Paywall Bypass）在架構上不復存在；同時大幅簡化授權模型（章節內容不需要 per-user 授權判斷） |
| **資料庫** | **雙軌**：SQLite（dev）／PostgreSQL（prod），介面抽象於 `repositories` | dev 零維運、prod 具備全文檢索與並行寫入能力；抽換邊界已存在（`db.ts` + `repositories/*`），成本可控 |
| **認證** | **自建 session**：`jose` 簽章 + HTTP-only Cookie + DB session 表 | 依賴少、可控性高、可主動撤銷 session；不受 Auth.js 大版本相容性牽動 |
| **本輪交付** | **僅架構文件** | 實作分階段另行核准 |

### 1.3 明確排除範圍（Non-Goals）

- ❌ **付費章節、訂閱制、打賞、金流串接**——本站所有已發佈章節對所有人（含未登入訪客）完全開放
- ❌ 社群登入（OAuth）——第一階段僅 Email + 密碼，架構保留擴充點
- ❌ 多語系（i18n）——僅繁體中文
- ❌ 行動 App、圖片上傳／CDN——封面沿用 CSS 漸層方案

### 1.4 實作前必讀

`AGENTS.md` 明確要求：**本專案的 Next.js 16 與訓練資料中的版本有破壞性差異，寫任何程式碼前必須先讀 `node_modules/next/dist/docs/` 的對應指南。**

> **2026-07-23 更新**：`npm install` 已執行，附錄 B 的 9 項已逐一核對完畢（7 項結案、2 項因非 Phase 9 範圍而延後），結論已回寫入對應章節。下列清單保留為原始待查記錄。

本文件中凡涉及下列 Next.js 16 API 之處，原標記 `[待查 Next 16 docs]`，實作時必須先 `npm install` 再逐一核對：

- Route Handler（`app/api/**/route.ts`）的簽章與 `params` 是否為 Promise
- Server Action（`"use server"`）的錯誤處理與 revalidate 機制
- **路由攔截檔名**：`middleware.ts` 是否已更名為 `proxy.ts`（Next 16 的已知變更方向）
- 快取指令：`use cache` / `revalidateTag` / `cacheLife` 的正確用法
- `cookies()` / `headers()` 是否為非同步 API

---

## 2. 系統架構

### 2.1 分層圖

```
┌─────────────────────────────────────────────────────────────────┐
│  Client Components                                              │
│  表單、閱讀器、主題切換 — 不含任何信任判斷                        │
└───────────────┬─────────────────────────────────────────────────┘
                │ Server Action 呼叫 / fetch(/api/*)
┌───────────────▼─────────────────────────────────────────────────┐
│  Route Layer   src/app/**                                       │
│  ├ RSC 頁面      … 直接呼叫 service 取資料                       │
│  ├ Route Handler … src/app/api/**/route.ts                      │
│  ├ Server Action … src/app/**/actions.ts（"use server"）         │
│  └ 路由攔截      … src/proxy.ts（Next 16 已自 middleware 更名）   │
└───────────────┬─────────────────────────────────────────────────┘
                │
┌───────────────▼─────────────────────────────────────────────────┐
│  Auth Layer    src/lib/auth/                                    │
│  session.ts（簽發/驗證/撤銷）· password.ts（argon2id）           │
│  guard.ts（getSession / requireUser / requireAuthor / requireOwner）│
└───────────────┬─────────────────────────────────────────────────┘
                │
┌───────────────▼─────────────────────────────────────────────────┐
│  Service Layer src/lib/services/                                │
│  業務規則 · 權限判斷 · Zod 驗證 · 交易編排 · 快取失效             │
│  novelService · chapterService · reviewService · bookshelfService│
│  authService · statsService · rankingService                    │
└───────────────┬─────────────────────────────────────────────────┘
                │
┌───────────────▼─────────────────────────────────────────────────┐
│  Repository Layer  src/lib/repositories/  ★ 可抽換邊界           │
│  全部 `import 'server-only'`；回傳 src/lib/types.ts 領域型別      │
│  novels · chapters · users · sessions · reviews · bookshelf      │
│  reading · rankings · categories · stats · search（雙軌分歧點）   │
└───────────────┬─────────────────────────────────────────────────┘
                │
┌───────────────▼─────────────────────────────────────────────────┐
│  src/lib/db.ts — 唯一建立 PrismaClient 之處（driver adapter）     │
└───────────────┬─────────────────────────────────────────────────┘
                │
        ┌───────┴────────┐
   SQLite（dev）    PostgreSQL（prod）
```

### 2.2 分層鐵律

| # | 規則 | 違反時的後果 |
|---|------|--------------|
| R1 | **page / component / action / Route Handler 一律不得 `import { prisma }`** | 破壞資料庫可抽換性，雙軌方案失效。**Route Handler 為第六輪明列**：憲章第 III 條原就涵蓋 API Route，但條列漏了它，導致 `/api/health` 需要「一次查詢的往返延遲」時沒有任何 repository 可用 —— 補 `repositories/health.ts` 的 `pingDatabase()` 承接（見 §5.3） |
| R2 | **所有寫入必須經 service → repository**（延續 `nextstep.md` E-3 的肯定） | 權限檢查與快取失效被繞過 |
| R3 | **權限判斷只發生在伺服器端**（Auth Layer / Service Layer） | 即 H-1 的根因，client 判斷等同無防護 |
| R4 | **repository 不做權限判斷**，但**必須接受 owner 條件參數**（如 `authorId`） | 責任混淆；但 repository 亦不可提供「無 owner 條件」的作者資料查詢 |
| R5 | **client component 不得 import `@/lib/repositories/*`**（已由 `server-only` 強制） | 建置期即報錯，現況已正確 |

### 2.3 目錄結構（新增部分）

```
src/
├─ app/
│  ├─ api/
│  │  ├─ auth/{register,login,logout,me}/route.ts
│  │  ├─ novels/route.ts、novels/[id]/{route.ts,chapters/route.ts,reviews/route.ts}
│  │  ├─ chapters/[id]/{route.ts,comments/route.ts}
│  │  ├─ search/route.ts
│  │  ├─ rankings/route.ts
│  │  ├─ bookshelf/[novelId]/route.ts
│  │  ├─ reading-progress/route.ts
│  │  ├─ history/route.ts
│  │  ├─ notifications/route.ts
│  │  ├─ cron/rankings/route.ts
│  │  └─ health/route.ts
│  ├─ author/actions.ts        ← 作者寫入 Server Actions
│  ├─ author/novels/[novelId]/page.tsx  ← 作品管理頁：卷、章節、排序、上下架、刪除的落點（FEAT-3）
│  ├─ profile/actions.ts       ← 個人設定 Server Actions
│  └─ auth/actions.ts          ← 登入／註冊 Server Actions
├─ lib/
│  ├─ auth/sessionToken.ts     ← 憑證層：簽發／驗簽／SESSION_COOKIE／hashToken
│  │                              **只相依 jose + env**，是 proxy.ts 唯一可引用的 auth 模組（§7.1）
│  ├─ auth/{session.ts,password.ts,guard.ts,rateLimit.ts,audit.ts}   ← audit：結構化安全事件輸出
│  │                              session.ts 經 repository，故 proxy.ts **不得**引用它
│  ├─ auth/{ownership.ts,origin.ts}   ← **不匯入 `next/navigation`** 的兩個守衛：擁有權判定，
│  │                              以及 `assertSameOrigin`／`SameOriginError`。`guard.ts` 兩者皆
│  │                              re-export，既有 import 路徑不變。
│  │                              **origin.ts 為 FEAT-4 裁示（2026-08-08，T102 落地時發現）**：
│  │                              `routeHelpers.ts` 原自 `guard.ts` 取 `SameOriginError`，
│  │                              而 `guard.ts` 匯入 `redirect()`，那條相依把 App Router 的
│  │                              React context 拉進本檔 —— 於是整合測試無法直接呼叫
│  │                              `assertCronSecret`（「`CRON_SECRET` 未設定即拒絕」這條分支
│  │                              只能在測試行程內直接驗守衛函式，見 §5.7），
│  │                              載入階段即以 `React.createContext is not a function` 失敗，
│  │                              而該訊息完全看不出跟來源比對有關。
│  │                              比對本身只需要兩個請求標頭、不需要轉址，故與 ownership.ts 同法拆出
│  ├─ time/taipeiDay.ts        ← FEAT-4 4-C：台北日界線的唯一定義（固定偏移純算術，不依賴 Intl）。
│  │                              匯出 TAIPEI_OFFSET_MS／taipeiDayStart／taipeiDayRange／
│  │                              taipeiDaysBetween／yesterdayTaipei／**taipeiDateString**。
│  │                              末項為 **T101 實作裁示（2026-08-08）補入**：圖表標籤與
│  │                              「統計截止日」需要 `YYYY-MM-DD`，而對日起點直接取
│  │                              `toISOString().slice(0,10)` 得到的是**前一天**
│  │                              （該絕對時刻的 UTC 日期為 16:00），畫面上每一格都會標錯日期；
│  │                              不給這一支，每個呼叫端就會各自重寫一次那個 `+8`，
│  │                              而服務層被明文禁止自行寫該魔術數
│  ├─ stats/viewerHash.ts      ← FEAT-4 4-C：`u:`／`a:` 兩命名空間的 HMAC（FR-034）
│  ├─ security/csp.ts          ← buildCspPolicy 純函式，proxy 與單元測試共用（§7.5）
│  ├─ env.ts                   ← validateEnv 純函式 + 模組層啟動期驗證（§3.5），缺關鍵密鑰即拒絕啟動
│  ├─ siteConfig.ts            ← SITE_URL 單一來源（讀 NEXT_PUBLIC_SITE_URL），metadata 一律取自此
│  ├─ services/{auth,novel,chapter,user,search,review,comment,bookshelf,reading,stats,ranking,notification}Service.ts
│  │                              user：§5.6 的四個個人設定 Action 的落點（FEAT-3 加性新增；
│  │                              不併入 authService，避免與登入註冊的限流與帳號枚舉防護共處一檔）
│  │                              search：search()／suggest()／normalize()／buildSearchText()，
│  │                              /search 頁與 /api/search 共用（FEAT-3）
│  ├─ validation/{auth.ts,novel.ts,chapter.ts,profile.ts,search.ts,review.ts,common.ts}   ← Zod，client/server 共用
│  │                              common：欄位長度上限常數與控制字元過濾（FEAT-3）
│  ├─ pagination/cursor.ts      ← encodeCursor／decodeCursor（base64url 複合游標，FEAT-4 T006）
│  │                              全部列表分頁共用；無效游標回 `null` 由呼叫端轉 400，**不擲出**
│  │                              （游標來自查詢字串，擲出會讓 `?cursor=%%%` 變成 500）
│  ├─ repositories/{novels,chapters,users,sessions,health,reviews,comments,bookshelf,reading,rankings,categories,stats,search,mappers,index}.ts
│  │                              health：pingDatabase()，/api/health 的延遲唯一來源（R1）
│  ├─ db.ts
│  ├─ cache.ts                 ← 快取 tag 常數與失效輔助
│  └─ types.ts
└─ scripts/build-schema.ts     ← 雙軌 schema 產生器（見 §3.2）

（CSP 的 nonce 由路由攔截層逐請求產生並向下傳遞，非建置期腳本；政策字串由 `lib/security/csp.ts`
 的純函式產生以便單元測試斷言，見 §7.5）

專案根目錄：
docker-compose.yml            ← 本機 PostgreSQL + 整合測試 DB（§3.2）
```

### 2.4 讀寫分工原則

| 情境 | 採用方式 | 例子 |
|------|----------|------|
| 表單提交、需 redirect／revalidate | **Server Action** | 建立作品、發佈章節、更新個資、登入註冊 |
| 前端需即時 fetch、無頁面轉場 | **Route Handler** | 搜尋建議（typeahead）、無限捲動載入、閱讀進度上報（`fetch` + `keepalive`，**非 `sendBeacon`**，見 §5.4） |
| 外部或排程呼叫 | **Route Handler** | `/api/cron/rankings`、`/api/health` |
| 純讀取且隨頁面渲染 | **RSC 直接呼叫 service** | 首頁、作品頁、閱讀頁 |

> 註：`/api/*` 同時作為未來行動端／第三方的公開介面，因此公開讀取端點即使頁面用 RSC 取資料，仍一併提供 Route Handler。

### 2.5 快取策略

| 資料 | 策略 | 失效時機 |
|------|------|----------|
| 作品列表／分類／新書 | tag `novels:list`、`category:{id}` | 作品發佈、下架、分類異動 |
| 作品詳情 | tag `novel:{id}` | 該作品或其章節異動 |
| 章節正文 | tag `chapter:{id}` | 章節內容更新 |
| 排行榜 | tag `ranking:{period}:{categoryId}` | 排程重算完成 |
| **使用者相關（書架、進度、通知、作者後台）** | **一律不快取** | — |

失效統一由 service 層呼叫 `src/lib/cache.ts` 的輔助函式觸發，禁止在 component 內散落 revalidate 呼叫。

> **API 名稱已結案（FEAT-3 T004，2026-07-31）**：用 **`revalidateTag(tag, 'max')`**。
> 單引數形式 `revalidateTag(tag)` 在 Next 16 已標記 deprecated；`updateTag()` **只能**在
> Server Action 內呼叫，而失效是由服務層發起的（服務層同時被 Action 與整合測試直呼），
> 故不適用。查證來源為隨版文件
> `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/`。
>
> **誠實標示**：本專案目前**尚無任何已標記的快取項目**（`cacheComponents` 未啟用、
> `src/` 內無 `cacheTag`），故三個失效呼叫實際上是無害的 no-op；介面與呼叫點先就位，
> 待快取真的掛上時不需要再去找散落的失效點。`revalidateTag` 依賴框架的請求範圍儲存區，
> 在請求範圍之外（整合測試直呼服務層）會擲錯，故 `cache.ts` 內吞下該例外並記錄。

---

## 3. 雙軌資料庫方案

### 3.1 相容性守則（Schema 撰寫規範）

為使 **同一份 model 定義** 能同時在 SQLite 與 PostgreSQL 上遷移與執行：

| 守則 | 說明 |
|------|------|
| ❌ 不使用 `enum` | SQLite 不支援；改用 `String` + TypeScript union 型別 + Zod 驗證 |
| ❌ 不使用純量陣列 `String[]` | SQLite 不支援；改用 join table（`NovelTag`、`NovelRelation`） |
| ❌ 不使用 provider-specific attribute | 如 `@db.Text`、`@db.Uuid`、`@@fulltext` |
| ✅ 可使用原生 `DateTime` | 兩者皆支援（SQLite 內部以整數儲存），**取代目前的 ISO 字串** |
| ✅ 可使用 `Decimal`／`Float`／`Int`／`Boolean`／`Json`？ | `Json` 在 SQLite 上有限制，**本架構一律以 `String` 存 JSON 字串**（僅 `Notification.payload`） |
| ⚠️ 大小寫敏感差異 | SQLite `LIKE` 預設不分大小寫（ASCII），PostgreSQL 敏感——差異由 `repositories/search.ts` 吸收 |

### 3.2 Schema 與 Migration 分軌

Prisma 的 `datasource.provider` **不接受環境變數**，且 `prisma/migrations/migration_lock.toml` 會鎖定 provider（現值 `sqlite`）。因此採「**共用 model + 產生器**」方案：

```
prisma/
├─ base.prisma                 # 只含 model 定義（無 datasource / generator）
├─ headers/
│  ├─ sqlite.prisma            # datasource + generator（sqlite）
│  └─ postgres.prisma          # datasource + generator（postgresql）
├─ generated/
│  ├─ schema.sqlite.prisma     # 由 scripts/build-schema.ts 產生（git ignore）
│  └─ schema.postgres.prisma
└─ migrations/
   ├─ sqlite/                  # 各自的 migration_lock.toml
   └─ postgres/
```

`prisma.config.ts` 依 `DATABASE_PROVIDER` 選擇 schema 與 migrations 路徑：

```ts
// prisma.config.ts
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

const provider = process.env.DATABASE_PROVIDER ?? 'sqlite'; // sqlite | postgresql
const key = provider === 'postgresql' ? 'postgres' : 'sqlite';

export default defineConfig({
  schema: `prisma/generated/schema.${key}.prisma`,
  migrations: {
    path: `prisma/migrations/${key}`,
    seed: 'tsx prisma/seed.ts',
  },
  datasource: { url: process.env['DATABASE_URL'] },
});
```

npm scripts 調整：

```jsonc
{
  "db:schema": "tsx scripts/build-schema.ts",           // 產生兩份 schema
  "db:generate": "npm run db:schema && prisma generate",
  "db:migrate": "npm run db:schema && prisma migrate dev",
  "db:seed": "tsx prisma/seed.ts",
  "db:reset": "npm run db:schema && prisma migrate reset --force"
}
```

> **實作待辦**：`prisma validate` 確認 Prisma 7.9 是否已支援 `provider = env(...)`；若已支援，可廢除 `build-schema.ts`，改為單一 schema 檔（migration 目錄仍須分軌）。

**既有 migration 的處置 —— 重置歷史**：

現有 `prisma/migrations/` 為單軌，內有 `20260722122104_init`、`20260722122840_author_tables` 兩筆。分軌時**刪除這兩筆**，於 `migrations/sqlite/` 與 `migrations/postgres/` **各重新產生一個初始 migration**，內容涵蓋本階段全部 schema 變更（`passwordHash`、`termsAcceptedAt`、移除 `isAuthor`、新增 `Session`）。

- **為何不保留**：舊 migration 只存在於 sqlite 軌會使兩軌歷史不對稱，日後每次變更都得判斷該筆在哪一軌存在；手工複製並改寫方言差異則產生「從未在 postgres 上執行過」的 migration，正確性無從驗證
- **可行前提**：本階段**尚無正式環境資料**，開發庫重建後由 `seed.ts` 還原（seed 本就先 `deleteMany` 再寫入，內容一致）。**此前提僅此一次成立，日後不得再用同一手法**
- **驗證**：自空資料庫套用初始 migration + seed 後，網站內容與改造前一致（§10.3 案例 3a 對應 User Story 3 情境 3a）

**參考資料由 migration 播種（FEAT-6 裁示，2026-08-13）**：站方參考分類 `Category` 6 筆
（玄幻／都市／言情／科幻／歷史／懸疑）MUST 由一筆**冪等**的 migration 寫入，
**MUST NOT 由 `seed.ts` 供給** —— `db:seed` 在正式環境 MUST NOT 執行（issue #7），
若參考資料只存在於 seed，正式環境將永遠缺這 6 筆，症狀是分類導覽與 `/categories` 空白且**無錯誤訊息**。
依本節的分軌規則，該筆 migration MUST 於 `migrations/sqlite/` 與 `migrations/postgres/` **各產生一次**。
此為「migration 內含資料寫入」的**唯一許可情形**：僅限站方參考資料，MUST NOT 用於任何內容或帳號資料。
（規格 FR-086、SC-026；`deploy/deployment.md` §3.4 已同步）

**本機 PostgreSQL 執行環境**：repo 內附 `docker-compose.yml`（PostgreSQL 服務 + 獨立的整合測試資料庫），開發者與自動化流程共用同一份設定，`docker compose up -d` 即可取得可用執行個體。前置條件僅為開發機已安裝 Docker，**不得依賴外部帳號、付費服務或手動前置作業**。此設定於 Phase 10（雙軌）與 Phase 11（全文索引）重複使用。

### 3.3 連線層（`src/lib/db.ts` 改寫要點）

```ts
const provider = process.env.DATABASE_PROVIDER ?? 'sqlite';

function createPrismaClient(): PrismaClient {
  if (provider === 'postgresql') {
    const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
    return new PrismaClient({ adapter });
  }
  const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? 'file:./dev.db' });
  return new PrismaClient({ adapter });
}

// 修正 M-3：singleton 不分環境一律掛 globalThis
const g = globalThis as unknown as { prisma?: PrismaClient };
export const prisma: PrismaClient = (g.prisma ??= createPrismaClient());
```

**修正 M-3 的理由**：原本只在 `NODE_ENV !== 'production'` 掛回全域，是為 dev HMR 而設；但在長駐伺服器（Node server / 容器）上，正式環境每次模組實體化都可能新建 client。無條件 singleton 對 serverless 與長駐皆正確，且 driver adapter 本身持有連線池。新增依賴：`@prisma/adapter-pg`。

### 3.4 雙軌分歧點（只有兩處）

**分歧點 1：全文搜尋 `src/lib/repositories/search.ts`**（修正 M-4）

現況 `searchNovels()` 把整張 Novel 表載入記憶體再 `filter`，為 O(n) 全表掃描。改為：

- `Novel.searchText`：寫入時由 service 預先組合 `title + penName + category + tags` 的正規化小寫字串（雙軌共用的相容做法），**上限 512 字元**（避開 PostgreSQL btree 索引列的大小限制）
- **SQLite**：`WHERE searchText LIKE ? ESCAPE '\'`（樣式為 `%term%`），搭配 `@@index([searchText])`；資料量再成長時可加掛 FTS5 虛擬表
- **PostgreSQL**：`ILIKE ? ESCAPE '\'`，以 **`pg_trgm` 的 GIN 索引**（`USING GIN (searchText gin_trgm_ops)`）加速，經 `$queryRaw` 執行；擴充啟用與索引一併以手寫 migration SQL 建立

> **不用 `tsvector`／`ts_rank`（FEAT-3 裁示，2026-07-30）**：原設計的 `to_tsvector('simple', …)`
> 對中文不切詞——無空白的中文標題會成為單一 token，搜「劍」無法命中「劍影行紀」，而 SQLite 的
> `LIKE '%劍%'` 會命中。兩軌若各自採全文比對與子字串比對，「結果與排序完全一致」即無從成立。
> 故兩軌統一為**子字串比對**，排序改用確定性鍵 `updatedAt DESC, id ASC`，不用任一資料庫種類
> 專屬的相關度分數。代價：trigram 索引對長度 < 3 的樣式無法使用，2 字元查詢退化為順序掃描——
> 本階段不訂搜尋回應時間目標，不為此加設計。

兩者對外皆是同一個介面，上層完全無感：

```ts
export interface SearchOptions { limit?: number; cursor?: string; categoryId?: string; }
export interface SearchRows { ids: string[]; hasMore: boolean; }

/** 兩步查詢：本層只回 id 集合，領域型別仍由 novels.ts + mappers.ts 產生 */
export async function searchNovelIds(query: string, opts?: SearchOptions): Promise<SearchRows>;
/** term 為**子字串**比對對象（非前綴）；建議模式同走 `%term%` */
export async function suggestNovels(term: string, limit?: number): Promise<NovelSuggestion[]>;
export function escapeLikePattern(raw: string): string;   // `\` `%` `_` 轉義，順序不可顛倒
```

本層的三項前提（FEAT-3 落地時補入）：

- **入參已正規化**：`query`／`term` 為 `searchService.normalize()` 的輸出（trim → 轉小寫 → 空白收斂）。
  `searchText` 以小寫落庫，查詢端若不轉小寫，兩軌對**非 ASCII** 字元的折疊行為即不同
  （SQLite 的 `LIKE` 只折疊 ASCII，PostgreSQL 的 `ILIKE` 依 locale 折疊更多），「完全一致」將只在 ASCII 成立
- **一律帶 `status = 'published'`**：草稿作品不進結果與建議
- **空字串短路**：不對 Novel 表發出任何查詢（M-4 的結構判準）

**分歧點 2：`repositories/mappers.ts`**（修正 E-2）

- `splitCsv` / `joinCsv` **移除**——`tags` / `relatedIds` 改 join table
- 日期欄位不再做 ISO 字串轉換——DB 已是原生 `DateTime`，mapper 僅在輸出領域型別時 `toISOString()`（`src/lib/types.ts` 對外仍是 `string`，UI 不受影響）

### 3.5 環境變數

| 變數 | 說明 | 範例 |
|------|------|------|
| `DATABASE_PROVIDER` | `sqlite`（預設）或 `postgresql` | `postgresql` |
| `DATABASE_URL` | 連線字串 | `file:./dev.db` / `postgresql://…` |
| `SESSION_SECRET` | jose 簽章密鑰（≥32 bytes） | — |
| `SESSION_TTL_DAYS` | session **閒置期限**天數，每次使用滑動延展（預設 30）。**僅用於 `Session.expiresAt`，不得用作 Cookie 的 `maxAge`** | `30` |
| `SESSION_ABSOLUTE_TTL_DAYS` | session **絕對上限**天數，自首次登入起算，滑動延展不得突破（預設 90）。**Cookie 的 `maxAge` 取此值 × 86400**（見 §7.1「Cookie 存活期」） | `90` |
| `SESSION_SLIDING_THROTTLE_HOURS` | 滑動延展的節流門檻，距上次延展未超過即只讀不寫（預設 24） | `24` |
| `TRUSTED_PROXY_HOPS` | 可信任的代理層數；自轉發標頭右側往左數第 N 個位址，未設或 0 只用直連位址 | `1` |
| `HEALTH_CHECK_SECRET` | `/api/health` 揭露詳細資訊所需的密鑰；未帶則只回 ok/fail | — |
| `SEED_USER_PASSWORD` | seed 三個示範帳號的密碼；未設定則各自隨機產生並印在 console。測試環境設固定值，兼作 a11y 套件的登入憑據（見 §10.1） | — |
| `SESSION_COOKIE_SECURE` | **FEAT-4 T150 新增（2026-08-08）**：工作階段 Cookie 是否加上 `Secure`，預設 `NODE_ENV === 'production'`（既有行為不變）。**新增的唯一理由**：`next start` 一律以 `NODE_ENV=production` 執行，而 **WebKit 不把 `http://localhost` 視為安全內容**、會直接丟棄 `Secure` 的 Cookie —— 讀者流在 webkit 上連登入都過不了，而 FR-059／SC-013 要求它在三種引擎**通過**。Chromium 與 Firefox 允許，故此差異只在跨引擎驗收時現形。**只認字面上的 `false`**，其餘值（含拼錯與空字串）一律回退到預設，使打錯字的結果是保守而非把 `Secure` 關掉；於 `NODE_ENV=production` 下被關閉時，啟動記錄 MUST 明確警示。**MUST NOT 用於任何對外部署** | `NODE_ENV === 'production'` |
| `CRON_SECRET` | `/api/cron/*` 的存取密鑰。**MUST NOT 列入啟動期必要變數**（FEAT-4 T004 裁示，2026-08-07，依 research R-11）：它的「未設定即一律拒絕」發生在三個排程 Route Handler 內（`assertCronSecret()`）。原本比照 `VIEW_HASH_SECRET` 列為啟動必要行不通——那會使本機開發者沒設就整個站啟動不了，而該密鑰只影響那三個入口 | — |
| `VIEW_HASH_SECRET` | **FEAT-4 新增（2026-08-06）**：`ChapterView.viewerHash` 的**固定**鹽值（≥32 bytes）。**未設定即拒絕啟動**（見下方啟動期驗證）。MUST NOT 隨日期輪替、MUST NOT 自 `SESSION_SECRET` 衍生——理由見 §4.2 `ChapterView.viewerHash` 註 | — |
| `VIEW_DEDUPE_WINDOW_MINUTES` | **FEAT-4 新增（2026-08-07 T004）**：閱讀去重窗口分鐘數（預設 30） | `30` |
| `VIEW_RETENTION_DAYS` | **FEAT-4 新增（2026-08-07 T004）**：`ChapterView` 與 `BookshelfEvent` 的保留期天數（預設 7）；**同時是成效總覽期間的上界**，兩者共用同一個值才不會出現「指標期間比明細保留期長」的空洞 | `7` |
| `CHAPTER_VIEW_RATE_MAX` | **FEAT-4 新增（2026-08-07 T004）**：閱讀上報限流上限（每分鐘／來源位址，預設 60）。超額為**靜默捨棄**，非 429 | `60` |
| `INTERACTION_RATE_MAX` | **FEAT-4 新增（2026-08-07 T004）**：評論與留言的限流上限（每分鐘／使用者，預設 10） | `10` |
| `READING_HISTORY_MAX` | **FEAT-4 新增（2026-08-07 T004）**：每人閱讀歷史上限，單位為**部作品**（預設 500） | `500` |
| `MERGE_BATCH_MAX` | **FEAT-4 新增（2026-08-07 T004）**：本機狀態合併時每類的筆數上限（預設 200）；超出時客戶端取最近者截斷並以 Toast 告知 | `200` |
| `NOTIFICATION_RETENTION_DAYS` | **FEAT-4 新增（2026-08-07 T004）**：`Notification` 保留期天數（預設 90） | `90` |
| `PROGRESS_REPORT_INTERVAL_SECONDS` | **FEAT-4 新增（2026-08-07 T004）**：閱讀進度的節流上報間隔秒數（預設 30） | `30` |
| `CRON_BASE_URL` | **FEAT-4 新增（2026-08-07 T004）**：`scripts/cron.ts` 觸發排程時的目標站台（預設 `http://localhost:3100`） | `http://localhost:3100` |
| `MAIL_MODE` | **FEAT-5 新增（2026-08-09）**：寄送實作的**唯一**選用依據，取值 `production`｜`memory`｜`console`。**MUST NOT 只依環境推導**——§10.3 的整合測試以正式建置產物啟動，測試伺服器的 `NODE_ENV` 是 `production`，靠推導會撞上下方「缺憑證即拒絕啟動」而根本起不來（理由見 §9 Phase 14 第 1 項）。未明示時才依 `NODE_ENV` 推導：`production` → `production`，其餘 → `console` | `memory`（`.env.test`）／`console`（本機） |
| `RESEND_API_KEY` | **FEAT-5 新增（2026-08-09）**：Resend HTTPS API 金鑰。**`MAIL_MODE=production` 時缺漏即拒絕啟動**；`memory`／`console` 兩模式 **MUST NOT** 要求它。**MUST NOT 進入版控的 `.env.test`** | — |
| `MAIL_FROM` | **FEAT-5 新增（2026-08-09）**：寄件位址（如 `NovelSite <noreply@網域>`）。同上，`production` 缺漏即拒絕啟動 | — |
| `CONTACT_EMAIL` | **FEAT-5 新增（2026-08-09）**：對外聯絡信箱，聯絡表單的**收件人**與隱私權頁直接列出的 `mailto:` 位址。**MUST NOT 加 `NEXT_PUBLIC_` 前綴**——那會把位址編進每一個 client bundle，而它只有兩處要用（由 Server Component 以 prop 下傳）。未設定時回落至過渡預設值並於啟動記錄**明確標示採用了預設值** | `contact@example.com`（過渡預設，上線 MUST 換為站台專用位址）。**2026-10-12 公開 repo 前由個人信箱改為 RFC 2606 保留網域的佔位值**：原值是開發者個人信箱，寫死在原始碼與測試中等於隨 repo 公開；`example.com` 不會把信送到任何真人，且未設定時啟動記錄仍會標示採用了預設值 |
| `PASSWORD_RESET_TOKEN_TTL_MINUTES` | **FEAT-5 新增（2026-08-09）**：重設憑證有效期分鐘數（預設 30）。**信件文案的分鐘數 MUST 取自本值，MUST NOT 寫死**——改了設定卻沒改文案，信上就寫一個假的時間，而這種錯誤不會讓任何測試變紅 | `30` |
| `PASSWORD_RESET_RATE_ACCOUNT_MAX` | **FEAT-5 新增（2026-08-09）**：重設申請的**帳號鍵**上限，窗為 **1 小時**（預設 3，門檻理由見 §7.6 該列）。位址鍵**沿用 `LOGIN_RATE_IP_MAX`，MUST NOT 另立變數**——多一個變數就多一個會與登入漂移的值 | `3` |
| `CONTACT_RATE_IP_MAX` | **FEAT-5 新增（2026-08-09）**：聯絡表單的位址鍵上限，窗為 **1 小時**（預設 3，比照註冊） | `3` |
| `MAIL_OUTBOX_PATH` | **FEAT-5 新增（2026-08-09）**：**僅 `memory` 模式使用**的寄件落地檔（JSON Lines）。預設 `process.cwd()`／`.mail-outbox.jsonl`，工作目錄一律是應用根 `novelsite/`、**非 repo 根**（基準寫錯會使 `novelsite/.gitignore` 的錨定管不到該檔）。落地而非記憶體的理由見 §9 Phase 14 第 1 項 | `<novelsite>/.mail-outbox.jsonl` |
| `MAIL_MEMORY_DELAY_MS` | **FEAT-5 新增（2026-08-09）**：`memory` 模式寫 outbox 前的人工延遲（預設 0，`.env.test` 設 **300**）。**它是「寄送確實發生在回應之後」那道測試的解析度**——設 0 該測試即失去鑑別力，兩條路徑的天然時間差只有數毫秒（見 §9 Phase 14 第 3 項） | `0`（測試 `300`） |
| `NEXT_PUBLIC_SITE_URL` | 站台網址（既有）。**FEAT-5 追加一條硬性斷言（2026-08-09）：`MAIL_MODE=production` 時本值未明示即拒絕啟動**——原有的靜默回落對 metadata／sitemap 只是標註不準，但重設連結是**絕對網址**，填錯等於每一封信裡的連結都指向別的網站，而系統仍回報「已寄出」。其餘 `MAIL_MODE` 維持既有回落，不影響開發與測試啟動 | `https://novelsite.tw` |
| `NEXT_PUBLIC_GA_ID` | GA4（既有，缺省即不輸出 script） | — |

> **上表 `SESSION_COOKIE_SECURE` 起的 10 列於 FEAT-4 的 T004 一次補齊**（2026-08-07）。原規劃（quickstart 初版）把 env 增量
> 分散在 4-A／4-B／4-C 三刀各自補，但 4-A 與 4-B 是**並行**開發的兩個 PR，
> 各自改 `env.ts` 必然衝突在同一個檔案的同一段——故改為 Phase 2 Foundational 一次補齊。
>
> **`MAIL_MODE` 起的 9 列為 FEAT-5 新增**（2026-08-09，於 `/speckit-analyze` 第二輪回寫本表）。
> 同樣採 Foundational 一次補齊（`tasks.md` T005），理由同上：5-A／5-B／5-C 三刀並行，
> 各自改 `env.ts` 必然衝突。**先前這 9 列只寫在 §9 Phase 14 的敘述段，沒有進本表** ——
> 而實作者照著做的是這張表，不是前言（`CLAUDE.md` 文件同步鐵律：回寫位置 MUST 是會被照著實作的那一處）。

**啟動期驗證（`src/lib/env.ts`）**：應用程式啟動時一次性檢查關鍵設定，**不足即明確失敗，不得靜默降級**：

- `SESSION_SECRET` 缺漏、長度 < 32 bytes 或等於範例值 → **拒絕啟動**並輸出指明缺哪一項的錯誤。**不得自動產生臨時密鑰** —— 那會讓每次重啟無聲登出全站使用者，且問題到上線後才浮現
- **`VIEW_HASH_SECRET` 缺漏或長度 < 32 bytes → 拒絕啟動**（FEAT-4 裁示，2026-08-06）。**不得以空字串或隨機值代替**——隨機鹽值會使每次重啟後全部匿名讀者變成新讀者，成效總覽的不重複讀者數隨部署跳動
- **`CRON_SECRET` 刻意不在本清單內**（FEAT-4 T004 裁示，2026-08-07，依 research R-11）。它未設定時的拒絕發生在三個 `/api/cron/*` handler 內而非啟動期；列入本清單會讓本機開發者沒設就啟動不了整個站。**「不在啟動期檢查」MUST NOT 被讀成「可放行」**——handler 端 MUST 在該值為 `undefined` 時一律回 401。**`assertCronSecret()` MUST 於每次呼叫當下讀取 `env.CRON_SECRET`，MUST NOT 在模組載入時解構成常數**（FEAT-4 裁示 2026-08-07，T091）：測試伺服器是獨立行程、其 `CRON_SECRET` 由 `.env.test` 在啟動時決定，測試無從讓它變成未設定，因此「未設定即拒絕」這條分支**只能在行程內直接呼叫守衛函式來驗證**；載入時解構會讓該分支永遠測不到，而它正是三個排程入口唯一的門。另：比對 MUST 為 `timingSafeEqual` 的全等比對，`undefined` 與缺標頭 MUST NOT 因「兩邊皆無值」而視為相符
- `DATABASE_PROVIDER` 與 `DATABASE_URL` 的協定不相符（如 `postgresql` 配 `file:`）→ 拒絕啟動
- **`MAIL_MODE=production`（含未明示而由 `NODE_ENV=production` 推導者）缺 `RESEND_API_KEY` 或 `MAIL_FROM` → 拒絕啟動**（FEAT-5 裁示，2026-08-09），錯誤訊息 MUST **各自**指名缺漏項。**MUST NOT 靜默降級為「不寄信」**——那會使正式站對每一次重設申請都回報「已寄出」而一封也沒寄。**`MAIL_MODE=memory` 或 `=console` 時 MUST NOT 要求任何憑證、MUST NOT 拒絕啟動**（`.env.test` 零憑證即須能啟動測試伺服器）
- **`MAIL_MODE=production` 且 `NEXT_PUBLIC_SITE_URL` 未明示 → 拒絕啟動**（FEAT-5 裁示，2026-08-09）。該值原有的靜默回落（`https://novelsite.tw`）對 metadata／sitemap 只是標註不準，但重設連結是絕對網址——**填錯等於每封信的連結都指向別的網站，而系統仍回報「已寄出」**。本項把它從軟性預設變成硬性正確性需求；其餘 `MAIL_MODE` 維持既有回落
- `TRUSTED_PROXY_HOPS` 未設定 → 啟動記錄輸出警示（部署於代理後方時會退化為全站共用單一位址，見 §7.6）
- **`MAIL_MODE=memory` 或 `=console` → 啟動記錄警示「目前不會真的寄信」**；**`CONTACT_EMAIL` 未設定 → 啟動記錄標示採用了過渡預設值**（FEAT-5 裁示，2026-08-09；沿用 `SESSION_COOKIE_SECURE` 的既有慣例）。**沒有警示的降級就是靜默降級**——這兩條與上面兩條「拒絕啟動」是同一個判準的兩端，不是可選的補充
- 速率限制採記憶體實作時 → 啟動記錄標示 `rateLimitMode=single-instance`，並於 `/api/health` 的密鑰回應中一併回報（見 §5.3、§7.6）

**驗證邏輯必須是純函式（第六輪修正）**：上述前兩項的檢查邏輯 MUST 實作於
`validateEnv(source: Record<string, string | undefined>)`，模組層僅
`export const env = validateEnv(process.env)`。理由與 §7.5 的 `buildCspPolicy` 相同 ——
若驗證只是模組載入的副作用，四種失敗情況**在單元測試層無法斷言**：測試行程必然已由
`loadTestEnv()` 注入合法設定（否則整個測試套件在 import 階段就全紅），要驗失敗路徑就得反覆
重設模組快取並改寫行程環境，脆弱且與測試框架實作耦合。**後兩項的啟動記錄屬副作用，
留在模組層，不得寫進 `validateEnv`**（否則單元測試每呼叫一次就污染一次標準輸出）。

**測試環境的變數載體（`.env.test`，隨 repo 版控）**：見 §10.1。兩點易錯處 ——
(a) `.gitignore` 的 `!.env.test` 反向例外**必須排在 `.env*` 之後**，否則完全無效果且無錯誤訊息；
(b) **`DATABASE_PROVIDER` 不得寫進該檔** —— 它是唯一由指令層傳入的變數，寫入後雙軌兩輪會跑在
同一種資料庫上，§10.5 的「兩者結果完全一致」將恆真而毫無驗證力。`DATABASE_URL` 則由
`tests/testEnv.ts` 的 `loadTestEnv()` 依當前 provider 自 `TEST_DATABASE_URL_{SQLITE,POSTGRES}` 強制覆寫。

---

## 4. 資料模型

### 4.1 設計重點

| 變更 | 原因 |
|------|------|
| **新增 `ChapterContent`（1:1 分表）** | 目前資料庫**完全沒有小說正文**；分表可讓章節列表查詢不拖入大文字欄位 |
| **`Chapter.isFree` 移除** | 平台全免費，H-3 在架構上消滅 |
| **`AuthorNovel` / `AuthorChapterDraft` 刪除** | 與 `Novel` / `Chapter` 欄位重複且無 owner 外鍵（E-1 的根因）；改以 `Novel.authorId` + `status` 表達 |
| **`Novel.authorId` FK → `User`** | 修正 E-1，使「越權編輯他人作品」在資料層即可防範 |
| **`tags` / `relatedIds` → join table** | 修正 E-2，移除 CSV workaround，雙軌相容且可索引 |
| **日期欄位 → 原生 `DateTime`** | 修正 E-2 |
| **`Review.userId` FK + 一人一評唯一鍵** | 目前 `Review.author` 只是字串，無法管理與防重複 |
| **`Bookshelf` / `ReadingProgress` / `ReadingHistory` / `ReaderPreference`** | 讀者狀態自 `localStorage` 上移至 DB，跨裝置同步 |
| **`NovelDailyStat` / `ChapterView`** | 作者儀表板目前用 `getAuthorDailyStats()` 公式造假 |
| **`RankingEntry` 加 `score` / `computedAt` / `categoryId`** | 排行榜自靜態 seed 改為由統計資料排程計算 |
| **`Novel.searchText`** | 雙軌全文搜尋的共用預算欄位 |

### 4.2 Schema 全文（`prisma/base.prisma`）

```prisma
// ─────────────────────────────────────────────
// 身分域（Identity）
// ─────────────────────────────────────────────
model User {
  id           String  @id @default(cuid())
  email        String  @unique
  passwordHash String                        // argon2id，永不存明碼（修正 H-2）
  name         String
  penName      String?                       // 作者筆名，未設定則沿用 name
  avatarColor  String  @default("linear-gradient(135deg,#d97706,#92400e)")
  bio          String  @default("")
  role         String  @default("reader")    // reader | author | admin —— 身分的唯一真相來源
                                             // 註：`isAuthor` 已移除。移除範圍 MUST 同時涵蓋
                                             // src/lib/types.ts 的 AuthUser 與其全部 UI 消費點
                                             // （目前為 AccountSettingsView 的身分顯示），
                                             // 只改 DB 會使 tsc --noEmit 失敗
  termsAcceptedAt DateTime                    // 同意服務條款與隱私權政策的時間戳（註冊時必填）
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  sessions      Session[]
  novels        Novel[]
  reviews       Review[]
  reviewLikes   ReviewLike[]
  comments      Comment[]
  bookshelf     Bookshelf[]
  progress      ReadingProgress[]
  history       ReadingHistory[]
  preference    ReaderPreference?
  notifications Notification[]

  @@index([role])
}

model Session {
  id         String   @id @default(cuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash  String   @unique               // 只存雜湊，cookie 內才是原始 token
  expiresAt  DateTime
  revokedAt  DateTime?
  userAgent  String   @default("")
  ip         String   @default("")
  createdAt  DateTime @default(now())
  lastUsedAt DateTime @default(now())

  @@index([userId])
  @@index([expiresAt])
}

// 密碼重設憑證（Phase 14／FEAT-5，FEAT-5 plan／data-model 裁示 2026-08-09）。
// Phase 14 第 2 項原文只寫「欄位層級定義於 /speckit-plan 落到 §4.2，屆時本列以該處為準」，
// 以下即為該定義。
model PasswordResetToken {
  id         String   @id @default(cuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash  String   @unique   // sha256(明碼) hex。明碼只存在於「產生 → 組進連結 → 寄出」這一段，
                                // 永不落庫、永不進記錄。**不用 argon2**：256-bit 隨機值沒有字典
                                // 攻擊面，慢雜湊只會拖慢使用者點連結的當下（同 Session.tokenHash）
  expiresAt  DateTime           // 建立時刻 + PASSWORD_RESET_TOKEN_TTL_MINUTES（預設 30）
  consumedAt DateTime?          // 失效時刻。**一個欄位承載兩種來源**：成功使用一次、或被作廢
                                // （申請新憑證／使用者自行改密碼）。不拆兩欄 —— 兩者對「還能不能用」
                                // 的答案完全相同，拆開只會多一個永遠要同時檢查的條件；
                                // 需分辨來源時查安全事件記錄，不查這張表
  createdAt  DateTime @default(now())

  @@index([userId])
  @@index([expiresAt])
}
// 「同一使用者至多一筆有效」（Phase 14 第 2 項）**以交易內先作廢再建立達成，
// MUST NOT 用部分唯一索引** —— 後者的兩軌語法與 Prisma 支援程度不同，會開出本專案
// 第二個雙軌分歧點（至今唯一一處是 repositories/search.ts）。語意等價、零分歧。
// 有效性判準只有一句：consumedAt IS NULL AND expiresAt > now()。
// 聯絡訊息**刻意沒有對應的 model**：只落庫而無人閱讀的資料是純粹的負債，
// 站上沒有、Phase 14 也不做站內訊息管理介面（寄送失敗的退路是「直接來信」）。

// ─────────────────────────────────────────────
// 內容域（Content）
// ─────────────────────────────────────────────
model Novel {
  id          String  @id @default(cuid())
  slug        String  @unique
  title       String
  authorId    String
  author      User    @relation(fields: [authorId], references: [id], onDelete: Cascade)
  categoryId  String
  category    Category @relation(fields: [categoryId], references: [id])

  cover       String?
  coverColor  String
  excerpt     String  @default("")
  description String  @default("")

  status       String @default("draft")     // draft | published
  serialStatus String @default("ongoing")   // ongoing | completed | hiatus
  updateFreq   String?

  // 反正規化計數。**FEAT-4 裁示（2026-07-31）的維護分工**（原文「由 service 於寫入時維護」
  //   字面上要求閱讀數也於每次閱讀即時寫入，會使高頻寫入集中於同一列且與去重窗口語意衝突）：
  //   ① `favoriteCount`／`commentCount`／`rating`／`ratingCount` —— 於對應寫入操作的**同一交易**內即時增減；
  //   ② `totalViews`／`weeklyViews` —— **由 /api/cron/rollup-stats 回填**（週閱讀＝近 7 日新增量加總），
  //      MUST NOT 於每次閱讀即時寫入；
  //   ③ 每日彙總**同時以明細重算校正 ①**，使長期飄移可被自動修正
  wordCount     Int   @default(0)
  chapterCount  Int   @default(0)
  rating        Float @default(0)               // FEAT-4 裁示（2026-08-07，T047 撰寫時）：
                                                //   **`ratingCount` 為 0 時本欄 MUST 一併歸零**。
                                                //   原文只寫「同步重算」而未定義空集合，照字面實作
                                                //   「沒有評論就不動這一欄」是合規的 —— 於是唯一的評論者
                                                //   刪除後，作品仍掛著 4.5 顆星而評分人數為 0，
                                                //   畫面上就是一個沒有任何原始紀錄支撐的數字
                                                //   （與 §4.4 的 FR-043a「MUST NOT 寫入無原始紀錄支撐的統計」同一條理由）。
                                                //   驗收落點：tests/integration/review-one-per-user.test.ts
  ratingCount   Int   @default(0)               // FEAT-4 查核（2026-08-06）：本欄與下方
                                                //   `@@index([weeklyViews])` 在 `base.prisma` **實際不存在**，
                                                //   為 FEAT-2 落地時的遺漏。計分公式的
                                                //   `rating × ratingCount × 0.5`（§5.7）與「評分人數同步更新」
                                                //   皆依賴它，故 FEAT-4 的 `4b_interaction` migration 補齊
  totalViews    Int   @default(0)
  weeklyViews   Int   @default(0)
  favoriteCount Int   @default(0)
  commentCount  Int   @default(0)
  isFeatured    Boolean @default(false)

  searchText  String @default("")            // 雙軌搜尋預算欄位（小寫正規化，上限 512 字元）
  publishedAt DateTime?                      // 上架時間；「新書」＝近 30 天內
  createdAt   DateTime @default(now())
  updatedAt   DateTime @default(now())       // 搜尋主排序鍵，**由 service 明確賦值**，不用 @updatedAt
                                             // （FEAT-3 裁示：@updatedAt 於 seed 時會被蓋成當下時間，
                                             //   兩軌 seed 時刻不同會使排序鍵的 tie 分布不同，
                                             //   「兩軌排序完全一致」就變成靠時序巧合）

  volumes   Volume[]
  chapters  Chapter[]
  tags      NovelTag[]
  relations NovelRelation[] @relation("NovelRelationFrom")
  relatedBy NovelRelation[] @relation("NovelRelationTo")
  reviews   Review[]
  bookshelf Bookshelf[]
  progress  ReadingProgress[]
  history   ReadingHistory[]
  stats     NovelDailyStat[]
  rankings  RankingEntry[]

  @@index([authorId])
  @@index([categoryId])
  @@index([status, publishedAt])
  @@index([status, updatedAt])               // 搜尋與列表的排序鍵（FEAT-3）
  @@index([weeklyViews])
  @@index([searchText])                      // PostgreSQL 軌另有手寫的 pg_trgm GIN，見 §3.4
}

model Volume {
  id        String   @id @default(cuid())
  novelId   String
  novel     Novel    @relation(fields: [novelId], references: [id], onDelete: Cascade)
  number    Int                             // 由 service 自動指派為「該作品目前最大卷編號 +1」，作者不可編輯
  title     String
  createdAt DateTime @default(now())

  chapters Chapter[]

  @@unique([novelId, number])               // 併發建卷撞號時由此攔下，service 轉譯為 409
  @@index([novelId])
}

model Chapter {
  id          String   @id @default(cuid())
  novelId     String                          // 反正規化，供不經 volume 的直接查詢
  novel       Novel    @relation(fields: [novelId], references: [id], onDelete: Cascade)
  volumeId    String
  volume      Volume   @relation(fields: [volumeId], references: [id], onDelete: Cascade)

  number      Int                             // 由 service 自動指派為「該作品目前最大章節編號 +1」，作者不可編輯
  title       String
  wordCount   Int      @default(0)
  status      String   @default("draft")      // draft | published（發佈與下架雙向）
  publishedAt DateTime?
  scheduledAt DateTime?                        // 排程發佈時間
                                               // ⏸ **FEAT-3 不建立此欄位**：真正執行發佈的
                                               //    /api/cron/publish-scheduled 屬 FEAT-4，
                                               //    沒有 cron 的排程等於「設定了但永遠不會發佈」，
                                               //    屬共通完成準則明文禁止的半殘狀態。隨該 cron 一併落地
  viewCount   Int      @default(0)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  content  ChapterContent?
  comments Comment[]
  // 註：本模型「不存在」isFree 欄位——平台全免費（H-3 已移除）

  @@unique([novelId, number])
  @@index([volumeId])
  @@index([novelId, status, number])
}

/// 章節正文（1:1 分表，避免列表查詢載入大欄位）
model ChapterContent {
  chapterId    String   @id
  chapter      Chapter  @relation(fields: [chapterId], references: [id], onDelete: Cascade)
  bodyMarkdown String                          // 作者輸入的 Markdown 原文
  format       String   @default("markdown")   // markdown | plain
  updatedAt    DateTime @updatedAt
}

model Category {
  id          String @id
  slug        String @unique
  label       String
  emoji       String
  description String
  color       String
  bgColor     String
  sortOrder   Int    @default(0)

  novels   Novel[]
  rankings RankingEntry[]

  @@index([sortOrder])
}

model Tag {
  id    String @id @default(cuid())
  name  String @unique
  slug  String @unique
  novels NovelTag[]
}

model NovelTag {
  novelId String
  tagId   String
  novel   Novel @relation(fields: [novelId], references: [id], onDelete: Cascade)
  tag     Tag   @relation(fields: [tagId], references: [id], onDelete: Cascade)

  @@id([novelId, tagId])
  @@index([tagId])
}

model NovelRelation {
  novelId        String
  relatedNovelId String
  sortOrder      Int   @default(0)
  novel          Novel @relation("NovelRelationFrom", fields: [novelId], references: [id], onDelete: Cascade)
  relatedNovel   Novel @relation("NovelRelationTo", fields: [relatedNovelId], references: [id], onDelete: Cascade)

  @@id([novelId, relatedNovelId])
  @@index([relatedNovelId])
}

// ─────────────────────────────────────────────
// 讀者域（Reader State）
// ─────────────────────────────────────────────
model Bookshelf {
  id        String   @id @default(cuid())
  userId    String
  novelId   String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  novel     Novel    @relation(fields: [novelId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())
  // FEAT-4 裁示（2026-07-31）：登入後的本機資料合併**採聯集**，雙方皆有者保留此處既有的
  //   `createdAt`。本機書架的儲存格式是純識別碼陣列（`["id1","id2"]`）、**不帶時間戳**，
  //   「時間較新者勝」對它無從判定 —— 該規則只適用於帶時間戳的 ReadingHistory 與 ReadingProgress
  // FEAT-4 裁示（2026-08-06）：合併的**觸發條件為「該瀏覽器尚存未同步的本機資料」**，
  //   MUST NOT 以帳號層級的「首次登入」旗標判定 —— 本機資料存在於**每一個瀏覽器**，
  //   帳號旗標會使第二台裝置上以訪客身分累積的資料永遠無法上傳。
  //   **合併成功後 MUST 清除本機資料**（清除 MUST NOT 早於伺服器確認寫入成功，
  //   中斷時須留存以供續行）：這使冪等成為自然結果，並讓「已在別台移出的收藏被聯集加回」
  //   這個已知代價至多發生一次，而非每次登入重演
  // FEAT-4 裁示（2026-08-07）：**觸發判定與清除的對象只有「書架」與「閱讀歷史」兩個本機鍵**。
  //   原文寫「本機該類資料」涵蓋三類，與 ReaderPreference 的跨裝置同步互相抵銷 ——
  //   字級（`novelsite-reader-prefs`）與主題（`novelsite-theme`）在**登入態仍會被 Hook 持續回寫**
  //   （它們同時是離線快取與閱讀頁首次繪製的防閃爍來源，`useTheme` 必須在 hydration 前讀到值），
  //   把它們納入觸發判定，合併就會被自己回寫的快取重新命中，「下次登入不再觸發」永遠不成立。
  //   偏好與主題 MUST 隨合併酬載一併上傳，但 MUST NOT 清除、MUST NOT 作為觸發條件；
  //   其重複上傳無副作用 —— ReaderPreference 已明訂伺服器有紀錄時不覆蓋，第二次以後即為空操作

  @@unique([userId, novelId])
  @@index([userId, createdAt])
  @@index([novelId])                          // 追更通知的收件人查詢（FEAT-4 §5.7）
}

// FEAT-4 新增（2026-08-06，plan 階段裁示）
// **存在理由**：`NovelDailyStat.favorites` 是「當日**淨增**收藏數（加入減移出）」，
//   但移出書架是上方 `Bookshelf` 列的**硬刪除** —— 資料庫裡不存在「當日移出了幾筆」
//   的紀錄，彙總作業無從算出淨增。而「每日彙總只處理已結束日期並**回補**」的裁示
//   （見 §5.7 rollup-stats）又排除了「以 `Novel.favoriteCount` 每日快照相減」的作法：
//   回補時中間日期的快照不存在，只能得到區間總和，逐日 delta 無法還原。
//   **沒有這張表，「淨增」在資料上不可計算**，排行的名次驗證無從成立。
// 已評估並排除：(a) 改為「當日新增」不減移出 → 推翻淨增裁示，取消收藏對熱度毫無影響；
//   (b) `Bookshelf` 改軟刪除 → `@@unique([userId, novelId])` 使「移出後重新加入」撞唯一鍵，
//   須以 upsert 復活，而復活會覆蓋移出痕跡，淨增仍算不出來（與 `Review` 硬刪除同一個坑）。
model BookshelfEvent {
  id        String   @id @default(cuid())
  userId    String                            // 不設 FK：使用者刪除後事件仍保留至保留期結束
  novelId   String
  novel     Novel    @relation(fields: [novelId], references: [id], onDelete: Cascade)
  delta     Int                               // +1 加入 / -1 移出；值域由服務層保證
  createdAt DateTime @default(now())

  @@index([novelId, createdAt])
  @@index([createdAt])                        // 保留期清理（同 ChapterView，預設 7 天）
}

model ReadingProgress {
  id            String   @id @default(cuid())
  userId        String
  novelId       String
  chapterId     String
  percent       Int      @default(0)          // 0-100，章節內捲動百分比
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  novel         Novel    @relation(fields: [novelId], references: [id], onDelete: Cascade)
  updatedAt     DateTime @updatedAt

  @@unique([userId, novelId])
  @@index([userId, updatedAt])
}

model ReadingHistory {
  id        String   @id @default(cuid())
  userId    String
  novelId   String
  chapterId String                              // 該作品最後閱讀的章節
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  novel     Novel    @relation(fields: [novelId], references: [id], onDelete: Cascade)
  readAt    DateTime @default(now())

  // FEAT-4 裁示（2026-07-31）：本表是**每人每作品一筆最新**，非事件序列 ——
  //   再次閱讀時 upsert 更新 `chapterId` 與 `readAt`，MUST NOT 每次閱讀各存一筆。
  //   理由：現行 UI 與本機行為皆為此語意（`ReadingHistoryView` 以 `novelId` 為列表鍵、
  //   刪除亦以作品為單位），照事件序列實作會使列表鍵重複、同一作品出現十幾次；
  //   事件序列的價值在統計，而統計已由 `ChapterView` 承擔，不需要第二份。
  //   保留上限為每人 **500 部作品**，超出時淘汰最久未讀者
  @@unique([userId, novelId])
  @@index([userId, readAt])
}

model ReaderPreference {
  userId     String   @id
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  fontSize   String   @default("md")          // sm | md | lg —— **沿用既有本機值域**
  theme      String   @default("light")       // light | dark | eyecare
  updatedAt  DateTime @updatedAt
  // FEAT-4 裁示（2026-07-31）：原設計為數值字級（14|18|22）+ `lineHeight Float`，
  //   但現況是 `useReaderPrefs` 的字級值域為 sm/md/lg、主題由全站的 `useTheme` 管理，
  //   而**行高全站沒有任何控制項** —— 同步一個使用者調不到的值等於憑空多做一個 UI。
  //   故 `lineHeight` 移除、`fontSize` 改為既有值域；無干擾模式亦不同步
  //   （`useReaderPrefs` 明訂其不跨章節記憶）。見 features.md FEAT-4 範圍調整第 5 項
}

// ─────────────────────────────────────────────
// 互動域（Interaction）
// ─────────────────────────────────────────────
model Review {
  id        String   @id @default(cuid())
  novelId   String
  userId    String
  novel     Novel    @relation(fields: [novelId], references: [id], onDelete: Cascade)
  user      User     @relation(fields: [userId], references: [id])
                                                // FEAT-4 實作裁示（2026-08-07，T054）：`user` 的
                                                // `onDelete` **維持預設的 Restrict**，不改為 Cascade。
                                                // 為什麼原文不適用：`tests/helpers/resetAuthTables.ts` 自 FEAT-2 起
                                                // 就以「該使用者名下有無評論」決定要不要保留他（`reviews: { none: {} }`），
                                                // 而該規則成立的前提正是刪不掉有評論的使用者；
                                                // 改為 Cascade 會讓刪使用者連帶靜默刪掉評論，
                                                // 而評論是**別人也看得到的公開內容**，不該隨帳號消失無聲蒸發。
  rating    Int                                 // 1-5
  content   String                              // FEAT-4 裁示（2026-08-06）：長度 **1–1000 字**
                                                // （trim 後不得為空）。原文只寫「須有長度上限」而無數值，
                                                // 導致「超長內容回 400」不可測、驗證結構無從撰寫。
                                                // 取 1000 而非 2000：評論區若預設需折疊與「展開全文」，
                                                // 就多一個控制項與一組 a11y 檢查。
                                                // 數值 MUST 併入 `lib/validation/common.ts` 的長度常數集中管理
  likeCount Int      @default(0)
  status    String   @default("visible")        // visible | hidden
                                                // FEAT-4 裁示（2026-07-31）：**`deleted` 不使用** ——
                                                // 評論的刪除是**實際移除該列**（讚一併移除）。
                                                // 理由：軟刪除保留該列會使下方的一人一評唯一鍵在
                                                // 「刪除後重新評論」時直接衝突，需為此發明復用特例；
                                                // 評論無子節點，硬刪除是最乾淨且無特例的解
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  likes ReviewLike[]

  @@unique([novelId, userId])                   // 一人一評
  // FEAT-4 實作裁示（2026-08-07，T054）：原文的 `@@index([novelId, createdAt])` 已被下列兩個
  // **複合索引取代**。為什麼原文不適用：評論列表有 `hot`／`latest` 兩種排序，兩者的游標條件都是
  // 「排序主鍵 + `id` 決勝」（`data-model.md` §6、FR-023b）—— `hot` 走 `likeCount DESC, id ASC`，
  // 原索引完全用不上；`latest` 走 `createdAt DESC, id ASC`，原索引少了決勝鍵那一欄。
  @@index([novelId, likeCount, id])             // hot 排序的游標索引
  @@index([novelId, createdAt, id])             // latest 排序的游標索引
}

model ReviewLike {
  reviewId  String
  userId    String
  review    Review   @relation(fields: [reviewId], references: [id], onDelete: Cascade)
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())

  @@id([reviewId, userId])
  @@index([userId])
}

model Comment {
  id        String   @id @default(cuid())
  chapterId String
  userId    String
  parentId  String?                              // 樓中樓
  chapter   Chapter  @relation(fields: [chapterId], references: [id], onDelete: Cascade)
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  parent    Comment? @relation("CommentThread", fields: [parentId], references: [id], onDelete: Cascade)
  replies   Comment[] @relation("CommentThread")
  content   String                               // FEAT-4 裁示（2026-08-06）：長度 **1–500 字**
                                                 // （trim 後不得為空）。與 `Review.content` 的 1000 字
                                                 // **刻意不同**：評論是對整部作品的完整評價，章末留言是一句話，
                                                 // 同一個數字必有一邊不合用；500 對齊既有的 `userBio` 級距。
                                                 // 數值 MUST 併入 `lib/validation/common.ts` 集中管理
  likeCount Int      @default(0)                 // FEAT-4 裁示（2026-08-06，analyze 階段）：
                                                 // **本階段不提供留言按讚的寫入路徑，此欄值恆為 0**。
                                                 // 為什麼原文不適用：FEAT-4 spec 自始未定義留言按讚的需求、
                                                 // 端點、去重規則與通知對象，`§5.4` 的端點表也只有
                                                 // `POST|DELETE /api/reviews/{id}/like`（**評論**按讚），
                                                 // 沒有留言按讚的對應列 —— 欄位存在而無任何寫入路徑，
                                                 // 照原文實作只會產生一個永遠是 0 的欄位與一個沒有後端的 UI 控制項。
                                                 // 欄位**保留**（後續階段補上需求時即可啟用），
                                                 // 沿用 `Notification.type` 其餘型別「保留欄位、不產生資料」的同一作法。
  status    String   @default("visible")         // visible | hidden | deleted
                                                 // FEAT-4 裁示（2026-07-31）：留言的刪除是**標記 `deleted`
                                                 // 並保留節點**（顯示「此留言已刪除」，原文不再呈現），
                                                 // **MUST NOT 實際移除該列** —— 上方 `parent` 為級聯刪除，
                                                 // 硬刪除會**連坐刪光他人掛在下面的回覆**，等於用「刪除自己的
                                                 // 內容」抹掉別人說過的話。子回覆 MUST 維持可見；
                                                 // 墓碑不可回覆、不計入留言熱度。
                                                 // （原文另寫「不可按讚」，已於 2026-08-06 移除 ——
                                                 //   它預設了一個本階段不存在的功能，見上方 `likeCount` 註。）
                                                 // `parent` 的級聯僅在章節／作品刪除時生效。
                                                 // `hidden` 為作者隱藏（見 §6.2），內容同樣不得被竄改
  createdAt DateTime @default(now())

  @@index([chapterId, createdAt])
  @@index([userId])
}

model Notification {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  type      String                               // chapter_published | review_reply | comment_reply | system
                                                 // FEAT-4 只產生 `chapter_published`（追更）一種；其餘三種
                                                 // 保留欄位但不產生 —— 回覆類需另定自我回覆排除與樓中樓多層的
                                                 // 通知對象／去重規則，系統公告需要目前不存在的管理端入口。
                                                 // 追更通知：**同一作品在同一次排程作業執行中發佈多章合併為一則**
                                                 // （payload 含新增章節數與最新章名），立即發佈則每次各一則；
                                                 // **作者本人不產生**
  payload   String   @default("{}")              // JSON 字串（雙軌相容，不用 Json 型別）
                                                 // 追更通知的六欄形狀見 data-model.md §2.8。
                                                 // **`novelSlug` 與 `novelId` 同值**（FEAT-4 實作裁示
                                                 // 2026-08-08／T127）：`Novel` 沒有 slug 欄位，作品網址就是
                                                 // `/novels/{id}`。原文預設有一組對外識別字串，實際上沒有；
                                                 // 為此新增一欄只會多一個要維護的唯一鍵，而畫面上毫無差別。
                                                 // 該格仍保留（不省略），前端與測試依賴的是那個固定形狀
  readAt    DateTime?
  createdAt DateTime @default(now())

  @@index([userId, createdAt])
  @@index([userId, readAt])
}

// ─────────────────────────────────────────────
// 統計與排行（Analytics）
// ─────────────────────────────────────────────
model NovelDailyStat {
  id        String   @id @default(cuid())
  novelId   String
  novel     Novel    @relation(fields: [novelId], references: [id], onDelete: Cascade)
  date      DateTime                             // 日界線為 **Asia/Taipei 00:00**（存其對應的絕對時刻）
                                                 // FEAT-4 裁示：原註為「當日 00:00 UTC」，但以 UTC 切日時
                                                 // 儀表板上的「7/31」實為台北 7/31 08:00～8/1 08:00，
                                                 // 流量最高的深夜時段被切到隔天
  // 三個計數皆為**當日新增量（delta）**，MUST NOT 存累計快照 ——
  //   排行取近 N 日加總，存快照則同一批收藏會被重複計 N 次，名次驗證無從成立
  views     Int      @default(0)                 // 當日去重閱讀次數
  favorites Int      @default(0)                 // 當日**淨增**收藏數（加入減移出）
  comments  Int      @default(0)                 // 當日新增的章節留言 + 作品評論（不含已隱藏者）

  @@unique([novelId, date])
  @@index([date])
}

model ChapterView {
  id         String   @id @default(cuid())
  chapterId  String
  novelId    String
  userId     String?
  viewerHash String                              // 未登入者：IP+UA 雜湊，用於去重（MUST 不可還原）
  // FEAT-4 裁示（2026-08-06）：雜湊 MUST 以**專用環境變數**提供的**固定鹽值**計算
  //   （`VIEW_HASH_SECRET`），未設定時應用**啟動失敗**（沿用 `SESSION_SECRET` 的作法）。
  //   **鹽值 MUST NOT 隨日期輪替**：成效總覽的完讀率與收藏轉換，其分母為**近 7 日的
  //   不重複讀者數**（見 §5.7 成效總覽），鹽值輪替會使同一位匿名讀者跨日被計為多位、
  //   分母膨脹最多 7 倍，而多數讀者未登入。亦 MUST NOT 自 `SESSION_SECRET` 衍生 ——
  //   輪換工作階段金鑰會連帶重置全部匿名識別值，兩者的輪換週期須各自獨立。
  //   MUST NOT 於未設定時以空字串或隨機值代替（隨機值使每次重啟後匿名讀者全變新讀者）。
  //   可關聯期間受本表 7 天保留期天然限制。
  // FEAT-4 裁示（2026-07-31）：**作品擁有者本人的閱讀 MUST NOT 記錄** ——
  //   作者不是自己作品的讀者，計入會使 /author/earn 的成效指標對其本人失去意義，
  //   且 30 分鐘去重窗口下作者一天可在每章刷出 48 次曝光，排行分數可被自行灌水。
  //   上報時機為**閱讀頁載入完成即上報**，不設停留／捲動門檻（重複由去重窗口擋下）。
  //   **上報入口 MUST 以來源位址為鍵限流**（預設 60 次/分鐘，`CHAPTER_VIEW_RATE_MAX`），
  //   超額**靜默捨棄**（回成功但不寫入，MUST NOT 回 429 —— 上報是背景請求，
  //   回錯誤只會讓攻擊者測出門檻並在正常使用者的主控台留下噪音）。
  //   去重窗口 MUST NOT 作為唯一防線：其鍵含 UA，換一個即是新的去重鍵
  viewedAt   DateTime @default(now())

  @@index([chapterId, viewedAt])
  @@index([novelId, viewedAt])
  @@index([viewerHash, chapterId])
}

model RankingEntry {
  id          String   @id @default(cuid())
  period      String                             // weekly | monthly | alltime
  categoryId  String   @default("all")           // "all" 或分類 id（避免 nullable 進唯一鍵）
  // FEAT-4 裁示（2026-08-06）：唯一鍵 MUST 為 `[period, categoryId, rank]`。
  //   現行 `base.prisma` 為 `@@unique([period, rank])`（FEAT-2 時尚無分類維度），
  //   沿用會使不同分類的同名次互相排斥 —— 第二個分類的第 1 名根本寫不進去。
  rank        Int
  novelId     String
  novel       Novel    @relation(fields: [novelId], references: [id], onDelete: Cascade)
  category    Category? @relation(fields: [categoryId], references: [id])
  score       Float    @default(0)
  change      String?                            // up | down | same | new
  changeCount Int?
  computedAt  DateTime @default(now())

  @@unique([period, categoryId, rank])
  @@index([period, categoryId])
}
```

### 4.3 舊 → 新對照

| 舊 | 新 | 備註 |
|----|----|------|
| `Novel.author`（字串） | `Novel.authorId` → `User` | 領域型別 `Novel.author` 由 mapper 取 `user.penName ?? user.name` 填入，UI 不變 |
| `Novel.category`（label 字串） | `Novel.categoryId` → `Category` | mapper 輸出 label，UI 不變 |
| `Novel.tags`（CSV） | `NovelTag` join table | mapper 輸出 `string[]`，UI 不變 |
| `Novel.relatedIds`（CSV） | `NovelRelation` | 同上 |
| `Novel.isNew` | 由 `publishedAt` 推導（近 30 天） | 移除欄位，避免資料腐化 |
| `Novel.releasedAt` | `publishedAt` | 語意統一 |
| `Novel.latestChapterId` / `firstChapterId` | 查詢時計算 | 移除冗餘欄位 |
| `Chapter.publishedAt`（ISO 字串） | `DateTime` | E-2 |
| **`Chapter.isFree`** | **刪除** | **H-3：平台全免費** |
| 章節正文（`generateChapterParagraphs()` 造假） | `ChapterContent.bodyMarkdown` | N-1 |
| `AuthorNovel` | `Novel`（`status` + `authorId`） | E-1 / N-2 |
| `AuthorChapterDraft` | `Chapter` + `ChapterContent`（`status='draft'`） | E-1 / N-2 |
| `Review.author` / `avatar` / `avatarColor`（字串） | `Review.userId` → `User` | 顯示資訊改由關聯取得 |
| `User.password`（明碼） | `User.passwordHash`（argon2id） | H-2 |
| `localStorage` 書架／歷史／偏好 | `Bookshelf` / `ReadingHistory` / `ReadingProgress` / `ReaderPreference` | N-3 |
| `getAuthorDailyStats()` 公式造假 | `NovelDailyStat` + `ChapterView` | N-6 |

### 4.4 資料遷移註記

現有 `dev.db` 為展示用 seed（13 Novel / 3 Volume / 60 Chapter / 14 Review / 30 RankingEntry / 1 User）。因欄位語意大幅改變且**章節正文從無到有**，採 **重建（rebuild）而非增量遷移**：

1. 新增 `prisma/seed-data/`：每部作品一個資料夾，章節正文以 `.md` 檔存放（可由 `novels/novel/` 目錄的既有內容匯入，若無則以人工撰寫的示範正文取代）。〔FEAT-2 註（2026-07-24）：本階段示範作品全數採人工精簡示範正文；`novels/novel/` 下的 3 部真實小說（天啟／聽雨風雲錄／社區醫館）暫不納入 seed，其 `.md` 留原位供使用者手動測試〕
2. `prisma/seed.ts` 改寫：建立**三個 `User`**（角色 `reader` / `author` / `admin` 各一，覆蓋全部權限守衛分支；密碼經 argon2id hash，**不再印在 UI**）→ `Category` → `Novel` → `Volume` → `Chapter` + `ChapterContent`
   > **FEAT-4 裁示（2026-07-31）**：原文尾端的「→ `Review`（綁真實 user）→ 統計資料」**已刪除**。示範資料
   > **MUST NOT 寫入任何無原始紀錄支撐的統計**——作品的 `rating`／`ratingCount`／`totalViews`／`weeklyViews`／
   > `favoriteCount`／`commentCount` 一律為 0，且 **MUST NOT 建立 `Review`／`Bookshelf`／`ChapterView`／
   > `NovelDailyStat`／`RankingEntry`**。理由：這些數字背後沒有任何明細，保留即使
   > 「儀表板每個數字可由 DB 反推」在示範資料上永遠不成立，與 FEAT-1 建立的誠實標示原則衝突。
   > **連帶後果已接受**：排行榜頁、首頁排行區塊、作者儀表板、成效頁與**作品詳情頁評論區**在示範資料上
   > 皆為空狀態 —— 空狀態因此是示範環境的**主要路徑**，MUST 設計完整、納入 a11y 檢查、不得破圖；
   > 熱門排序在計數全 0 時 MUST 有確定性 tie-break（`updatedAt DESC, id ASC`）。
3. `RankingEntry` 不再手寫（`mockData.ts` 的 `WEEKLY_RANKING`／`MONTHLY_RANKING`／`ALL_TIME_RANKING` 常數刪除）。
   `rankingService.recompute()` 於 seed 尾端執行一次，**在無統計來源的示範資料上其結果為空榜**（見上）
4. `src/lib/mockData.ts` 與 `src/lib/content.ts` 中的 `generateChapterParagraphs()`、`getAuthorDailyStats()`、`MOCK_USER`、`MOCK_CREDENTIALS`、`SEED_READING_HISTORY` 於對應階段刪除

---

## 5. API 與 Server Action 規格

### 5.1 通用約定

**回應格式**

```jsonc
// 成功
{ "data": { /* … */ }, "meta": { "nextCursor": "…", "total": 42 } }
// 失敗
{ "error": { "code": "VALIDATION_ERROR", "message": "Email 格式不正確", "fields": { "email": "格式不正確" } } }
```

**錯誤碼對照**

| code | HTTP | 使用時機 |
|------|------|----------|
| `VALIDATION_ERROR` | 400 | Zod 驗證失敗 |
| `UNAUTHENTICATED` | 401 | 無有效 session |
| `FORBIDDEN` | 403 | 已登入但無權限（非作者／非擁有者） |
| `NOT_FOUND` | 404 | 資源不存在或未發佈 |
| `CONFLICT` | 409 | Email 重複、重複評論、章節編號衝突 |
| `RATE_LIMITED` | 429 | 超過速率限制（附 `Retry-After`） |
| `INTERNAL_ERROR` | 500 | 未預期錯誤（不外洩堆疊） |

**授權層級**：`公開` / `需登入` / `需作者` / `需擁有者` / `需 cron secret`
**分頁**：一律 cursor-based（`?cursor=&limit=`，`limit` 上限 50）
**驗證**：所有入參經 `src/lib/validation/*` 的 Zod schema，client/server 共用同一份定義

### 5.2 認證

| 方法 路徑 | 用途 | 授權 | 入參 | 回傳 | 錯誤 |
|-----------|------|------|------|------|------|
| `POST /api/auth/register` | 註冊 | 公開 | `{ name, email, password, acceptTerms }`（password ≥8 且含英數；`acceptTerms` 必為 `true`，**伺服器端一併驗證**，通過即寫入 `User.termsAcceptedAt`） | `{ user }` + Set-Cookie | 400（含未同意條款）/ **409 Email 已註冊（修正 M-1）** / 429 |
| `POST /api/auth/login` | 登入 | 公開 | `{ email, password }` | `{ user }` + Set-Cookie | 400 / 401 / 429 |
| `POST /api/auth/logout` | 登出（撤銷 session） | 需登入 | — | `{ ok: true }` + 清除 Cookie | 401 |
| `GET /api/auth/me` | 取得目前使用者 | 需登入 | — | `{ user }` | 401 |
| `POST /api/auth/password-reset/request` | 申請密碼重設（Phase 14／FEAT-5） | 公開 | `{ email }` | `{ ok: true }` —— **已註冊與未註冊逐位元組相同**（FR-006） | 400（Email 格式）/ 429 |
| `POST /api/auth/password-reset/confirm` | 以憑證設定新密碼（Phase 14／FEAT-5） | 公開 | `{ token, password }` | `{ ok: true }` | 400 `VALIDATION_ERROR` / 400 **`INVALID_TOKEN`** / 400 **`EXPIRED_TOKEN`** |
| `POST /api/contact` | 聯絡表單送出（Phase 14／FEAT-5） | 公開 | `{ name, email, message, website }`（`website` 為 honeypot，MUST 為空） | `{ ok: true }` | 400（**回應 MUST 帶 `error.fields`，前端 MUST 逐欄位顯示**，2026-08-13 手動測試後補：只顯示一句「輸入格式不正確」等於要使用者在三個欄位間亂猜；**honeypot 命中除外** —— 該欄對人不可見，顯示在欄位上等於毫無反應，仍走失敗提示。詳見 `contracts/contact-api.md` §2.1）/ 429 / **502 `MAIL_FAILED`** |

> **三個新端點的執行順序、錯誤碼語意與信件內容以 `specs/005-email-recovery-contact/contracts/` 為準**（FEAT-5 plan，2026-08-09）。
> 三處與既有慣例不同、且**刻意如此**的地方：
> (a) `password-reset/request` 的成功回應**在寄信之前**就送出（`after()`，見 §9 Phase 14 第 3 項）；
> (b) `POST /api/contact` **反過來同步 `await` 寄送**並在失敗時回 502 —— 這裡沒有帳號存在性可洩漏，
> 而使用者必須知道訊息到底出去了沒有（誠實標示，§8）；
> (c) **`INVALID_TOKEN` 與 `EXPIRED_TOKEN` 是兩個碼而非一個** —— FR-015 要求兩種情況顯示不同說明，
> 合成一個碼畫面就只能給一句含糊的話。三者皆 400（請求本身沒有身分，談不上 401）。
> **新增錯誤碼 `MAIL_FAILED` 對應 502**：失敗來自上游郵件服務，不是本站程式錯誤。

> 對應 Server Action：`src/app/auth/actions.ts` 的 `registerAction` / `loginAction` / `logoutAction`（頁面表單用，邏輯與上表共用 `authService`）。
> **登入錯誤訊息一律為「Email 或密碼不正確」**，不得區分帳號不存在／密碼錯誤（避免帳號枚舉）。

### 5.3 公開讀取

| 方法 路徑 | 用途 | 授權 | 入參 | 回傳 |
|-----------|------|------|------|------|
| `GET /api/novels` | 作品列表 | 公開 | `?category=&sort=rating\|views\|words\|chapters\|new&cursor=&limit=` | `Novel[]` + cursor |
| `GET /api/novels/{id}` | 作品詳情 | 公開 | — | `NovelDetail`（含卷、標籤、相關作品） |
| `GET /api/novels/{id}/chapters` | 章節目錄 | 公開 | `?volume=` | `Volume[]`（僅 `status='published'`） |
| `GET /api/chapters/{id}` | **章節正文** | 公開 | — | `{ chapter, paragraphs, prevChapterId, nextChapterId, progress }` |
| `GET /api/search` | 搜尋 | 公開 | `?q=&category=&cursor=&limit=`（預設 20、上限 50）；`?suggest=1` 回傳建議（trim 後達 **2 字元**才受理、上限 **8 筆**，每筆含識別碼／標題／作者顯示名） | `{ items: Novel[], nextCursor }` / `NovelSuggestion[]` |
| `GET /api/rankings` | 排行榜 | 公開 | `?period=weekly\|monthly\|alltime&category=` | `RankingItem[]` |
| `GET /api/categories` | 分類（含作品數） | 公開 | — | `Category[] & { count }` |
| `GET /api/health` | 健康檢查 | 公開（**密鑰分流**） | 標頭 `x-health-secret`（可選） | 無密鑰／密鑰錯誤：`{ ok }`；密鑰正確：`{ ok, provider, dbLatencyMs, trustedProxyHops, rateLimitMode }` |

> **`GET /api/health` 不得對匿名請求揭露基礎設施細節**：未帶或帶錯 `HEALTH_CHECK_SECRET` 時只回成功／失敗狀態；DB 不可用時兩種情況皆回失敗。
>
> **`dbLatencyMs` 與 `ok` 一律取自 `repositories/health.ts` 的 `pingDatabase()`（經 barrel），端點內不得 `import { prisma }` 或發出 `$queryRaw`**（§2.2 R1、憲章第 III 條）。第六輪補正：原設計只定義了 `users`／`sessions` 兩個 repository，而本端點是唯一必須感知資料庫種類的 Route Handler —— 沒有這一層就只剩「端點內直查」一條路，等於在剛建立雙軌抽換邊界的同時親手鑿穿它。`pingDatabase()` 發出 provider 中立的最小往返（`SELECT 1`）並計時，**連線失敗回 `{ okay: false }` 而非擲出**（本端點須回失敗狀態而非逾時無回應），兩種密鑰情況共用同一次探測。
>
> **導覽列未讀通知數的成本界線（FEAT-4 裁示，2026-07-31）**：`SiteHeader` 出現在全部 26 頁，其未讀數
> **MUST NOT 使未登入訪客付出任何額外查詢**（沿用 §7.1 的公開頁零成本界線）；已登入者的成本 MUST 限於
> **每頁至多一次計數**，且 MUST 與版面既有的工作階段讀取**在同一次資料存取往返內完成**。
> 未讀數 MUST 即時反映、MUST NOT 快取 —— 使用者標記已讀後看到數字沒動會直接當成故障。
>
> **`GET /api/chapters/{id}` 沒有任何付費／授權判斷**——平台全免費，凡 `status='published'` 的章節一律回傳完整正文；未發佈章節對非擁有者回 404（不回 403，避免洩漏存在性）。

### 5.4 讀者互動（皆需登入）

| 方法 路徑 | 用途 | 入參 | 回傳 | 錯誤 |
|-----------|------|------|------|------|
| `GET /api/bookshelf` | 我的書架 | `?cursor=&limit=<1-20>`（預設 20；兩者 MUST 經 `validation/reader.ts` 的共用驗證結構，FEAT-4 裁示 2026-08-07 —— 原文只寫 `?cursor=`，`limit` 不驗時 `?limit=100000` 即是一次全表掃描，與同節 `GET /api/notifications` 已修的是同一個洞，FR-005 的對象是**所有**入參）。**另有 `?view=ids` 模式（FEAT-4 實作裁示 2026-08-07 新增）**：只回 `{ ids: string[] }` 的完整識別碼集合，不分頁 | `Novel[]` + cursor（`view=ids` 時為 `{ ids }`） | 400 / 401 |
| — | **`?view=ids` 的存在理由**（2026-08-07） | 客戶端的 `useBookshelf`／`useBookshelfIds` 要回答的是「**這一部**在不在書架」與「整份清單是哪些」，兩者都需要**完整**集合。只給游標分頁的話，收藏 500 部的人每開一個作品詳情頁都要打 25 次請求才知道當前這一部有沒有被收藏——而 spec Assumptions 要求這兩支 Hook 的對外形狀不變（登入分歧封裝在 Hook 內部）。本模式只 `select` 一個欄位，成本遠低於分頁列表 | — | — |
| `POST /api/bookshelf/{novelId}` | 加入書架 | — | `{ ok, favoriteCount }` | 401 / 404 / 409 |
| `DELETE /api/bookshelf/{novelId}` | 移出書架 | — | `{ ok, favoriteCount }` | 401 / 404 |
| `PUT /api/reading-progress` | 上報閱讀進度。**FEAT-4 裁示（2026-08-06）：客戶端一律以 `fetch(..., { method:'PUT', keepalive:true })` 送出，MUST NOT 用 `navigator.sendBeacon`** —— 後者只能發 POST，與本列的 PUT 語意（覆寫同一列）衝突且無法自訂標頭；`keepalive` 提供相同的卸載後送出保證。觸發時機兩處：`pagehide`（非 `beforeunload`，後者在行動瀏覽器移入 bfcache 時不觸發）＋ 閱讀中每 30 秒節流且僅百分比有變化時。**副作用（FEAT-4 裁示 2026-08-06）：本 Handler MUST 於寫入進度後一併呼叫 `readingService.touchHistory` upsert 閱讀歷史**（閱讀頁首次載入亦觸發一次），失敗吞掉不中斷閱讀 —— `ReadingHistory` 在 §5.4 中**沒有任何寫入端點**，若不在此指定落點，該表就永遠是空的，而 `GET /api/history` 會回一個空清單卻沒有任何測試看得出來 | `{ novelId, chapterId, percent }` | `{ ok }` | 400 / 401 / 404 |
| `POST /api/reader-state/merge` | **本機資料合併（FEAT-4 新增，2026-08-06）**。原 §5.4 無此列，但「登入後把本機書架／歷史／偏好合併上傳」需要一個入口；拆成三個端點會使「合併須冪等且不得半完成」跨三次請求。**副作用（FEAT-4 裁示 2026-08-07 補明）**：書架分支所**實際新增**的每一筆 MUST 走與 `POST /api/bookshelf/{novelId}` 相同的三件事——同一交易內「建立 `Bookshelf` → `Novel.favoriteCount` +1 → 寫 `BookshelfEvent(delta=+1)`」，被聯集略過的重複項三者皆不動。原文只寫合併規則而未寫副作用，照字面實作是「只寫關聯列」，而**「訪客累積後登入」正是收藏最常見的入庫途徑**，該日的收藏淨增會系統性少計（`favoriteCount` 尚可由隔日彙總的全量校正蓋回，但 `BookshelfEvent` 沒有校正機制，該日 delta 永久遺失） | `{ bookshelf: string[], history: [{novelId,chapterId,readAt}], preference? }`（每類 ≤ 200 筆） | `{ merged, skipped, truncated }` | 400 / 401 |
| `POST /api/chapters/{id}/view` | **章節閱讀上報（FEAT-4 新增，2026-08-06）**。原 §5.4 無此列，而 `ChapterView` 明細沒有寫入路徑就不存在。**此端點公開**（對匿名開放——多數讀者未登入，只收登入者會使曝光大幅低估），但**仍 MUST 通過 `assertSameOrigin`**（2026-08-07 補正）——「不需登入」與「任何站台皆可呼叫」是兩件事，缺此比對則外部網站可對本站刷曝光與排行分數；跨站來源 MUST 回 **403**，MUST NOT 比照限流超額做靜默捨棄。處理順序 MUST 為：來源比對 → 章節已發佈？→ 來源位址限流（超額**靜默捨棄**）→ 作者本人？（跳過）→ 算 `viewerHash` → 去重窗口內？（跳過）→ 寫入 | — | `{ ok: true }`（**任何跳過皆回相同回應**） | 403 / 404 |
| `GET /api/reading-progress?novelId=` | 取得續讀位置。**回傳含 `chapterNumber`**（FEAT-4 裁示 2026-08-07 補入）—— 續讀入口要顯示「讀到第 N 章」，只回 `chapterId` 的話詳情頁得為了一個數字再打一次資料庫；記錄的章節已下架或被刪除時回 `null`，指向看不到的章節的續讀入口比沒有入口更糟。**續讀位置的還原**（FR-011 的後半）由閱讀頁在 `?resume=1` 時以本值捲動，**不**由本端點負責 —— 作品詳情頁的入口改由 Server Component 直接經服務層取數，不經本端點 | — | `{ chapterId, chapterNumber, percent } \| null` | 401 |
| `GET /api/history` | 閱讀歷史 | `?cursor=&limit=<1-20>`（預設 20；MUST 經 `validation/reader.ts` 的共用驗證結構，同上列理由） | `ReadingHistoryEntry[]` | 400 / 401 |
| — | **FEAT-4 資料量上限（可調整預設值）** | 合併每類 **200 筆**（超出保留最近者並告知）、閱讀歷史每人 **500 筆**（自動淘汰最舊）、通知保留 **90 天**／每頁 **20 筆**。**三個保留期的清理一律由每日彙總作業執行**（`ChapterView`、`BookshelfEvent` 依明細保留期，`Notification` 依 90 天），且 MUST 於回應中**逐一回報刪除筆數**（FEAT-4 裁示 2026-08-07：清理是無聲的破壞性動作，只寫「有上限」而無執行者與回報，保留期設錯時沒有任何人看得出來） | — | — |
| `DELETE /api/history` | 清空歷史 | `?novelId=`（可選；MUST 經 `validation/reader.ts` 的共用驗證結構） | `{ deleted }` | 400 / 401 |
| `GET /api/novels/{id}/reviews` | **評論列表（此端點公開，FEAT-4 新增）**。查詢參數 MUST 經 `validation/review.ts` 的共用結構（FR-005）；`sort` 省略時為 `hot` | `?sort=hot\|latest&cursor=&limit=<1-20>`（預設 `sort=hot`、`limit=20`） | `{ items: ReviewItem[], nextCursor }`（**FEAT-4 實作裁示 2026-08-07／T062**：原文寫 `Review[]`，但領域型別 `Review` 的 `publishedAt`／`likes`／`isHot` 三欄隨本階段的 schema 改寫一併消失，且列表另需 `likedByMe` 與 `mine` 兩個**伺服器判定**的旗標——沒有它們，按讚鍵不知道自己按過沒有、編輯與刪除入口不知道該不該出現，而讓客戶端自行比對使用者識別碼等於把該識別碼送進未登入也看得到的公開頁面。舊 `Review` 型別已刪除） | 400 / 404 |
| `POST /api/novels/{id}/reviews` | 發表評分評論 | `{ rating, content }` | `{ review }` | 400 / 401 / **409 已評論過** / 429 |
| `PATCH /api/reviews/{id}` | 編輯自己的評論 | `{ rating?, content? }` | `{ review }` | 401 / 403 / 404 |
| `DELETE /api/reviews/{id}` | 刪除自己的評論 | — | `{ ok }` | 401 / 403 / 404 |
| `POST\|DELETE /api/reviews/{id}/like` | 評論按讚／取消 | — | `{ likeCount, likedByMe }`（**FEAT-4 實作裁示 2026-08-07／T068**：原文只回 `likeCount`，但同一人重複按讚是冪等的，回應若不帶當下的 `likedByMe`，客戶端在重送之後只能自己猜按鈕該呈現什麼狀態） | 401 / 404 |
| `GET /api/chapters/{id}/comments` | 章節留言（**此端點公開**） | `?cursor=&limit=<1-20>`（預設 20；MUST 經 `validation/comment.ts` 的共用結構，FEAT-4 裁示 2026-08-07 —— 原文只寫 `?cursor=`，`limit` 不驗時 `?limit=100000` 即是一次全表掃描，FR-005 的對象是所有入參） | `{ items: CommentThread[], nextCursor }`（**FEAT-4 實作裁示 2026-08-07／T062**：分頁單位為**頂層留言**，回覆隨其父留言一併回傳於 `replies`——以「全部留言」分頁會把一則有 30 個回覆的樓切成兩頁，讀者看到的是半個對話。節點另含 `canDelete`：刪除入口只出現在自己的留言上，而「這是不是你的」同樣 MUST 由伺服器判定） | 400 / 404 |
| `POST /api/chapters/{id}/comments` | 發表留言 | `{ content, parentId? }` | `{ comment }` | 400 / 401 / 429 |
| `DELETE /api/comments/{id}` | 刪除自己的留言（**墓碑**，保留該列） | — | `{ ok }` | 401 / 403 / **404** |
| `GET /api/notifications` | 通知列表 | `?unread=1&cursor=&limit=`（每頁 20，保留 90 天；三個查詢參數 MUST 經共用驗證結構，`limit` 限 1–20 —— FEAT-4 裁示 2026-08-07：不驗時 `?limit=100000` 即是一次全表掃描） | **`{ items: NotificationItem[], nextCursor }`**（**FEAT-4 實作裁示 2026-08-08／T113～T117c**：原文寫 `Notification[]`，但本列的入參已有 `cursor`——回一個裸陣列時客戶端拿不到下一頁的游標，分頁就只有第一頁能用；`nextCursor` 亦是「已無更多」與「這一頁剛好滿 20 筆」的唯一區分。排序 `createdAt DESC, id ASC`，與 §6 的游標契約同形） | 400 / 401 |
| `PATCH /api/notifications/{id}` | 標記**單筆**已讀 | **`{ read: true }`** | **`{ ok: true, unreadCount: number }`**（**FEAT-4 實作裁示 2026-08-08／T117b**：原文入參為 `—`、回傳為 `{ ok }`。①入參空白時「標記已讀」與「標記未讀」無從表達，而 `readAt` 是可回復的欄位；②回傳不帶 `unreadCount` 時，導覽列只能自行猜新的數字或另發一次請求，而未讀數 MUST 即時反映且 MUST NOT 快取（§7.1 的成本界線），猜錯與多一次往返都直接違反該界線） | 401 / **404**（不屬於自己與不存在**回同一個狀態碼與錯誤碼**——403 等於確認「這個識別碼有效，只是不是你的」，而通知識別碼可枚舉） |
| `PATCH /api/notifications` | 標記**全部**已讀 | — | `{ ok: true, unreadCount: 0 }` | 401 |
| `PUT /api/reader-preference` | 同步閱讀偏好 | `{ fontSize?, theme? }`（`fontSize ∈ {sm,md,lg}`、`theme ∈ {light,dark,eyecare}`；**無 `lineHeight`**，見 §4.2 該 model 的 FEAT-4 裁示）。兩項皆可單獨更新，未給的欄位保持原值 | `{ preference }` | 400 / 401 |
| `GET /api/reader-preference` | **取得閱讀偏好（FEAT-4 實作裁示 2026-08-07 新增）**。原表只有 `PUT`，但字級與主題分屬 `useReaderPrefs` 與 `useTheme` **兩個客戶端 Hook**，兩者在登入態都要把伺服器值讀回來當離線快取——沒有本列，`theme` 就只有寫入端而沒有消費端，US1 AC6 與 SC-001 的主題部分恆假，而直接打 API 的整合測試看不出這件事。尚未設定過偏好者回 `{ preference: null }`（**不是 404**）：那不是錯誤，而是「沿用你本機現在的值」 | — | `{ preference: { fontSize, theme } \| null }` | 401 |

### 5.5 作者（Server Action 為主，皆需作者 + 擁有者）

| Action / 路徑 | 用途 | 授權 | 入參 | 回傳 | 錯誤 |
|---------------|------|------|------|------|------|
| `createNovelAction` | 建立作品（草稿） | 需作者 | `{ title, categoryId, excerpt }` | `{ novelId }` | 400 / 401 / 403 |
| `updateNovelAction` | 更新作品 | 需擁有者 | `{ novelId, title?, categoryId?, excerpt?, description?, tagIds?, coverColor?, serialStatus? }` | `{ ok }` | 400 / 401 / 404 |
| `publishNovelAction` | 上架／下架 | 需擁有者 | `{ novelId, status }` | `{ ok }` | 400 / 401 / 404 |
| `deleteNovelAction` | 刪除作品 | 需擁有者 | `{ novelId }` | `{ ok }` | 401 / 404 |
| `createVolumeAction` / `updateVolumeAction` | 分卷管理 | 需擁有者 | 建立 `{ novelId, title }`／更新 `{ volumeId, title }`（**`number` 不由入參提供**） | `{ volumeId }` | 400 / 401 / 404 / 409 |
| `deleteVolumeAction` | 刪除卷（**僅空卷**） | 需擁有者 | `{ volumeId }` | `{ ok }` | 401 / 404 / 409 |
| `createChapterAction` | 建立空白草稿章節 | 需擁有者 | `{ novelId, volumeId }` | `{ chapterId }` | 401 / 404 / 409 |
| `saveChapterDraftAction` | 儲存章節正文（**不改變 `status`**） | 需擁有者 | `{ chapterId, title, bodyMarkdown }` | `{ wordCount }` | 400 / 401 / 404 |
| `publishChapterAction` | 發佈章節。**FEAT-4 裁示（2026-08-07）：入參擴充為 `{ chapterId, scheduledAt? }`** —— 省略＝立即發佈並產生一則追更通知；**未來**時間＝寫入 `Chapter.scheduledAt` 並維持 `status='draft'`，作者端顯示「已排程於 X 發佈」；**過去**時間＝400 `VALIDATION_ERROR` 並提示改用立即發佈，不建立無效排程（FR-049）。本列原為 FEAT-3 的形狀（`{ chapterId }`），下方「排程發佈延後至 FEAT-4」一條已於本階段解除——只更新該註而不改這一列，實作者讀的是這一列 | 需擁有者 | `{ chapterId, scheduledAt? }` | `{ ok }` | 400 / 401 / 404 |
| `cancelScheduleAction` | **取消排程（FEAT-4 新增，2026-08-07）**：清除 `Chapter.scheduledAt` 並維持草稿。與「改為立即發佈」併為 FR-050 的兩個出口，缺此列則已排程的章節只能等到期 | 需擁有者 | `{ chapterId }` | `{ ok }` | 401 / 404 |
| `unpublishChapterAction` | 章節下架（轉回草稿） | 需擁有者 | `{ chapterId }` | `{ ok }` | 401 / 404 |
| `reorderChaptersAction` | 章節排序（**限單一卷內**） | 需擁有者 | `{ volumeId, orderedChapterIds[] }` | `{ ok }` | 400 / 401 / 404 |
| `deleteChapterAction` | 刪除章節 | 需擁有者 | `{ chapterId }` | `{ ok }` | 401 / 404 |
| `publishChaptersAction` | **批次發佈章節（FEAT-8，2026-08-22）**。**走 Server Action 而非 Route Handler**（plan 裁示 2026-08-22）：入參只有識別碼，1000 個 `randomUUID()` 約 **40 KB**，遠低於 Server Action 預設的 **1 MB** 主體上限（已查 Next 16.2.10 隨附文件 `serverActions.md` 第 26 行），且 Server Action 有框架層 CSRF 保護；FEAT-7 走 Route Handler 的三個理由（multipart、緩衝前依 `Content-Length` 拒絕、調高 `bodySizeLimit`）在本階段全部不成立。`serverActions.bodySizeLimit` MUST 維持不設定。一次把選取的**草稿**章節全部**立即發佈**。**MUST NOT 接受 `scheduledAt`** —— 批次排程不在 Phase 17 範圍，排程仍走上方 `publishChapterAction` 的單章路徑。選取內已發佈者**略過**（不重複寫入、不重複通知）。**追更通知 MUST 為整批一則**：於整批寫入交易之後、以**單次** `notifyNewChapters(novelId, chapters[])` 送出，章節數為本批實際由草稿轉為已發佈者、指向章號最大者；實際發佈數為 0 時不送通知。**逐章呼叫既有 `publishChapter` 湊批次是錯的實作**（每章各發一則，收藏者為同一次操作收到 N 則）。同一交易內清空本批 `scheduledAt`，並各**呼叫一次** `refreshNovelCounters` 與 `touchNovel`（不是每章一次）。全有全無；批次內任一章不屬於發起者即整批失敗 | 需擁有者（**逐章驗證**） | `{ volumeId, chapterIds[] }`（**≤ 1000 章**；`novelId` MUST NOT 由客戶端提供，由 `volumeId` 反查——理由同下方 import 列。**「限單一卷」是伺服器端不變量而非前端慣例**（FEAT-8 clarify 裁示 2026-08-22）：伺服器 MUST 驗證 `chapterIds` **每一項都屬於該 `volumeId`**，任一不屬即整批失敗，回應與擁有權失敗、「找不到」逐字不可區分。只靠前端把關的話，前端的一個缺陷或直接呼叫端點，就能讓「全有全無」與「一批一則通知」跨到另一個卷去） | `{ published, skipped, emptyBody, notified }`（實際發佈數／略過數／空正文警告數／通知是否送出；**摘要 MUST 誠實**，實際發佈 0 章 MUST NOT 回報為成功發佈 N 章。`published` MUST 取自**條件更新的影響列數**而非讀取快照，`notified` 為 false 時前端另外標示「追更通知未送出」而**不**回報為失敗 —— 見 Phase 17 第 21～22 項。**另回 `publishedNumbers[]`／`skippedNumbers[]`／`emptyBodyNumbers[]`** 供前端組章號區段摘要，前兩者 plan 補入 2026-08-22、`emptyBodyNumbers[]` 為 **analyze 第二輪補入 2026-08-23**：FR-027a 要求摘要**指名**空正文章節，而 FR-006 規定成功後清空選取 —— 只回數量時前端已無從反推是哪幾章） | 400 / 401 / 404 / **409** |
| `deleteChaptersAction` | **批次刪除章節（FEAT-8，2026-08-22）**。同為 Server Action，理由見上一列。**入參 MUST NOT 含任何「只刪草稿」的旗標**（plan 裁示）——加強確認落在前端，伺服器不因狀態分支；多一個旗標等於多一條前端傳錯就會靜默少刪的路徑。一次刪除選取章節，**草稿與已發佈皆可**。連帶移除 `ChapterContent` 與 `Comment`（既有級聯）；**MUST NOT** 刪除 `ReadingProgress`／`ReadingHistory`（§4.2 該欄註：續讀點指向的章節消失不該連坐整筆進度）。**刪除後 MUST NOT 自動補正剩餘章號**（自動補號會讓讀者已知的章號整批位移；連號需求走 `reorderChaptersAction`）。全有全無；同一交易內各呼叫一次 `refreshNovelCounters` 與 `touchNovel`。**前端側的加強確認為規格要求而非建議**：選取內含已發佈章節時 MUST 明示「將刪除 N 章，其中 M 章已發佈」並需一次明確的二次確認；全為草稿時 MUST NOT 施加同等摩擦 | 需擁有者（**逐章驗證**） | `{ volumeId, chapterIds[] }`（**≤ 1000 章**；**卷歸屬的驗證與上一列相同** —— 伺服器 MUST 驗證每一章都屬於該 `volumeId`，任一不屬即整批失敗且回應不可區分） | `{ deleted, deletedNumbers[] }`（章號供紀錄與摘要組區段，plan 補入 2026-08-22） | 400 / 401 / 404 / **409** |
| `POST /api/author/volumes/{volumeId}/chapters/import` | **批次匯入章節（FEAT-7 plan 裁示，2026-08-20）**。`multipart/form-data`，檔案 part 欄位名 `files`（可重複）。**刻意不是 Server Action**：`serverActions.bodySizeLimit` 是 `next.config` 的**全域**設定（已查 Next 16.2.10 隨附文件 `serverActions.md`），為匯入調到 50 MB 等於讓站上每一個 Server Action 都變成大體積入口；且 Server Action 拿不到原始 `Request`，無法在緩衝前依 `Content-Length` 拒絕。**`novelId` MUST NOT 出現在入參**，由 `volumeId` 反查 —— 若由客戶端傳入就得比對兩者歸屬，少寫那一步的後果是作者能把章節掛到別人的作品下。Route Handler **無框架 CSRF 保護**，第一行 MUST 為 `assertSameOrigin`。處理順序 MUST 為：來源比對 → Content-Type → **Content-Length（缺漏亦拒絕）** → 身分角色 → `formData()` → 檔案數與逐檔大小 → 服務層擁有權與全量重驗 → 單一交易寫入。超限一律 400 `VALIDATION_ERROR` 且訊息含實際值與上限值，**不新增 `ErrorCode`** —— `ErrorCode` 與 `STATUS_BY_SERVICE_CODE` 是同一型別的兩半，為此新增一個碼會波及所有端點 | 需擁有者 | `multipart`：`files[]`（≤ 1000 檔、單檔 ≤ 1 MB、總計 ≤ 50 MB） | `{ created, numbers[], chapterCount, wordCount }` | 400 / 401 / 403 / 404 / 409 |
| `GET /api/author/novels` | 作者作品列表 | 需作者 | `?status=` | `AuthorNovel[]` | 401 / 403 |
| ~~`GET /api/author/stats`~~ | **已刪除（FEAT-4 裁示 2026-08-07）**。儀表板改由 `/author/dashboard` 的 Server Component 直讀 `statsService.getAuthorDashboard`（授權 `requireAuthor()`，資料層強制帶入 `authorId`），回傳 `{ summary, daily[], statsThroughDate }` 以 props 傳入。刪除理由：`AuthorDashboardView` 是純 props 的 client 元件、**無期間切換器**，此端點不會有任何消費端，上線即是死碼。沿用導覽列未讀數的同一判準 —— **沒有客戶端互動需求就不開端點**。日後若新增期間切換器，再依此形狀補回 | 需作者 | — | — | — |
| `GET /api/author/comments` | 讀者留言管理。**查詢參數以本列為準（FEAT-4 裁示 2026-08-07 統一）**：`?cursor=&limit=<1-20>&novelId=&hidden=`（後三者可選，預設 `limit=20`、不篩選），MUST 經 `validation/comment.ts` 的共用結構（FR-005）。原文只寫 `?cursor=`，而 contracts 只給 `novelId`、`tasks.md` T059 只給 `hidden`，三份文件各一套參數，照任一份實作都與另外兩份不符；且 `limit` 不驗時 `?limit=100000` 即是一次全表掃描 | 需作者 | `?cursor=&limit=&novelId=&hidden=` | `{ items: AuthorCommentItem[], nextCursor }`（**FEAT-4 實作裁示 2026-08-07／T061**：作者向的列含**原文**與所屬作品／章節，且**墓碑不列入**——使用者已刪除的內容沒有可管理的對象，列出來只會讓作者對著一句「此留言已刪除」按隱藏。排序為 `createdAt DESC, id ASC`，與讀者端的樓層順序相反：管理要先看到最新的那一則） | 400 / 401 / 403 |
| `PATCH /api/author/comments/{id}` | **隱藏／取消隱藏（FEAT-4 實作裁示 2026-08-07／T072 補列）**。原 §5.4 有列表卻沒有這一列，而 §6.2 的「作者可隱藏自己作品下的留言」與 FR-030～FR-032 全靠它——沒有寫入端點，隱藏就只是一段沒有入口的規則。**入參只有 `hidden`，MUST NOT 提供任何可改動 `content` 的欄位**（FR-031：隱藏，不是竄改）。留言不在自己作品下 → **403 且資料未變更**；留言不存在 → 404 | 需作者 | `{ hidden: boolean }` | `{ ok }` | 400 / 401 / 403 / 404 |

**擁有者檢查（修正 E-1 的落地方式）**：`requireOwner(session, novelId)` 於 service 層執行，且 repository 的作者向查詢**一律強制帶入 `where: { authorId }`**——即使 service 忘記檢查，資料層仍查不到他人作品。

**FEAT-3 落地時的補充（2026-07-30）**：

- **非擁有者一律 404，不回 403**：與「資源不存在」的回應 MUST **完全相同**，不得以狀態碼或訊息差異洩漏資源存在性。上表的錯誤欄已據此把擁有者類 Action 的 `403` 改為 `404`；`403` 只保留給**角色不足**（`reader` 呼叫作者 Action）。授權順序固定為「身分（401）→ 角色（403）→ 擁有權（404）」
- **每個 Action 自驗身分與角色**，MUST NOT 依賴 `proxy.ts` 的 matcher——matcher 排除某路徑會連帶跳過該路徑上的 Server Action
- **編號一律由系統指派**：卷與章節皆取「該作品目前最大編號 +1」，作者無從輸入；併發撞號由資料層唯一性約束攔下並轉譯為 409，原始資料庫例外 MUST NOT 冒泡為 500
- **章節排序限單一卷內**：於單一交易重寫整批編號，並以暫時區間避開唯一約束的中間狀態；章節跨卷搬動不在 FEAT-3 範圍
- **排程發佈延後至 FEAT-4**：`publishChapterAction` 於 FEAT-3 **不接受** `scheduledAt`（理由見 §4.2 `Chapter.scheduledAt` 註）。**此延後已於 FEAT-4 解除（2026-08-07）**：入參與 `cancelScheduleAction` 的形狀見上表該兩列，本條自此僅為歷史紀錄，MUST NOT 再據以認定 `scheduledAt` 不可用
- **新增作品管理頁 `/author/novels/{novelId}`**：承載作品資訊編輯、卷管理、章節列表與卷內排序、新增章節入口、上架／下架與刪除，是上列 Action 的主要落點。受保護路由，以擁有者條件取資料，非擁有者 `notFound()`
- **標籤只能自既有集合多選**：不提供作者新建標籤的入口（避免為中文標籤發明 slug 生成規則），寫入端 MUST 核對 `tagIds` 每一項存在於 `Tag`
- **作品與章節寫入不套用速率限制**（已受工作階段與擁有者守衛雙重保護）；限流只擴及 §5.6 的身分敏感操作

### 5.6 個人設定（Server Action）

| Action | 用途 | 授權 | 入參 | 錯誤 |
|--------|------|------|------|------|
| `updateProfileAction` | 更新暱稱／筆名／簡介／頭像色 | 需登入 | `{ name?, penName?, bio?, avatarColor? }` | 400 / 401 |
| `changePasswordAction` | 修改密碼（需舊密碼） | 需登入 | `{ currentPassword, newPassword }` | 400 / 401 / 429 |
| `becomeAuthorAction` | 開通作者身分（**改 `role` 後須撤銷該使用者全部 session**，見 §7.1 角色快照） | 需登入 | `{ penName }` | 400 / 401 / 409 / 429 |
| `revokeSessionsAction` | 登出所有裝置 | 需登入 | — | 401 |

**FEAT-3 落地時的補充（2026-07-30）**：

- **開通作者：撤銷全部憑證後，為當前裝置立即補發**一份帶更新後角色快照的憑證——使用者無須重新登入即可進入 `/author/*`，其他裝置一律登出。順序 MUST 為「改 `role` → 撤銷全部 → 補發」，不可交換。補發若失敗，MUST 退回「請重新登入」的可理解提示，不得讓使用者停在「角色已變更卻無有效憑證」的無聲失敗
- **改密碼維持「全部登出、不補發」**（含當前裝置）。兩者威脅模型不同：開通作者時當前裝置的身分剛通過驗證，改密碼則須應對憑證可能已外洩。**UI 的兩段告知文案 MUST NOT 混用**
- **筆名異動 → 個資更新與該作者全部作品的 `searchText` 重算 MUST 於同一交易內完成**，成敗一致。先提交再重算會留下「筆名已改但舊筆名仍搜得到」的靜默不一致；背景重算需 FEAT-3 明文排除的排程工作
- **速率限制只擴及本節的改密碼與開通作者**，以使用者識別碼為鍵，沿用 §7.6 既有的登入限流窗，額度由 `PASSWORD_CHANGE_RATE_MAX`（預設 5）與 `AUTHOR_UPGRADE_RATE_MAX`（預設 3）設定。理由：改密碼會驗證舊密碼，不限流即等於一個可繞過登入限流的密碼預言機
- **作者開通為自助、無審核流程**；已具 `author`／`admin` 身分者再次呼叫回 409，身分與工作階段皆不變

### 5.7 系統

| 方法 路徑 | 用途 | 授權 | 說明 |
|-----------|------|------|------|
| `POST /api/cron/rankings` | 重算三種週期排行榜 | 需 cron secret（`Authorization: Bearer $CRON_SECRET`） | 由 `NovelDailyStat` 聚合計分，寫入 `RankingEntry` 並比對前次名次產生 `change` |
| `POST /api/cron/publish-scheduled` | 發佈到期的排程章節 | 需 cron secret | 掃 `Chapter.scheduledAt <= now && status='draft'`。**FEAT-4 裁示（2026-08-07）：Route Handler 只做「驗密鑰 → 呼叫 `chapterService.publishDueScheduled(now)` → 回報結果」三件事**；掃描、逐章交易（`status`／`publishedAt`／`scheduledAt=null` ＋ 回填 `Novel.chapterCount`／`wordCount`）、group by `novelId` 與發通知的整段編排 MUST 位於服務層，與另兩個 cron 入口（委派 `statsService.rollupDaily`／`rankingService.recompute`）同形。`publishDueScheduled` **無 session 入參**——既有的 `publishChapter` 以工作階段判定擁有權，而 cron 沒有工作階段，硬用會逼出一個假的系統身分 |
| `POST /api/cron/rollup-stats` | 每日統計彙總 | 需 cron secret | `ChapterView` → `NovelDailyStat`，並清理過期明細。**FEAT-4 裁示（2026-08-06）：只處理已結束的日期**（台北時間昨日及更早），並回補自上次成功彙總以來所有未處理的已結束日期；**尚未結束的當日 MUST NOT 產生統計列**——當日資料仍在增加，納入則「同一日期重複執行結果完全相同」只在凍結資料的測試中成立。連帶：儀表板閱讀曲線最新至昨日，MUST 於畫面標示統計截止日；今日的收藏／留言／評分由 §4.2 `Novel` 的即時計數反映，不受此限 |

**排行榜計分公式**（初版，可調）：
`score = views × 1.0 + favorites × 8.0 + comments × 4.0 + rating × ratingCount × 0.5`

**取值語意（FEAT-4 裁示，2026-07-31）**：前三項取自 `NovelDailyStat` 的**每日新增量**——
weekly 取近 **7 日加總**、monthly 取近 **30 日加總**、alltime 取作品的**累計值**。
`NovelDailyStat` 三個計數 MUST 為新增量而非累計快照（見 §4.2 該 model 註），否則加總會把同一批收藏重複計 N 次。
**第四項 `rating × ratingCount` 三個週期一律取 `Novel` 的當前值**（FEAT-4 裁示 2026-08-07）：
`NovelDailyStat` 只有閱讀／收藏／留言三個計數、不含評分，「近 N 日的評分」在資料上並不存在；
原文只規定了前三項，第四項因而沒有來源。
**四項的取數 MUST 由 `repositories/stats.ts` 的 `sumDailyStatsForRanking(period, categoryId)`
一次回傳** `{ novelId, views, favorites, comments, rating, ratingCount }` —— 若該函式只回三類計數，
`rankingService` 為了補上評分項只剩「自行查 `prisma`」一條路，直接違反憲章第 III 條。
`rankings.ts` **MUST NOT 混入計分取數**（那一支是 `stats.ts` 的 `sumDailyStatsForRanking`）。
**它同時是 `RankingEntry` 的寫入落點**（FEAT-4 實作裁示 2026-08-08／T121／T126）：
每次重算的「讀前次名次 → `deleteMany` → `createMany`」三支函式住在本檔，
由 `rankingService` 在自己開的交易內依序呼叫。原文只寫「只讀供顯示」，
但重算總得有人寫 —— 照字面實作時 `rankingService` 只剩「自行查 `prisma`」一條路，
與第四項計分取數缺落點時完全相同的錯誤（違反憲章第 III 條）。
兩者的界線是**資料表**而非讀寫：`RankingEntry` 的一切存取在本檔，計分的取數在 `stats.ts`。

**三個排程作業的觸發方式（FEAT-4 裁示）**：本專案交付**受 cron secret 保護的三個入口 + 版控的 `npm run cron:*` 觸發指令**
（本機、CI 或任何外部排程器皆可呼叫），README 載明如何接上部署平台排程。
**MUST NOT 繫結特定雲端廠商的排程設定檔**，亦 **MUST NOT 在應用程式行程內跑常駐排程器**
（與 serverless 形態不相容，且多執行個體會重複執行，與 §7.6 單機限流的已知限制同性質）。
**密鑰未設定的環境 MUST 一律拒絕**，MUST NOT 因未設定而放行。
**部署目標已於 2026-08-08 定案**（部署選型裁示，落地於 `deploy/deployment.md`；2026-09-06 之前該文件位於 `novelsite/` 之下，已合併移入 `deploy/` 並刪除原檔）：
Oracle Cloud Always Free ARM 單一執行個體 + Caddy + 同機 PostgreSQL。
**2026-08-11 架構修訂（使用者裁示）**：該主機與網域**不是本站專用**，將以
**單一網域 + 路徑前綴**承載多個站台（`https://網域/novelsite`、`/othersite`…），
**每站一個 Docker 容器**，原文的「systemd + `npm run start`」隨之由 Docker Compose 取代
（`deploy/deployment.md` §0／§3.3／§3.5／§3.8 已就地改寫）。

**排程載體：獨立 `cron` 容器（FEAT-6 裁示，2026-08-13）。**
原文的「系統 crontab 呼叫 `npm run cron:*`」與其 2026-08-11 修訂版
「crontab 改以 `docker compose exec -T` 進容器執行」**兩者皆已失效，就地取代**。

- **改為**：`cron` 服務作為 Compose 的第四個容器（映像為 `novelsite/Dockerfile` 的
  `cron` stage，`FROM build` + `postgresql17-client`），容器內 `crond` 觸發三個作業，
  時區固定 `Asia/Taipei`（統計日界由 `src/lib/time/taipeiDay.ts` 以台北時間切分，
  容器跑 UTC 會讓 `rollup` 落在錯誤的日界）。三個作業本身與其頻率、順序**皆不變**。
- **該服務 MUST 有唯讀 bind mount `.:/app/deploy-cron:ro`**
  （FEAT-6 裁示，2026-08-14 第二輪補正；**來源自 `./deploy` 更正為 `.`**，
  *實作裁示（2026-08-15，T037）*——compose 的相對路徑以**compose 檔自己所在的目錄**為基準，
  而 `deploy/compose.yml` 就在 `deploy/` 之內，寫 `./deploy` 會解析成 `deploy/deploy`；
  **Docker 對不存在的 bind mount 來源會自動建出空目錄再掛進去**，於是三個檔案在容器內
  全部不存在，而容器照樣起得來。以 `docker compose config` 實測確認）：
  `crontab`、`backup.sh` 與共用的 `notify.sh`
  都在 repo 根的 `deploy/` 下，而 `cron` stage 的建置脈絡是 `novelsite/`——
  **`deploy/` 是它的兄弟目錄、不在 context 內，`COPY` 根本拿不到**。
  沒有這個掛載時容器起得來、排程也跑得動，只有備份那一行在半夜兩點靜靜地
  `No such file or directory`。**掛的是父目錄（`deploy/` 整層）而非 `deploy/cron/`**：
  通知腳本統一為 `deploy/notify.sh`（備份與部署共用唯一一份）並位於 `cron/` 之外，
  只掛 `cron/` 時**備份失敗的通知寄不出去**——一個為了「不靜默」而存在的機制自己靜默壞掉。
- **`crontab` 與 `backup.sh` 內對腳本的呼叫 MUST 寫成 `sh <路徑>`**
  （FEAT-6 裁示，2026-08-14 第三輪補正），MUST NOT 寫成 `/app/deploy-cron/cron/backup.sh`：
  本 repo `core.fileMode=false`（Windows 開發機），既有 `novelsite/scripts/` 全數為 `100644`
  ——**新增的 `.sh` 進版控時不帶執行位元**；而上一條的掛載是 **`:ro`，容器內 `chmod` 不了**，
  `cron` stage 又 `COPY` 不到 `deploy/`，**沒有任何環節能補上那個位元**。
  症狀是備份每天凌晨兩點一行 `Permission denied`，**而負責喊出來的 `notify.sh`
  因為同一個原因也叫不動**——與上一條同型，且這一次連上一條建立起來的通知路徑也一併失效。
  `sh <路徑>` 讓執行位元變成不相干的東西，是唯一不依賴任何人記得
  `git update-index --chmod=+x` 的作法。
  `novelsite/docker-entrypoint.sh` 為唯一例外：它 `COPY` 進映像、映像層可寫，
  由 Dockerfile 的 `RUN chmod +x` 修在源頭。
- **為什麼原文不適用**：主機 crontab 是一項**不在 `compose.yml` 裡的額外人工設定**，
  所以「乾淨機器 + 一份 `.env` + 一道指令」拉起來的站台**排程是空的**，
  而漏做的症狀是統計與排行靜止不動、**沒有任何錯誤訊息**（規格 FR-084、SC-020）。
- **本條的兩項禁令不受影響、反而更該遵守**：`crond` 是作業系統層機制、換任何一台
  Linux 機器都能照搬（未繫結廠商）；且它跑在**獨立容器**內，
  不是在應用程式行程內跑常駐排程器。
- **`CRON_BASE_URL` MUST 帶路徑前綴**（`http://novelsite:3000/novelsite`）：
  `scripts/cron.ts:26-28` 是把 `/api/cron/*` 直接接在該值後面，少了前綴會回 404；
  該腳本以非 0 離開碼結束，故錯誤會出現在 cron 日誌，不會靜默。

✅ **程式碼已支援路徑前綴**（6-B 交付完成，2026-08-15）：
2026-08-11 以 `basePath` 實際建置驗證，`proxy.ts` 的守衛轉址、
client `fetch('/api/...')`、`robots.txt`、`SESSION_COOKIE.path` 四類會壞
（**前兩類會把使用者導向或打到別的站**），清單與修法見 `deploy/deployment.md` §9 與
**GitHub issue #9**；已由 `npm run test:basepath`（§10.1 第五套）防止回歸。

> **client 呼叫點是 26 處而非 19 處**（*T019～T024 實作裁示（2026-08-15）*）：
> 原文的「19 處」來自樣式 `fetch\(\s*['"`]\/api\//`，它只看得見**直接寫在 `fetch(` 括號裡**
> 的字面量。實際呼叫點為 **26 處**，差的 7 處全部躲在該樣式的視線外：
>
> | 躲法 | 檔案 | 處數 |
> |---|---|---|
> | 路徑先進**常數**，`fetch(ENDPOINT)` | `lib/reader/{preferenceApi,bookshelfApi,readerStateMerge}.ts` | 3 |
> | 路徑經 **helper 函式**轉手，`send('/api/…', …)` | `components/novel/ReviewSection.tsx` | 4 |
>
> **為什麼原文行不通**：那 7 處在子路徑下壞得與另外 19 處一模一樣
> （書架按了沒反應、偏好同步永遠失敗、登入後書架是空的），
> 且它們的錯誤處理全是靜默的 `catch`——不會有任何一行訊息指向前綴。
> 更關鍵的是「數 19 處然後 grep 零命中」**本身無法發現這件事**：
> 那個 grep 在 7 處全未修的情況下同樣是零命中。
> 故稽核（`layering.test.ts` T027 區塊）已改守**任何** `/api/` 字面量 MUST 是 `apiUrl(` 的引數，
> 掃描範圍並加入 `lib/reader/**`——只擋 `fetch(` 的話，漏掉的正是
> **下一個人最容易新增的寫法**（把路徑抽成常數是重構的正常動作）。
原文「部署目標尚未定案」一句自 2026-08-08 起失效並已刪除 ——
它曾是「不得繫結廠商設定檔」的理由，但**該禁令本身不隨定案而解除**（理由見上方
`cron` 容器段的第三點）。
`/api/cron/publish-scheduled` 於**單次執行內**對同一作品發佈的多個章節，其追更通知 MUST 合併為一則（見 §4.2 `Notification`）。

### 5.8 管理者（Admin）

> **FEAT-9 新增（2026-09-03，對應 GitHub issue #15）**。
> 所有端點與 Server Action 授權層級皆為「**需管理員**（`role === 'admin'` 且帳號未停權）」，
> 於伺服器端嚴格驗證（`requireAdminForAction()`），非 admin 者一律回傳 403 `FORBIDDEN`，未登入回 401 `UNAUTHENTICATED`。
> 全後台統一速率限制：每位管理員 60 次/分鐘（超限回傳 429 `RATE_LIMITED` 並記錄稽核，FR-028）。
> 關鍵破壞性操作（停權、角色變更、下架、刪除、標籤合併）MUST 必填理由（`reason` ≤200 字），完成後一律寫入結構化純追加稽核紀錄（`AuditLog` 表）。
> 稽核紀錄遵守不可竄改與 PII 最小化原則（不存 Email 明文，IP 於 90 天後自動雜湊化，Clarification 2026-09-03）。

| Action / 方法 路徑 | 用途 | 授權 | 入參 | 回傳 | 錯誤 |
|---|---|---|---|---|---|
| `listUsersAction` | 分頁檢視全站使用者名單 | 需管理員 | `{ search?, role?, isSuspended?, cursor?, limit? }` | `{ items: AdminUserRow[], nextCursor }` | 400 / 401 / 403 |
| `suspendUserAction` | 停權使用者並撤銷其全部活躍 Session | 需管理員 | `{ userId, reason }`（**禁止停權自身；禁止停權最後一位 admin；reason 必填**） | `{ ok: true }` | 400 / 401 / 403 / 404 |
| `reactivateUserAction` | 復權使用者（解除停權） | 需管理員 | `{ userId, reason }` | `{ ok: true }` | 400 / 401 / 403 / 404 |
| `changeUserRoleAction` | 變更使用者角色（reader / author / admin）並撤銷舊 Session | 需管理員 | `{ userId, role, reason }`（**禁止降級自身、禁止降級最後一位 admin**） | `{ ok: true }` | 400 / 401 / 403 / 404 |
| `resetUserPasswordAction` | 管理員協助重設密碼（發送信件或產生一次性重設連結，Clarification 2026-09-03） | 需管理員 | `{ userId, mode: 'email' \| 'link' }` | `{ ok: true, resetUrl? }`（link 時效 15 分鐘） | 400 / 401 / 403 / 404 |
| `listNovelsAction` | 分頁檢視作品清單 | 需管理員 | `{ search?, status?, categoryId?, cursor?, limit? }` | `{ items: AdminNovelRow[], nextCursor }` | 400 / 401 / 403 |
| `adminSuspendNovelAction` | 違規下架作品（`status='admin_suspended'`）並使快取失效 | 需管理員 | `{ novelId, reason }`（**reason 必填**） | `{ ok: true }` | 400 / 401 / 403 / 404 |
| `adminRestoreNovelAction` | 恢復下架作品（`status='published'`） | 需管理員 | `{ novelId, reason }` | `{ ok: true }` | 400 / 401 / 403 / 404 |
| `adminDeleteNovelAction` | 管理員刪除作品（級聯硬刪除，使快取失效） | 需管理員 | `{ novelId, reason }`（**reason 必填**） | `{ ok: true }` | 400 / 401 / 403 / 404 |
| `listChaptersAction` | 檢視指定作品所有章節 | 需管理員 | `{ novelId }` | `{ items: AdminChapterRow[] }` | 400 / 401 / 403 / 404 |
| `adminSuspendChapterAction` | 管理員下架違規章節（`Chapter.status='admin_suspended'`，Clarification 2026-09-03） | 需管理員 | `{ chapterId, reason }`（**reason 必填**） | `{ ok: true }` | 400 / 401 / 403 / 404 |
| `adminRestoreChapterAction` | 管理員恢復違規章節（`Chapter.status='published'`，Clarification 2026-09-03） | 需管理員 | `{ chapterId, reason }` | `{ ok: true }` | 400 / 401 / 403 / 404 |
| `adminDeleteChapterAction` | 管理員硬刪除違規章節（同一交易內重算字數與章節數） | 需管理員 | `{ chapterId, reason }`（**reason 必填**） | `{ ok: true }` | 400 / 401 / 403 / 404 |
| `hideCommentAction` | 管理員隱藏違規留言（`status='hidden'`） | 需管理員 | `{ commentId, reason }` | `{ ok: true }` | 400 / 401 / 403 / 404 |
| `deleteCommentAction` | 管理員刪除違規留言（`status='deleted'` 墓碑，保留討論串結構） | 需管理員 | `{ commentId, reason }` | `{ ok: true }` | 400 / 401 / 403 / 404 |
| `listTagsAction` | 檢視全站標籤清單與關聯作品數 | 需管理員 | `{ search?, sortBy?: 'count' \| 'name' }` | `{ items: AdminTagRow[] }` | 400 / 401 / 403 |
| `createTagAction` | 新增全站標籤 | 需管理員 | `{ name, slug }` | `{ tagId }` | 400 / 401 / 403 / 409 |
| `renameTagAction` | 編輯標籤名稱與 slug | 需管理員 | `{ tagId, name, slug }` | `{ ok: true }` | 400 / 401 / 403 / 404 / 409 |
| `mergeTagsAction` | 合併標籤（源標籤轉移至目標標籤，自動去重並刪除源標籤） | 需管理員 | `{ sourceTagId, targetTagId, reason }`（**reason 必填**） | `{ movedCount }` | 400 / 401 / 403 / 404 |
| `deleteTagAction` | 刪除標籤（關聯作品 > 0 時需二次確認 force=true） | 需管理員 | `{ tagId, force?, reason }` | `{ ok: true }` | 400 / 401 / 403 / 404 / 409 |
| `listAuditLogsAction` | 查詢管理動作稽核紀錄（純查詢分頁，不可修改/刪除） | 需管理員 | `{ cursor?, limit?, actorId?, action?, targetType?, dateFrom?, dateTo? }` | `{ items: AuditLogRow[], nextCursor }` | 400 / 401 / 403 |

---

## 6. 功能與特色清單

標記說明：`✅ 已具備` = UI 已完成、`🔌 需接後端` = UI 在但功能是假的、`🆕 全新` = UI 與後端皆須開發。

### 6.1 讀者流

| 功能 | 狀態 | 說明 |
|------|------|------|
| 瀏覽首頁／書庫／分類／新書／排行榜 | ✅ | 已由 repository 讀 DB |
| 沉浸式閱讀器（字級／主題／無干擾／手勢） | ✅ | `ReaderView` 已完備 |
| **章節真實正文** | 🔌 | 目前為 `generateChapterParagraphs()` 造假，改讀 `ChapterContent` |
| 註冊／登入／登出 | 🔌 | 改走 `authService` + HTTP-only Cookie |
| 書架（收藏） | 🔌 | `localStorage` → `Bookshelf` 表，跨裝置。**Phase 9 過渡**：功能保留可用，加註「目前僅保存在此瀏覽器，換裝置不會同步」。**加註對象為每一個接觸點，不只書架頁**（第五輪補入）—— 作品詳情頁 `NovelHero` 的「加入書架」控制項同樣只寫本機，且是使用者最常觸發的入口；只在 `/profile/bookshelf` 加註等於在使用者做完決定之後才告知 |
| 閱讀歷史 | 🔌 | `localStorage` → `ReadingHistory` 表。**Phase 9 過渡**：同上加註 |
| **續讀（回到上次位置）** | 🆕 | `ReadingProgress` 記錄章節 + 捲動百分比，作品頁顯示「繼續閱讀第 N 章」。**還原機制（FEAT-4 裁示 2026-08-07）**：續讀入口連向 `/reader/{novelId}/{chapterId}?resume=1`，閱讀頁於正文渲染完成後把捲動位置還原至該 `percent`；**還原完成前 MUST NOT 讓節流上報送出**，否則首次的 0% 會覆寫掉正要還原的值，續讀在第一次使用後即自我銷毀。此點補入的理由：原文只寫「記錄 + 顯示入口」，而「顯示入口」與「回到位置」是兩件事，缺後者會交出一個按下去停在章節開頭的功能。**FEAT-4 裁示：上報時機為「離開頁面 ＋ 閱讀中每 30 秒節流（僅百分比有變化時）」** —— MUST NOT 只靠離開事件：闔上裝置、瀏覽器當掉或分頁被系統回收時該事件不會送出，而本站讀者停留以小時計（憲章第 I 條），整段進度會無聲遺失 |
| **閱讀偏好跨裝置同步** | 🆕 | 登入時以 `ReaderPreference` 覆寫本機設定，未登入仍走 `localStorage`。**同步範圍只有字級（`sm`/`md`/`lg`）與主題**——不含行高（全站無控制項）與無干擾模式（明訂不跨章節記憶），見 §4.2 該 model 註。**伺服器端尚無紀錄時（首次登入）以本機現值建立**，MUST NOT 以預設值覆蓋使用者既有設定。**客戶端落點橫跨兩個 Hook（FEAT-4 裁示 2026-08-07）**：字級在 `useReaderPrefs`、主題在 `useTheme`（`localStorage` 鍵 `novelsite-theme`），**兩者 MUST 一併改造**；`useReaderPrefs` 只有 `fontSize` 與 `distractionFree`（後者明訂不跨章節記憶，MUST NOT 同步），主題自始由 `useTheme` 獨立管理（見 §4.2 `ReaderPreference` 註）。只改前者則 `theme` 沒有寫入端也沒有消費端，跨裝置一致的主題部分恆假，而直接打 API 的整合測試看不出這件事。合併酬載 MUST 帶滿**四個**本機鍵（書架、閱讀歷史、`novelsite-reader-prefs`、`novelsite-theme`），但**觸發判定與清除只涵蓋前兩個**（FEAT-4 裁示 2026-08-07）——字級與主題兩鍵在登入態會被 Hook 持續回寫（離線快取＋首次繪製的防閃爍來源），納入觸發判定則合併每次登入都被自己的快取重新命中，「成功後清除、下次登入不再觸發」永遠不成立；兩鍵重複上傳無副作用（伺服器已有紀錄時不覆蓋） |
| 評分與評論 | ✅ | `ReviewSection` 已改為可寫入、一人一評、可編輯刪除、可按讚，排序（熱門／最新）由**伺服器**承擔，首屏由 Server Component 渲染**第一頁**、其餘按「載入更多」取（FR-023a）。**FEAT-4 裁示：示範評論一併移除**（見 §4.4 第 2 點），故該區塊在示範資料上為**空狀態**，其空狀態 MUST 設計完整並納入 a11y 檢查。**FEAT-4 實作裁示（2026-08-07／T075）：原有的「評分分佈長條圖」已移除**——它要的是每一顆星各有幾則，而首屏只拿得到第一頁；以一頁的分佈畫出「全作品的分佈」，畫面上就是一組沒有來源的數字，與 FR-043a 刪除示範評論的理由完全相同。總覽改為只顯示伺服器的累計值：平均分（`Novel.rating`）與**評分人數**（`Novel.ratingCount`，MUST NOT 用 `commentCount`——後者含章節留言） |
| **評論按讚** | 🆕 | `ReviewLike`。**FEAT-4 裁示：評論列表改由伺服器排序與游標分頁**（`GET /api/novels/{id}/reviews?sort=hot\|latest`，每頁 20）—— 現況是詳情頁一次載入全部評論再由前端排序，可寫入後會隨評論數無上限成長；既有的「熱門／最新」切換保留，排序須有確定性次序（同讚數／同時間以識別碼決勝）否則分頁會重複或遺漏 |
| **章節留言（樓中樓）** | 🆕 | `Comment`，閱讀頁章末區塊。**不含留言按讚**（FEAT-4 裁示 2026-08-06）——`likeCount` 欄位保留但本階段無寫入路徑，值恆為 0，MUST NOT 為它產生 UI 控制項；理由見 §4.2 該 model 註 |
| **追更通知** | 🆕 | 書架作品有新章節時產生 `Notification`；通知中心頁。**作者本人不收到自己作品的通知**；**同一次排程作業執行內發佈多章合併為一則**（見 §4.2 `Notification`）。本階段只產生此一種型別 |
| 全站搜尋 | 🔌 | 改 DB 層搜尋（M-4），新增 typeahead 建議 |
| 聯絡我們表單 | 🔌 | `ContactForm` 原本只 `setSent(true)` 並顯示「訊息已送出，我們會盡快與你聯繫」，實際無任何寄送途徑。**Phase 9 過渡**：送出控制項停用並標示「功能開發中」，移除成功畫面 —— 對訪客謊報「已收到來信」與登入後的假成功同性質（§6.2 的判準一體適用於公開頁面）。**解除條件已排入 Phase 14（FEAT-5，GitHub issue #6）**：該階段接上寄送能力後，送出控制項 MUST 解除停用，「功能開發中，尚無法送出訊息」的文案 MUST 一併移除（原文「接通須待郵件基礎設施」已由 Phase 14 承接，不再是無限期待命）。**但停用態的判準本身不變**：若寄送能力在該環境未設定，入口仍 MUST 誠實停用或明確報錯，MUST NOT 假成功 —— 解除的是「永遠停用」，不是誠實標示本身（FEAT-5 spec FR-017／FR-023 裁示，2026-08-09） |

### 6.2 作者流

| 功能 | 狀態 | 說明 |
|------|------|------|
| 作者後台版面／側欄 | ✅ | `/author/*` |
| **作品 CRUD** | 🔌 | `CreateNovelForm` 目前只 `setSubmitted(true)`，改走 Server Action。**Phase 9 過渡**：送出控制項停用並標示「功能開發中」 |
| **作者作品列表** | 🔌 | `getAuthorNovels()` 查詢無擁有者條件，任何作者都看到同一批。**Phase 9 過渡**：列表保留並標示「示範資料，作品擁有權尚未接上」、編輯入口停用；Phase 10 加 `authorId` 後才真正歸屬 |
| **作品連載狀態切換** | 🔌 | `AuthorNovelList.toggleStatus` 只改前端 `useState` 卻跳出「《…》已重新上架」／「已暫停連載」的成功提示，重新整理即回復原狀 —— **屬假成功，且比表單類更具誤導性**（作者會以為作品真的下架了）。**Phase 9 過渡**：移除該 `showToast`、控制項停用並標示「功能開發中」，停用原因須可被輔助技術讀出。**第六輪補入** —— 它是列表內的切換鈕而非表單送出鈕，逐項列舉時被歸類錯過；其 `showToast(` 又是跨多行書寫，連 §10.6 的全站掃描都因原樣式為逐行比對而漏掉它 |
| **章節編輯器存檔／發佈** | 🔌 | `ChapterEditor` 目前只 `showToast`，改走 Server Action 寫 `ChapterContent` |
| **草稿 / 排程 / 發佈工作流** | 🆕 | `Chapter.status` + `scheduledAt` + cron |
| **分卷與章節排序** | 🆕 | `createVolumeAction` / `reorderChaptersAction` |
| **真實數據儀表板** | 🔌 | Chart.js UI 保留，資料改讀 `NovelDailyStat` |
| **讀者留言管理** | ✅ | 作者可隱藏（不可竄改）自己作品下的留言。落點：側欄「留言管理」→ `/author/comments` → `GET/PATCH /api/author/comments`（§5.4） |
| **作品成效總覽（原 `/author/earn`）** | 🔌 | **平台全免費，收益語意移除**，改為「作品成效總覽」：曝光、完讀率、收藏轉換、留言熱度。**FEAT-4 裁示（2026-08-06）：四項指標的期間統一為近 7 日（與 `ChapterView` 保留期一致）並於畫面標示，且 MUST 直接由 `ChapterView` 明細計算，MUST NOT 改讀 `NovelDailyStat`** —— 完讀率與收藏轉換的分母為**不重複讀者數**，而每日統計只有計數、無讀者身分維度，跨日相加會使同一位讀者被重複計入，分母語意從「人」滑成「人日」；期間 MUST NOT 超過明細保留期（超出部分無原始紀錄可反推）。於 `NovelDailyStat` 增設「當日不重複讀者數」欄位已評估並排除，理由同上。期間內明細已被清理時顯示「尚無資料」，MUST NOT 回退讀每日統計而給出口徑不同的數字。**Phase 9 過渡**：金額與拆分表保留，但須標示「示範資料，尚未接上真實統計」並與區塊程式化關聯 —— 現有頁尾的「示範性預估值」註記不足，該措辭把數字表述為合理估算而非未接通的假資料。<br>**回傳形狀（FEAT-4 裁示 2026-08-07，T090）**：`statsService.getNovelPerformance(authorId, novelId)` 回 `PerformanceMetrics \| null`，`PerformanceMetrics = { periodDays: 7, periodStart: Date, periodEnd: Date, impressions: number, distinctViewers: number, completionRate: number \| null, favoriteConversion: number \| null, commentHeat: number }`；非本人作品或作品不存在時回 `null`（MUST NOT 擲出）。**兩項比率在分母為 0 時 MUST 為 `null`，MUST NOT 為 0／`NaN`／`Infinity`**——原文只寫「顯示尚無資料」而未給型別，照字面實作最自然的落點就是回 0，而 `0%` 是一個斷言（「來的人都沒讀完」），事實卻是「沒有人來過」，兩者對作者的意義相反且 UI 無從分辨。`impressions` 與 `commentHeat` 是計數不是比率，無資料時即為 `0`，MUST NOT 一併改成 `null` |
| 創作指南 `/author/guide` | ✅ | 靜態頁，保留 |

### 6.3 平台

| 功能 | 狀態 | 說明 |
|------|------|------|
| SEO（metadata / sitemap / robots / OG 圖） | ✅ | `sitemap.ts` 改為依 DB 動態產生已發佈作品與章節 |
| 無障礙（Skip Link、`useId`、`prefers-reduced-motion`） | ✅ | 維持 |
| 三主題切換（白紙／護眼／夜間） | ✅ | 維持 |
| Analytics（GA4） | ✅ | 維持 |
| **安全性 HTTP 標頭 + CSP** | 🆕 | E-5 / E-4 |
| **速率限制** | 🆕 | 登入、註冊、評論、留言 |
| **排行榜排程計算** | 🆕 | 取代靜態 seed |
| **健康檢查端點** | 🆕 | `/api/health`；匿名只回 ok/fail，帶 `HEALTH_CHECK_SECRET` 才揭露 provider 與 DB 延遲 |
| **測試框架** | 🆕 | Vitest + Playwright（目前完全沒有） |

---

## 7. 安全機制

### 7.1 H-1：伺服器端信任邊界

**現況問題**：登入態只存 `localStorage['novelsite-auth']`；`/author/*` 的 layout 毫無守衛；`/profile/*` 的 `ProfileGate` 是 client-side redirect，內容已於 SSR 送達瀏覽器。

**架構**：

```
登入成功
  → authService 產生隨機 token（32 bytes）
  → DB 存 sha256(token) 於 Session.tokenHash（可撤銷、可列出裝置）
  → jose 簽發 JWT（payload: { sid, uid, role }）寫入 Cookie
     name: novelsite_session
     httpOnly: true · secure: true（prod）· sameSite: 'lax' · path: '/'
     maxAge: SESSION_ABSOLUTE_TTL_DAYS × 86400（秒，預設 90 天 —— 見下方「Cookie 存活期」）
```

**有效期規則（滑動 + 絕對上限）**：

- `Session.expiresAt` 為**閒置期限**，每次成功使用延展至該次使用起算 `SESSION_TTL_DAYS`（預設 30 天）後
- `Session.createdAt + SESSION_ABSOLUTE_TTL_DAYS`（預設 90 天）為**絕對上限**，滑動延展**不得突破**；逾任一期限即失效
- 延展採**節流寫入**：距上次延展未滿 `SESSION_SLIDING_THROTTLE_HOURS`（預設 24）的請求只讀不寫，避免每次翻頁都寫 DB。副作用為閒置容忍時間最壞為「閒置期限 − 門檻」（預設 29 天），為明確接受的取捨

**Cookie 存活期（定案）**：

- Cookie 的 `maxAge` MUST 取**絕對上限**（`SESSION_ABSOLUTE_TTL_DAYS`）換算的秒數，**MUST NOT 取閒置期限**。閒置判定的權威來源是 `Session.expiresAt`，Cookie 只是憑據的載體
- 若 `maxAge` 只有 30 天，活躍使用者的 Cookie 會在第 30 天自行消失 —— **滑動延展與 90 天絕對上限在使用者可感知的層面永遠不會生效**（DB 的 `expiresAt` 延展了，瀏覽器卻已不再送出憑證）
- Cookie **MUST NOT 隨滑動延展重新下發**：重新下發須在每個頁面請求上寫入回應，會迫使攔截層對公開頁面付出額外成本（違反下方 matcher 的「公開頁零成本」要求）；以絕對上限為 `maxAge` 可零成本達成同一結果
- Cookie 存活期長於伺服器端到期時間**不構成風險**：逾期或已撤銷的 session 一律被 `readSession` 拒絕，Cookie 形式有效不等於工作階段有效
- 屬性集中定義於 **`src/lib/auth/sessionToken.ts`** 的 `SESSION_COOKIE` 常數（第六輪自 `session.ts` 移出，理由見下），MUST NOT 於呼叫端各自拼裝（避免兩處 `maxAge` 漂移）；單元測試 MUST 斷言其等於絕對上限換算的秒數

**憑證層與工作階段層必須是兩個模組（第六輪修正）**：

| 模組 | 內容 | 相依 | 誰可以 import |
| --- | --- | --- | --- |
| `lib/auth/sessionToken.ts` | `SessionClaims`、`SESSION_COOKIE`、`signSessionToken`、`verifyClaimsOnly`、`hashToken` | **僅** `jose` + `lib/env` | `proxy.ts`、`session.ts`、單元測試 |
| `lib/auth/session.ts` | `issueSession`、`readSession`（含節流延展）、`revokeSession`、`revokeAllSessionsForUser` | 上者 + `repositories/sessions` | service、guard、Route Handler |

原設計把 `verifyClaimsOnly` 與 `readSession` 放在同一個 `session.ts`，同時又要求
`proxy.ts` 呼叫前者且「不得 import repositories」—— **兩者無法同時成立**，因為
**模組相依是傳遞性的**：`session.ts` 為了 `readSession` 必然 import `repositories/sessions`
（帶 `import 'server-only'`，並拉進 Prisma 客戶端與 `better-sqlite3` 原生驅動），
攔截層一 import 就把整條鏈帶進其打包產物，`server-only` 在該層的解析條件下還可能於載入
階段直接擲錯。**`session.ts` 不得轉出 `verifyClaimsOnly`** —— 轉出等於留了一扇後門讓
`proxy.ts` 有機會 import 它。教訓與 §10.1 的解析條件問題同源：
**「零 I/O」是模組邊界的性質，不是函式的性質**。

`proxy.ts` **允許的 import 窮舉為四項**：`next/server`、`lib/security/csp`、
`lib/auth/sessionToken`、`lib/auth/audit`；出現 `lib/auth/session`、`lib/auth/guard`、
`lib/repositories/*`、`lib/db`、`@prisma/*` 任一即為違反，以原始碼稽核把關（§10.6 DoD）。

**角色快照（`role` claim）**：

路由攔截層可能運行於**無法直連資料庫**的執行環境，因此角色必須隨憑證攜帶：

- JWT payload 含 `role`，為**簽發當下的快照**。攔截層只驗簽即可判斷 `/author/*` 的准入，**零 I/O**
- 快照**不是權威來源** —— layout 二次驗證一律另行以 DB 中的 `User.role` 覆核。快照與 DB 不一致時**以 DB 為準**
- **任何變更使用者角色的操作，MUST 立即撤銷該使用者當時全部 session**（比照改密碼），否則舊憑證會持續攜帶過期角色。Phase 9 不實作角色變更，此約束為 Phase 11 `becomeAuthorAction` 的前置條件

**三道防線**：

1. **路由攔截**（**`src/proxy.ts`** —— Next.js 16 已將 `middleware.ts` 更名為 `proxy.ts`，[待查] 已結案，見附錄 B）：`/author/*`、`/profile/*` 無有效 cookie 即 `NextResponse.redirect('/auth/login?next=…')`；`/author/*` 另需 claim 的 `role ∈ { author, admin }`（**身分只看單一 `role` 欄位**）。此層同時**逐請求產生 CSP nonce** 並向下傳遞（見 §7.5）

   > **執行環境的更正**：Next 16 的 Proxy **預設跑 Node.js runtime**（`runtime` 設定選項在 proxy 中不可用，設了會拋錯），技術上**可以**連資料庫 —— 與本節原先的假設不同。但 `role` 快照的設計仍維持不變且理由更強：(a) 官方文件明言 Proxy「is not intended for slow data fetching」「should not be used as a full session management or authorization solution」；(b) 攔截層作用於全站，每頁一次 DB 查詢違反「公開頁不付查詢成本」；(c) layout 以 DB 覆核已涵蓋權威性需求。

   **作用範圍（matcher）**：因每個頁面都需要 nonce，攔截層必須作用於**所有頁面請求**，但明確排除**靜態資源、圖片與 `/api/*` 整個前綴**（含 `/api/health`）—— API 回應是資料而非頁面、不含 script，套政策無意義，且每個請求多付一次攔截成本。**「靜態資源」的排除須同時涵蓋 `_next/static`／`_next/image`／`favicon.ico` 與 `public/` 下的檔案（第六輪補入，以副檔名排除）** —— 前綴排除只涵蓋框架打包輸出，`public/` 的檔案是以 `/檔名.副檔名` 直接命中的，不排除即會進攔截層並被加上 CSP 標頭，與本段的表述分歧（現況該目錄只有 5 個未使用的預設 svg，而 `sitemap.ts` 產生的 `/sitemap.xml` 現已存在、其 `.xml` 已在副檔名排除之列，`robots.txt`／字型檔日後亦可能出現）。API 端點的來源驗證由端點自身的 `assertSameOrigin` 負責（§7.6），不倚賴攔截層；其餘五個安全性標頭仍由 `next.config.ts` 的全域 `headers()` 套用於**所有**回應（含被排除者），故被排除的回應「有 HSTS／X-Frame-Options 等防護但無 CSP 標頭」是預期結果。範圍內**所有**請求都產生並注入 nonce；**只有 `/author/*`、`/profile/*` 才走守衛分支** —— 公開頁面不付出任何驗簽或查詢成本。公開頁與受保護頁**套用同一套 CSP**，不得為公開頁另設寬鬆版本（公開頁才是 XSS 的主要受攻擊面）
2. **Layout 二次驗證**：`src/app/author/layout.tsx`、`src/app/profile/layout.tsx` 改為 async Server Component，呼叫 `requireAuthor()` / `requireUser()`，**以 DB 的 `User.role` 覆核**，未通過即 `redirect()`——**攔截層可能因設定失誤被繞過，layout 是最後保險**
3. **Service 層授權**：每個寫入操作獨立檢查 session 與 ownership

**`ProfileGate` 移除**，`useAuth` 改為讀取伺服器透過 layout 傳入的 session context（`SessionProvider`），**client 不再是登入狀態的來源**。

> **`SessionProvider` 掛在 root layout 與「公開頁零成本」不衝突**（第四輪一致性檢查釐清）：
> 上述 matcher 的零成本要求，其**適用對象只有攔截層**。版面層在每個頁面讀取登入狀態是
> `SiteHeader` 出現於全部 26 頁的必然代價，且成本不對稱 —— **未登入的訪客沒有憑證可讀，
> `getSession()` 直接回 `null`，零驗簽零查詢**；已登入者才付出每頁一次驗簽與一次查詢
> （滑動延展另受 §7.1 的節流寫入約束）。若把零成本要求讀成「版面層也不得在公開頁面讀登入
> 狀態」，唯一的實作結果就是把 `SessionProvider` 只掛在 `/author`、`/profile` 的 layout ——
> 那會讓公開頁面的頁首全站取不到 context，是明確禁止的做法。

### 7.2 H-2：密碼與憑證

| 項目 | 做法 |
|------|------|
| 雜湊演算法 | **argon2id**（`@node-rs/argon2`，原生效能佳）；若部署環境不支援原生模組，退回 `bcrypt`（cost = 12）——**擇一並記錄於 README** |
| **成本參數（定案）** | argon2id `memoryCost = 19456`（19 MiB）、`timeCost = 2`、`parallelism = 1`、`outputLen = 32` —— OWASP Password Storage Cheat Sheet 的建議組合。**MUST 集中定義為 `src/lib/auth/password.ts` 的具名常數 `ARGON2_PARAMS`**，MUST NOT 散落於呼叫端。此參數是 §10.6 回應時間目標（p95 < 1 秒）**唯一的變數**：實測 p95 逼近上限時 MUST 下調 `memoryCost` 並重新量測，MUST NOT 略過量測 |
| **時序不可區分的假雜湊** | 帳號不存在時用以比對的 `DUMMY_HASH` MUST 以**相同的 `ARGON2_PARAMS`** 產生 —— 參數不同則耗時不同，「不得因帳號不存在而明顯較快返回」的要求即落空 |
| 儲存 | `User.passwordHash`，**永不存明碼、永不可逆** |
| Email 正規化 | 比對與寫入前一律去除前後空白並轉小寫 —— 含前後空白的 `A@Example.com` 與 `a@example.com` 視為同一帳號 |
| 註冊 | Zod 驗證（含 `acceptTerms` 必為 `true`，伺服器端一併驗證）→ email 唯一性檢查 → hash → 建立使用者並寫入 `termsAcceptedAt` |
| 登入 | 以 email 查使用者 → `verify(hash, password)` → 失敗一律回「Email 或密碼不正確」 |
| 改密碼 | Phase 9 只實作**伺服器端函式**（不開對外端點、不做 UI，供整合測試與日後個人設定頁呼叫）；需驗證舊密碼；成功後**撤銷該使用者全部 session（含發動變更的那一個）** |
| **無密碼救援途徑** | **Phase 9～13 的處置（其解除排入 Phase 14）**：無重設信、無管理端重設 —— 真實使用者忘記密碼即帳號永久失效。處置為**事先告知**：登入頁明示「本階段尚無密碼重設功能」，註冊流程於**送出前**告知同一件事，且**不得放任何「忘記密碼」入口或流程假象**。列入 README 已知限制。**兩處原文已失效，取代如下（FEAT-5 spec 裁示，2026-08-09，GitHub issue #5）**：(a) 原文「改密碼函式不對外」自 **Phase 11（FEAT-3）**起不成立 —— `/profile/settings` 已可自行改密碼，正確表述是「**登入前**無救援途徑；登入後可自行更改密碼」；(b) 原文「不得放任何『忘記密碼』入口」的成立前提是「沒有可用的救援途徑，放了就是假象」，**Phase 14 交付真正可用的自助重設流程後該前提消失，禁令隨之解除**，登入頁 MUST 提供忘記密碼入口（FR-014）；**（c）事先告知的文案有兩處而非一處**（`/speckit-analyze` 第二輪補正，2026-08-09）——原文的處置寫的是「登入頁明示 ＋ **註冊流程於送出前告知同一件事**」，實際落在 `LoginForm.tsx:68` 與 `RegisterForm.tsx:60`，**Phase 14 交付時兩處 MUST 一併移除**；只改登入頁會使該階段新增的全站掃描（`尚無密碼重設功能`）在交付當下就紅，而那個紅燈與實作進度無關。原文所指的解除階段 **Phase 13 是誤植** —— Phase 13 的項目清單自始沒有任何郵件相關項目，且已於 2026-08-08 執行完畢，照字面等於指向一個不存在的工作項；正確落點為新增的 **Phase 14** |
| **移除示範帳密提示** | 刪除 `src/components/auth/LoginForm.tsx:48-50` 的畫面提示 |
| Seed | 固定建立 `reader` / `author` / `admin` 三個示範帳號；密碼改由 `SEED_USER_PASSWORD` 環境變數提供，seed 時 hash 寫入；未設定則**每個帳號各自**產生隨機密碼並印在 console（不落入程式碼） |

### 7.3 H-3：付費章節 —— **已移除**

平台定位為**全免費**，架構中不存在付費牆。隨之刪除：

- `Chapter.isFree` 欄位（schema、mapper、型別 `src/lib/types.ts:32`）
- `src/components/reader/ReaderView.tsx:200-202` 的鎖頭提示與 `Lock` icon import
- `/author/earn` 的收益換算語意（改為「作品成效總覽」）
- `getChapterContext()` 內任何與付費相關的分支（現況本就沒有，故為淨移除）

**授權模型因此簡化為**：章節內容的可見性只取決於 `Chapter.status === 'published'`（未發佈者僅擁有者可見）。

**治理同步**：專案憲章 **v1.0.2** 已據此將「上線前必經」的 H-3 標為**不適用**（原文列 H-1／H-2／H-3 三項 MUST，與本節的移除決定字面衝突）。其解除條件為上列付費殘留刪除完成，屬 Phase 10（FEAT-2）；在此之前不得以「H-3 未完成」為由阻擋 H-1／H-2 已到位的部署。

### 7.4 M-2：Markdown 淨化（儲存型 XSS）

- **寫入時**：`chapterService` 對 `bodyMarkdown` 做長度上限（單章 ≤ 100,000 字元）與控制字元過濾
- **渲染時**：`react-markdown` **禁止** `rehype-raw`；強制加上 `rehype-sanitize`（預設 schema），並在 `ChapterEditor` 預覽與讀者端使用**同一個共用元件** `<SafeMarkdown>`，避免兩處設定漂移
- **CI 防線**：ESLint 規則禁止 import `rehype-raw`
- **`<SafeMarkdown>` MUST NOT 提供任何可放寬淨化的 prop**——留一個開關，設定漂移就只是時間問題
- **連帶的破壞性變更（FEAT-3）**：領域型別 `ChapterContext.paragraphs` 改為 `bodyMarkdown: string`。
  閱讀頁若仍吃切好的段落陣列，就必然存在第二條渲染路徑，「兩處共用同一元件」即失效；
  `splitParagraphs()` 一併移除
- **既有閱讀排版不得退化**（憲章第 I 條）：閱讀頁改以共用元件渲染後，字級、行高、主題、
  無干擾模式與段落間距等既有閱讀參數 MUST 維持。此為可見的渲染路徑變更，MUST 有可驗證的
  成功條件（排版契約的斷言），不得只憑目視

### 7.5 E-4 / E-5：安全性 HTTP 標頭與 CSP

**設定處的職責切分（定案）**：CSP 因需逐請求 nonce，MUST 由 `src/proxy.ts` 設定；其餘五個標頭為靜態值，MUST 由 `next.config.ts` 的 `headers()` 設定並套用於**所有**回應。此切分正好達成「靜態資源與 API 有 HSTS 等防護但無 CSP 標頭」的驗收要求（§10.3 案例 22）。

| 標頭 | 設定處 | 套用範圍 | 值 |
|------|--------|----------|-----|
| `Content-Security-Policy` | `src/proxy.ts`（逐請求 nonce） | 攔截層 matcher 範圍內的**頁面請求**；靜態資源、圖片、`/api/*` **不含** | `default-src 'self'; script-src 'self' 'nonce-<per-request>' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://www.google-analytics.com; font-src 'self' data:; connect-src 'self' https://www.google-analytics.com https://www.googletagmanager.com; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'` |
| `Strict-Transport-Security` | `next.config.ts` `headers()` | 所有回應 | `max-age=63072000; includeSubDomains; preload` |
| `X-Frame-Options` | `next.config.ts` `headers()` | 所有回應 | `DENY` |
| `X-Content-Type-Options` | `next.config.ts` `headers()` | 所有回應 | `nosniff` |
| `Referrer-Policy` | `next.config.ts` `headers()` | 所有回應 | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `next.config.ts` `headers()` | 所有回應 | `camera=(), microphone=(), geolocation=()` |

**政策字串的產生方式（MUST）**：CSP 字串 MUST 由**單一純函式** `buildCspPolicy(nonce, { isDev })`（`src/lib/security/csp.ts`）產生，由 `proxy.ts` 呼叫。`isDev` MUST 由呼叫端傳入，函式內 MUST NOT 讀 `process.env` —— 讀了則單元測試無法在同一支測試中同時斷言正式與開發兩種模式。政策若以字串常值內嵌於攔截層內部，下方「正式產物零放寬」的斷言就只能在整合測試層做，等於放棄最便宜的一道防線。

**上線模式**：CSP **直接以強制模式（`Content-Security-Policy`）上線，不採 `Content-Security-Policy-Report-Only` 過渡**。違規須在本機與整合測試階段清零 —— 既有的捲動動畫、Chart.js 儀表板、三主題切換與 GA4 皆須在強制模式下逐一驗證通過，任一項因政策失效即不得視為完成。

**衝突時的處置優先序**：**改功能實作或改腳本的允許方式，不放寬 `script-src`**（框架自身造成的衝突亦同 —— 見下方 E-4）。`script-src` 永遠不得含 `'unsafe-inline'` 或 `'unsafe-eval'` —— 一旦放寬，CSP 對 XSS 的防護幾乎歸零，等於推翻 E-4／E-5 的目的。`style-src 'unsafe-inline'` 是**唯一明列的既有例外**：樣式注入的風險等級遠低於腳本執行，而移除它須改寫大量既有內聯樣式，成本與收益不成比例。除此之外新增任何放寬皆視為未完成。

**量測基準與開發模式的唯一例外（定案）**：上述禁令的量測對象為 **`next build` 的正式產物**。Next.js 16 隨版文件（`node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`）明載「In development, `'unsafe-eval'` is required because React uses `eval` to provide enhanced debugging information... `unsafe-eval` is not required for production. Neither React nor Next.js use `eval` in production by default.」因此：

- `script-src` MUST 以 `process.env.NODE_ENV === 'development'` 為條件追加 `'unsafe-eval'`，**僅限開發模式**
- 正式建置產物 MUST 完全不含 `'unsafe-inline'` 與 `'unsafe-eval'`，且 MUST 以單元測試斷言政策字串 —— 斷言對象為上方的 `buildCspPolicy()`：`isDev: false` 的輸出不含這兩個關鍵字且 `script-src` 含 `'strict-dynamic'` 與傳入的 nonce，`isDev: true` 僅 `script-src` 多出 `'unsafe-eval'`
- 不加的代價是 dev 主控台持續違規、React 錯誤堆疊重建失效，換不到任何正式環境的安全收益
- 此為**唯一**的開發模式例外；`style-src 'unsafe-inline'` 為唯一的既有例外，兩者以外一律視為未完成

**GA4 與 `'strict-dynamic'` 的交互作用**：`'strict-dynamic'` 生效時瀏覽器**忽略 `script-src` 的主機白名單**，故 `googletagmanager.com` 不必列入 `script-src` —— 由帶 nonce 的 `<Script>` 載入、其衍生腳本經 `'strict-dynamic'` 獲准。但 GA4 的資料回傳走 `connect-src`／`img-src`，兩者 MUST 明列 `https://www.google-analytics.com`（`connect-src` 另含 `https://www.googletagmanager.com`），否則主控台仍會出現違規。**驗證 GA4 是否被擋時 MUST 設定 `NEXT_PUBLIC_GA_ID`** —— 未設定時 `Analytics` 元件完全不輸出 script，等同未驗證。

**E-4 的處理方式 —— 為何是 nonce 而非 hash**：

原方案為 CSP hash（`'sha256-…'`，建置期算出、保留靜態化）。**該方案不可行**：App Router 於**每個頁面注入內容隨頁面而異的內聯串流腳本**（RSC payload），其雜湊無法在建置期窮舉；強制模式一上線，全站 React 水合即被擋下。逐一列舉框架腳本雜湊同樣不可行 —— 任一頁面改版即政策失效並導致全站白畫面。

**定案**：

- `script-src` 改用**逐請求產生的 nonce** + `'strict-dynamic'`。`'strict-dynamic'` 讓已通過驗證的腳本得以載入其衍生腳本，因此不需列舉框架腳本，GA4 亦由 `next/script` 帶 nonce 載入而不必列網域
- nonce 由**路由攔截層**產生（每請求一個、不得跨請求重用），同時寫入 CSP 標頭與請求標頭；`layout.tsx` 的防閃爍 inline script 與 `<Script>` 皆自同一來源取得該 nonce ——「單一來源推導」的要求不變，只是來源從建置期常數改為請求範圍的值
- **代價**：受影響頁面**改為動態產生**，靜態化損失為明確接受的取捨。理由是放寬 `script-src` 所損失的 XSS 防護不可回復，而靜態化的損失可由快取策略（§2.5）彌補
- `scripts/csp-hash.ts` **不再需要**，已自 §2.3 目錄結構移除
- **nonce 的傳遞慣例已結案**（附錄 B 第 8 項）：Proxy MUST 同時把 nonce 寫入**請求標頭** `x-nonce`、**請求標頭** CSP 與**回應標頭** CSP —— Next.js 自請求標頭的 CSP 解析 nonce，並**自動**套到框架腳本、頁面 bundle 與框架自產的內聯腳本；防閃爍 script 與 `<Script>` 由 Server Component 以 `(await headers()).get('x-nonce')` 取得後手動帶上。只設回應標頭會使框架腳本沒有 nonce 而被擋

### 7.6 其他防護

| 項目 | 做法 |
|------|------|
| 入參驗證 | 所有 API / Action 入口以 Zod parse，失敗回 `VALIDATION_ERROR` + 欄位訊息 |
| **CSRF** | 自建 session 必須處理：Cookie 設 `SameSite=Lax`（阻擋跨站 POST）+ **Server Action / 寫入 API 一律比對 `Origin` 與 `Host`**，不符即 403 |
| **閱讀上報的限流（FEAT-4 新增）** | 閱讀上報入口對匿名開放，MUST 以**來源位址**為鍵限流（預設 60 次/分鐘），**超額靜默捨棄**（回成功但不寫入，不回 429）。缺此則換一個 UA 即產生新的去重鍵，可無上限灌爆曝光、排行分數與明細表 |
| 速率限制 | `src/lib/auth/rateLimit.ts`。登入採**雙鍵**：來源位址 5 次/分鐘 **且** 目標帳號 email 5 次/15 分鐘，任一達上限即拒（即使密碼正確）；帳號鍵於該帳號成功登入後重置。註冊 3 次/小時/位址、評論留言 10 次/分鐘/使用者。門檻值皆可設定 |
| **身分敏感操作的限流（Phase 11／FEAT-3 新增）** | **改密碼**（`PASSWORD_CHANGE_RATE_MAX`，預設 5）與**開通作者**（`AUTHOR_UPGRADE_RATE_MAX`，預設 3）以**使用者識別碼**為鍵，時間窗沿用登入的既有窗。理由：改密碼會驗證舊密碼，不限流即等於一個**可繞過登入限流的密碼預言機** —— 持有有效工作階段者可無限次試錯舊密碼。**作品與章節的寫入入口不限流**（已受工作階段與擁有者守衛雙重保護），評論留言的限流仍屬 Phase 11 讀者部分（FEAT-4） |
| **未登入可達入口的限流（Phase 14／FEAT-5 新增，2026-08-09 裁示）** | **密碼重設申請**：位址鍵**沿用登入的 5 次/分鐘**（防的是枚舉掃描，與登入同性質，無須另訂），帳號鍵**另訂為 3 次/小時**（`PASSWORD_RESET_RATE_ACCOUNT_MAX`，預設 3）。**MUST NOT 沿用登入帳號鍵的 5 次/15 分鐘** —— 那等於允許對同一個受害信箱灌 20 封/小時；重設申請與登入性質不同：**登入失敗不會寄任何東西給受害者，重設申請會**。**聯絡表單**：3 次/小時/位址（`CONTACT_RATE_IP_MAX`，預設 3，比照註冊）。兩者的帳號鍵／位址鍵同樣**對不存在的帳號一律計數**且**限流判斷早於查 DB**，理由同本表上方兩列。門檻偏嚴，故測試 MUST 沿用 §10.5 既有的鍵值天然隔離，**MUST NOT 加任何可重置或停用限流的機制** |
| **計數語意（定案）** | 註冊與登入位址鍵 MUST 計入**所有送達的請求**（含 Zod 驗證失敗與 email 衝突者），且**限流判斷 MUST 早於 Zod 驗證**。否則攻擊者可用刻意的無效輸入免費探測，且「400 驗證錯誤 vs 409 衝突」的差異即成為 email 枚舉管道 —— 與下方帳號鍵同一理由。副作用：註冊門檻僅 3 次/小時，整合測試的每個註冊**案例**（非只是每個檔案）都需專屬 `X-Forwarded-For`，見 §10.3 |
| **帳號鍵不得洩漏帳號存在性** | 帳號鍵**對所有送入的 email 一律計數**，**限流判斷發生在查 DB 之前** —— 不存在的帳號第 6 次同樣回 429。若只對存在的帳號計數，`429` 與 `401` 的差異即成為帳號枚舉管道，`§7.6 帳號枚舉防護`形同虛設。鍵值存**正規化 email 的 sha256**，不存明碼。登入回應時間亦不得因「帳號不存在而略過密碼比對」明顯較快 |
| **限流計數的部署限制** | Phase 9 為**單一執行個體記憶體**實作，介面抽象保留（prod 可換 Redis，屬 Phase 13）。多執行個體／serverless 下各實例各持一份計數，輪流命中即可繞過 —— 因此**必須明示而非默許**：啟動記錄輸出 `rateLimitMode=single-instance`、`/api/health` 密鑰回應一併回報、README 將多執行個體部署標為**本階段未支援** |
| **限流狀態的測試隔離** | 限流計數在**測試伺服器行程的記憶體**中，§10.3 的逐表清空**還原不了它**。整合測試改以**鍵值天然隔離**：測試環境設 `TRUSTED_PROXY_HOPS=1`，每個測試檔送出**專屬的 `X-Forwarded-For` 位址**（位址鍵隔離）、每個測試用**獨立 email**（帳號鍵隔離）。**不得為測試在正式程式碼加任何可重置或停用限流的機制** —— 即使以環境變數保護，那仍是認證路徑旁的後門。附帶效益：§7.6「來源位址取得」在真實 HTTP 路徑上獲得驗證，而非只有單元測試 |
| **刻意觸發登入限流的案例（細則）** | 該類案例的 **5 次失敗嘗試 MUST 各用不同位址**。位址鍵門檻同為 5 次/分鐘，整案共用單一位址時第 6 次會先被**位址鍵**擋下 —— 得到的 429 無法證明帳號鍵生效，案例即失去意義（這也正是「換來源位址亦然」的驗證點）。同檔內的多個限流子案例（既有帳號／不存在帳號）MUST 各用一組互不重疊的位址與 email |
| **效能量測與限流的相容** | §10.6 的 p95 量測（30 次註冊 + 30 次登入）同受限流影響：註冊 3 次/小時、登入位址鍵 5 次/分鐘、帳號鍵 5 次/15 分鐘，共用位址時第 4 次起全被 429，而**被限流的請求不執行密碼雜湊**，量測值會失真且偏樂觀。量測 MUST 設 `TRUSTED_PROXY_HOPS=1` 並讓**每一次請求各用一個位址**，登入量測另用足量的不同帳號。**MUST NOT 為量測調高門檻或停用限流** |
| **來源位址取得** | 依 `TRUSTED_PROXY_HOPS` 自 `X-Forwarded-For` **右側往左**數第 N 個位址；未設或 0 只採直連位址。**不得無條件採信最左側值**（可偽造使限流失效），亦不得在代理後方退化為全站共用單一位址 |
| 帳號枚舉防護 | 登入／忘記密碼一律回相同訊息（並見上方「帳號鍵不得洩漏帳號存在性」） |
| **設定不足即失敗** | 關鍵密鑰缺漏一律拒絕啟動，不自動產生臨時值、不以預設值靜默降級（見 §3.5 啟動期驗證） |
| **安全事件記錄的呼叫點（第六輪定案）** | `lib/auth/audit.ts` 的 `logSecurityEvent` **必須在三處被實際呼叫**，缺一即該項未完成：(1) `authService.login` 失敗分支（密碼錯誤與帳號不存在**皆**記，且事件內容一致 —— 否則記錄本身就成了枚舉管道）`auth.login.failed`；(2) `login`／`register` 的任一限流鍵達上限而回 429 時 `auth.rate_limited`；(3) 已登入但角色不足而被轉離時 `authz.denied`（`proxy.ts` 守衛分支 + `guard.requireAuthor`）。**「有實作 + 有單元測試」不等於「有被呼叫」**：`§10.2` 的 `audit.ts` 單元測試在函式從未被接上正式路徑時**依然全綠**，這是本階段唯一無法由任何測試偵測的失效模式，故以 §10.6 的原始碼稽核逐一核對。攔截層的呼叫只發生在**已被擋下**的請求上，不影響 §7.1 的公開頁零成本 |
| **開放轉址防護** | 登入頁的 `?next=` **只接受站內路徑**；外部網址一律忽略並改用預設頁 |
| 未發佈資源 | 對非擁有者回 **404 而非 403**（不洩漏存在性） |
| 錯誤外洩 | `INTERNAL_ERROR` 一律不回堆疊；伺服器端記錄完整錯誤 |
| Session 管理 | 支援「登出所有裝置」；改密碼即撤銷該使用者全部 session。**清理**：Phase 9 於登入成功時順帶刪除該使用者自己已過期／已撤銷的列（不建排程、不碰請求熱路徑，清理失敗不得導致登入失敗）；全域排程清理待 Phase 12 cron 基礎設施就位後再加 |
| 日誌 | 認證失敗、越權嘗試、cron 執行皆記錄（不含密碼與 token 原文）。格式為**結構化事件輸出到 stdout**，固定四欄位：事件類型、發生時間、來源位址、結果；保留與轉送由部署平台負責，**不另建資料庫稽核表** |

---

## 8. nextstep.md 項目修正對照表

| 編號 | 原結論（2026-07-22） | **本次修正後結論** | 落點 | 里程碑 |
|------|----------------------|--------------------|------|--------|
| **H-1** | 認證全在前端，`/author/*` 無守衛 | 自建 session（jose + HTTP-only Cookie + `Session` 表）；三道防線：路由攔截 → layout `requireUser/requireAuthor` → service 授權；`ProfileGate` 移除 | `lib/auth/*`、`proxy.ts`、`app/{author,profile}/layout.tsx`、`hooks/useAuth.ts` | Phase 9 |
| **H-2** | 密碼明碼儲存與明碼展示 | `passwordHash` + argon2id；seed 建立 `reader`/`author`/`admin` 三帳號且密碼改環境變數；**移除登入頁示範帳密提示** | `prisma/base.prisma`、`lib/auth/password.ts`、`components/auth/LoginForm.tsx` | Phase 9 |
| **H-3** | 付費章節防護純屬裝飾 | **✅ 已移除 —— 平台全免費，架構中不存在付費牆**；連帶刪除 `Chapter.isFree`、Reader 鎖頭 UI、`/author/earn` 收益語意 | `prisma/base.prisma`、`ReaderView.tsx`、`types.ts`、`app/author/earn` | Phase 10 |
| **M-1** | `register()` 不檢查 Email 重複 | 註冊移至伺服器端：Zod → `findUserByEmail` → 409 `CONFLICT` 友善錯誤（不外拋 Prisma unique 例外） | `services/authService.ts`、`api/auth/register` | Phase 9 |
| **M-2** | Markdown 未淨化 | 統一 `<SafeMarkdown>` 元件（`rehype-sanitize`，禁 `rehype-raw`）+ 寫入端長度與控制字元過濾 + ESLint 禁止 import | `components/ui/SafeMarkdown.tsx`、`services/chapterService.ts` | **Phase 11（FEAT-3）** —— 自 Phase 13 前移：作者一開始寫，正文就已進 DB，淨化不能晚於寫入路徑開通 |
| **M-3** | 全域 Prisma 快取遺漏正式環境 | **修正**：singleton 不分環境一律掛 `globalThis`（長駐與 serverless 皆正確）；provider 由 `DATABASE_PROVIDER` 決定 | `src/lib/db.ts` | Phase 9 |
| **M-4** | `searchNovels` 全表載入記憶體過濾 | 改 DB 層搜尋 + `Novel.searchText` 預算欄位；**兩軌統一子字串比對**——SQLite 走 `LIKE`+索引，PostgreSQL 走 `ILIKE` + `pg_trgm` GIN（**不用 `tsvector`**，見 §3.4）；新增 typeahead、分類篩選與游標分頁 | `repositories/search.ts` | Phase 11（FEAT-3） |
| **M-5** | `openGraph.url` 寫死網址 | 改用 `SITE_URL`（`src/lib/siteConfig.ts`），與 `metadataBase` 一致 | `src/app/layout.tsx:21` | Phase 9（低成本先做） |
| **E-1** | 作者表無 owner 外鍵 | `Novel.authorId` FK → `User`；**repository 作者向查詢強制帶 `authorId` 條件**，service 另做 `requireOwner` | `prisma/base.prisma`、`repositories/novels.ts` | Phase 10 |
| **E-2** | SQLite 日期/陣列 workaround 技術債 | 日期改原生 `DateTime`；`tags`/`relatedIds` 改 join table（`NovelTag` / `NovelRelation`）；`splitCsv`/`joinCsv` 移除。**因雙軌需求，改用 join table 而非 PostgreSQL 專屬的 `String[]`** | `prisma/base.prisma`、`repositories/mappers.ts` | Phase 10 |
| **E-3** | repository 抽象層設計良好，值得保留 | **維持並強化**：新增 §2.2 分層鐵律 R1–R5，所有寫入亦走此層；新增 service 層承接業務規則與權限 | `lib/repositories/*`、`lib/services/*` | 全程 |
| **E-4** | inline theme script 需配 CSP nonce | **維持 nonce**（曾一度改為 CSP hash 以保留靜態化，後因框架自身逐頁注入內聯串流腳本、雜湊無法於建置期窮舉而**推翻**，見 §7.5）：nonce 由路由攔截層逐請求產生，theme script 與 `next/script` 共用；`script-src` 配 `'strict-dynamic'`，受影響頁面改動態產生 | `proxy.ts`/`middleware.ts`、`next.config.ts`、`app/layout.tsx` | Phase 9 |
| **E-5** | 缺乏 CSP / 安全性 HTTP 標頭 | `next.config.ts` 補 `headers()`：CSP（**強制模式，不採 Report-Only 過渡**）、HSTS、X-Frame-Options、X-Content-Type-Options、Referrer-Policy、Permissions-Policy | `next.config.ts` | Phase 9 |

### 本次新增項目（`nextstep.md` 未涵蓋，但「完整小說網站」必需）

| 編號 | 問題 | 解法 | 里程碑 |
|------|------|------|--------|
| **N-1** | **章節沒有正文**：`generateChapterParagraphs()` 依編號拼假段落，DB 無內容欄位 | 新增 `ChapterContent`（1:1 分表）；seed 改由 `prisma/seed-data/*.md` 匯入 | Phase 10 |
| **N-2** | `AuthorNovel` / `AuthorChapterDraft` 與公開資料脫鉤、欄位重複 | 兩表刪除，統一為 `Novel` + `Chapter` 的 `status` + `authorId` | Phase 10 |
| **N-3** ✅ **已完成（2026-08-07，FEAT-4 4-A）** | 書架／歷史／偏好只存 `localStorage`，換裝置即失 | `Bookshelf` / `ReadingHistory` / `ReadingProgress` / `ReaderPreference` 四表；**登入後在該瀏覽器仍有本機資料時**將其合併上傳，**成功後清除本機的書架與歷史兩鍵**（FEAT-4 裁示 2026-08-06：原文「首次載入時」若解讀為帳號層級，第二台裝置的訪客資料永遠上不了雲；2026-08-07 限縮清除對象——字級與主題兩鍵在登入態仍被回寫，見 §4.2 `Bookshelf` 註）。**合併規則分兩類**：書架取**聯集**（本機格式無時間戳）、歷史與進度取**時間較新者**；合併須冪等 | Phase 11 |
| **N-4** ✅ **已完成（2026-08-08，FEAT-4 4-B）** | `Review` 無 user 外鍵、無寫入路徑 | `Review.userId` FK + 一人一評唯一鍵 + 評論 CRUD API + `ReviewLike` + 章節 `Comment` | Phase 11 |
| **N-5** ✅ **已完成（2026-08-08，FEAT-4 4-D）** | 排行榜為靜態 seed，無計算來源 | `POST /api/cron/rankings` 由 `NovelDailyStat` 計分寫入，含名次升降比對 | Phase 12 |
| **N-6** ✅ **已完成（2026-08-08，FEAT-4 4-C）** | 作者儀表板數據為公式造假 | `ChapterView` 明細 + `NovelDailyStat` 每日彙總；`getAuthorDailyStats()` 刪除 | Phase 12 |
| **N-7** | **完全沒有測試框架**（`package.json` 無 test script） | Vitest（單元／整合）+ Playwright（E2E），詳見 §10。**✅ 起步完成（2026-07-24，FEAT-1）**：`npm run test`（單元 47 項）／`test:integration`（雙軌各 35 項）／`test:a11y`（15 項）皆已建立並綠燈；**Playwright 於 Phase 11（FEAT-3）導入並交付作者流一條**。**✅ 全數完成（2026-08-08，FEAT-4 4-D／T147～T157）**：其餘三條流程（讀者流、越權流、無障礙流）已交付，四條共 8 案全綠，讀者流另於 chromium／firefox／webkit 三引擎通過；單元 24 檔 369 案、整合**兩軌各 64 檔 554 案**、a11y 3 檔 39 案皆綠 | Phase 9 起逐步建立 |
| **N-8** ✅ **已完成（2026-08-08，FEAT-4 4-C）** | `/author/earn` 收益頁與「全免費」定位矛盾 | 改為「作品成效總覽」（曝光／完讀率／收藏轉換／留言熱度），移除金額換算 | Phase 12 |

---

## 9. 里程碑

> 接續 `plan.md` 的 Phase 0–8（UI 已完成）。每階段皆須通過「完成定義」方可進入下一階段。

### Phase 9 ─ 信任邊界與雙軌基礎建設（H-1 / H-2 / M-1 / M-3 / M-5 / E-4 / E-5 / N-7 起步）

> 對應 `features.md` 的 **FEAT-1**。**雙軌基礎建設必須早於本階段的 schema 變更** —— 否則 `Session` 表的 migration 只會落在 sqlite 目錄，日後得回頭補寫。

1. 安裝依賴：`jose`、`@node-rs/argon2`、`zod`、`vitest`、`@prisma/adapter-pg`、`pg`
2. **雙軌基礎建設**（model 定義不變）：`base.prisma` + `headers/` + `scripts/build-schema.ts`、`prisma.config.ts` 分軌、`migrations/{sqlite,postgres}` 分軌、`db.ts` 雙 adapter 與**不分環境的 `globalThis` singleton**、`docker-compose.yml` 本機 PostgreSQL、`/api/health`（密鑰分流）
3. `User` 加 `passwordHash` 與 `termsAcceptedAt`、**移除 `isAuthor`（身分只留單一 `role`）**、新增 `Session` 表（此階段先做最小 schema 變更）
4. `lib/auth/{sessionToken,session,password,guard,rateLimit,audit}.ts` + `lib/env.ts`（`validateEnv` 純函式 + 模組層啟動期驗證，缺 `SESSION_SECRET` 即拒絕啟動）；**`sessionToken.ts` 為憑證層，只相依 `jose` + `env`，是 `proxy.ts` 唯一可引用的 auth 模組**（見 §7.1），`session.ts` 經 repository 負責查詢／延展／撤銷，採滑動有效期 + 絕對上限 + 節流寫入，JWT payload 含 **`role` 快照**；rateLimit 採雙鍵、**對不存在的帳號一律計數**、依 `TRUSTED_PROXY_HOPS` 取來源位址，並標示 `rateLimitMode=single-instance`；`audit.ts` 的 `logSecurityEvent` **必須接上三個呼叫點**（登入失敗／限流拒絕／越權被擋，見 §7.6）
5. 註冊／登入／登出 Server Action + Route Handler（含 email 唯一性 → 409、`acceptTerms` 伺服器端驗證、登入時順帶清理該使用者過期／已撤銷 session）；伺服器端改密碼函式（不開端點、不做 UI）
6. 路由攔截檔（`proxy.ts`/`middleware.ts`）依 claim 的 `role` 判准入 + **逐請求產生 CSP nonce**；`author`/`profile` layout 伺服器端守衛**以 DB `User.role` 覆核**；移除 `ProfileGate`
7. `useAuth` 改讀 `SessionProvider`；移除 `MOCK_CREDENTIALS` 與登入頁示範帳密
8. `seed.ts` 建立 `reader`/`author`/`admin` 三個示範帳號（hash 寫入）
9. `layout.tsx` 的 `openGraph.url` 改 `SITE_URL`
10. **安全標頭 + CSP（強制模式，nonce + `'strict-dynamic'`）**（E-5 / E-4）—— 受影響頁面改動態產生，`script-src` 不得放寬
11. **密碼救援缺口的告知**：登入頁與註冊流程明示「本階段尚無密碼重設功能」，不放任何「忘記密碼」入口（見 §7.2）
12. **新增元素的無障礙三條**（憲章第 V 條，僅涵蓋本階段新增／修改的頁面）：停用控制項的「功能開發中」原因可被輔助技術讀出（非僅視覺樣式）；「示範資料」／「僅存本機」標示與其所述區塊有程式化關聯；表單錯誤（含條款未勾選）與對應欄位關聯並可讀出。以 `npm run test:a11y` 驗證零違規
13. **過渡標示三件套**：(a) 尚未接通寫入的控制項一律停用並標示「功能開發中」（個人設定儲存、建立作品、發佈章節、作品／章節編輯入口、**聯絡表單送出**），移除所有假成功提示；(b) 作者儀表板統計標示「示範資料，尚未接上真實統計」、**收益頁金額同樣標示**、作品列表標示「示範資料，作品擁有權尚未接上」；(c) 書架、閱讀歷史、閱讀偏好加註「目前僅保存在此瀏覽器，換裝置不會同步」（功能保留可用，不得因已登入而停用）。**收尾 MUST 為全站掃描**（見 §10.6），逐項清單必漏
14. Vitest 建置（**三個設定檔：單元／整合／a11y**，見 §10.1）+ 認證單元測試；整合測試基礎設施（獨立測試資料庫 + **globalSetup 內建結構套用與示範資料載入** + **正式建置產物起測試伺服器** + **清空認證域與角色 fixture 的輔助程式** + **限流鍵值天然隔離**）+ §10.3 案例 1–6、13、14、21、22 全數自動化

**完成定義**：未登入直接開 `/author/dashboard`，**伺服器端**即 302 到登入頁（檢視 HTML 回應本體，不得含後台內容）；DB 內查無明碼密碼；重複 email 註冊回 409；`DATABASE_PROVIDER` 兩種值皆能 `migrate` + `seed` + `build`，且兩軌各只有一個初始 migration；CSP 強制模式下主控台零違規且同頁兩次請求 nonce 不重複；未設 `SESSION_SECRET` 時啟動失敗並明確報錯；新增／修改頁面 a11y 檢查零違規。

### Phase 10 ─ 資料模型重構（H-3 移除 / E-1 / E-2 / M-4 / N-1 / N-2）

> 雙軌基礎建設（M-3、分軌產生器、`db.ts` 雙 adapter）已於 Phase 9 完成，本階段的 migration 天生產生兩份。

1. `prisma/base.prisma` 全新 schema（§4.2）
2. 兩軌 migration 各自產生並驗證（`migrations/{sqlite,postgres}`）
3. 型別相容性把關：不得使用 enum、純量陣列或單一 provider 專屬標註（§3.1）
4. `repositories/*` 重寫（新增 `chapters`、`users`、`sessions`、`search`、`stats`）；`mappers.ts` 移除 CSV
5. `prisma/seed-data/` 建立真實章節正文；`seed.ts` 重寫
6. 刪除 `Chapter.isFree` 與 Reader 鎖頭 UI；刪除 `AuthorNovel`/`AuthorChapterDraft`
7. 頁面層改讀新 repository（型別不變，改動應僅限 repository 內部）

**完成定義**：`DATABASE_PROVIDER=sqlite` 與 `=postgresql` 皆能 `migrate` + `seed` + `build` 成功；閱讀頁顯示的是 DB 內的真實正文；`grep -r --exclude-dir=migrations "isFree" src prisma` 無結果。

### Phase 11 ─ 寫入 API（作者流與讀者互動）

> **拆刀（2026-07-30）**：本 Phase 的**作者部分屬 FEAT-3**（第 1–3 項，另含 M-2、M-4 與自
> Phase 12／13 前移的三項），**讀者互動部分屬 FEAT-4**（第 4–6 項，N-3／N-4）。

1. `lib/services/*` 與 `lib/validation/*`
2. 作者 Server Actions：作品 CRUD、分卷（含刪除空卷）、章節建立／草稿／發佈／**下架**／卷內排序／刪除，
   並新增**作品管理頁 `/author/novels/{novelId}`** 作為其落點
3. `CreateNovelForm`、`ChapterEditor`、`AuthorWorkList`、`AccountSettingsView` 接真實 action（移除 `showToast` 假流程）
4. 讀者互動 API：書架、進度、歷史、偏好、評論、留言、按讚
5. `useBookshelf` / `useReadingHistory` / `useReaderPrefs` / **`useTheme`** 改為登入時走 API、未登入沿用 `localStorage`；登入後**若該瀏覽器的書架或歷史鍵仍有本機資料**即合併上傳（酬載含偏好與主題），成功後清除**書架與歷史兩鍵**（見 §4.2 `Bookshelf` 註）
6. 通知：發佈章節時對書架訂閱者產生 `Notification`

**自其他 Phase 前移至 FEAT-3 者**（理由皆為「不得晚於寫入路徑開通」）：
M-4 搜尋（原 Phase 10）、M-2 `<SafeMarkdown>` + ESLint（原 Phase 13 第 2 項）、
`sitemap.ts` 依 DB 動態產生（原 Phase 12 第 5 項）、Playwright 導入與作者流一條（原 Phase 13 第 4 項）。

**完成定義**：註冊新帳號 → 開通作者 → 建立作品 → 發佈章節 → 另一帳號可讀到、可加書架、可評論；
A 作者無法編輯 B 作者作品（**一律 404，不回 403**——見 §5.5 的 FEAT-3 補充）。

### Phase 12 ─ 統計與排行（N-5 / N-6 / N-8）

1. `ChapterView` 上報（Route Handler，含 `viewerHash` 去重窗口）—— 傳輸為
   `fetch(..., { keepalive: true })`，**MUST NOT 用 `sendBeacon`**（同 §5.4 `PUT /api/reading-progress`
   的 FEAT-4 裁示；本行的舊寫法為 2026-08-07 補正的漏網處）
2. `POST /api/cron/rollup-stats`、`/api/cron/rankings`、`/api/cron/publish-scheduled`
3. 作者儀表板改讀真實統計（Server Component 直讀 `statsService`，**不開 Route Handler**）；
   刪除 `getAuthorDailyStats()`
4. `/author/earn` 改為「作品成效總覽」
5. ~~`sitemap.ts` 改為依 DB 動態產生~~ → **已前移至 Phase 11（FEAT-3）**：FEAT-3 是第一個會產生
   草稿作品的階段，網站地圖若仍為靜態，上線點當天就會把草稿作品送進搜尋引擎

**FEAT-4 裁示（2026-07-31）**：`NovelDailyStat` 三個計數為**當日新增量**、日界線為 **Asia/Taipei 00:00**（見 §4.2 該 model）；
三個 cron 另交付**版控的觸發指令**，不繫結雲端廠商（見 §5.7）。

**完成定義**：未設 `VIEW_HASH_SECRET` 時啟動失敗並明確報錯；閱讀章節後 `ChapterView` 有記錄，且同一匿名讀者**跨日的 `viewerHash` 恆為同值**；執行 cron 後 `RankingEntry` 的 `computedAt` 更新且名次與計分一致；儀表板數字可由 DB 反推；同一日期的彙總**重複執行結果完全相同**（冪等），且**尚未結束的當日無 `NovelDailyStat` 列**；成效總覽四項指標的期間為近 7 日並於畫面標示。

**執行紀錄（2026-08-08，FEAT-4 4-C／T094～T112）**：上列第 1、3、4 項與第 2 項的
`rollup-stats` 一支**已完成**（`rankings`／`publish-scheduled` 兩支屬 4-D）。
交付內容：`lib/time/taipeiDay.ts`、`lib/stats/viewerHash.ts`、`ChapterView`／`NovelDailyStat`
兩個 model 與兩軌 `4c_analytics` migration、`repositories/stats.ts`（**本階段唯一**發出原生 SQL 之處）、
`repositories/novels.ts` 的回填與全量校正、`services/statsService.ts`、
`POST /api/chapters/{id}/view`、`POST /api/cron/rollup-stats`、
儀表板與成效頁改讀真實資料、`lib/content.ts` **整檔刪除**（N-6 的最後一支造假來源）、
seed 六個計數歸零且不再寫入任何互動與統計資料。
三道綠燈閘門全過（build／lint／tsc），單元 336、整合 480、a11y 29 全綠。
PostgreSQL 軌的 `4c_analytics` 以 `prisma migrate diff` 產生（與 SQLite 軌同名同內容、兩軌對稱）。
原文「本機 Docker 服務未啟動故未實際 apply」**已失效並取代**——
**2026-08-08 補驗**：已啟動本機 Docker（`postgres:17-alpine`），三支 postgres migration
（`4a_reader_state`／`4b_interaction`／`4c_analytics`）對 `novelsite_test` 實際 `migrate deploy` **全部成功**，
PostgreSQL 軌整合測試 **58 檔 480 案全綠**（與 SQLite 軌同檔同案數）。**本機容器不是正式環境**，
R-18 的「正式環境 PostgreSQL 部署驗證」仍未勾銷。

### Phase 13 ─ 強化與上線（M-2 / N-7 完成）

> 安全標頭與 CSP（E-4 / E-5）已於 Phase 9 以強制模式上線，本階段只需隨新增功能維護政策。

1. 新增功能的 CSP 相容性回歸（政策不得放寬）
2. ~~`<SafeMarkdown>` 統一元件 + ESLint 禁 `rehype-raw`~~ → **已前移至 Phase 11（FEAT-3）**：
   作者一開始寫，未淨化的正文就已進 DB，淨化不能晚於寫入路徑開通（見 §8 的 M-2 列）
3. 評論／留言速率限制上線
4. Playwright E2E **其餘三條流程**（讀者流、越權流、無障礙）+ 雙軌整合測試全綠 ——
   **框架導入與作者流一條已於 Phase 11（FEAT-3）完成**
5. Lighthouse **本機無頭瀏覽器實測**並記錄四項分數（無障礙 ≥ 95）；跨瀏覽器以自動化測試在**三種瀏覽器引擎**跑讀者流。
   **前置安裝**：`npx playwright install firefox webkit`（一次性二進位下載）。**此項為前置步驟、MUST NOT 列為「待外部條件」**（FEAT-4 裁示 2026-08-07）——
   本 Phase 第 5 項要求讀者流在三引擎**通過**，而待外部條件的定義（憲章第 IV 條）是「MUST NOT 標記為已完成」，
   同一件事不可能既是必須通過的驗收又是不必完成的外部條件。分類判準為**能否於本機自動完成**：實體裝置與正式環境不能，二進位下載能
6. ⏸ **待外部條件（FEAT-4 裁示，MUST NOT 標記為已完成）共三項**：真實行動裝置實機測試、**正式環境的 PostgreSQL 部署驗證**、**部署平台的排程設定**。
   第二項的結構與索引正確性已由 §10.5 的雙軌整合測試涵蓋（2026-07-31 於 Docker 實際套用並驗證；
   **2026-08-08 補驗 FEAT-4 的三支 migration**：`4a_reader_state`／`4b_interaction`／`4c_analytics` 於本機 Docker 的
   `postgres:17-alpine` 實際 `migrate deploy` 成功，PostgreSQL 軌整合測試 58 檔 480 案全綠，
   兩軌最終結構逐項比對一致 —— 21 張表、29 個外鍵，SQLite 的 46 個具名索引全數見於 PostgreSQL，
   PostgreSQL 另有 22 個 `*_pkey`（SQLite 主鍵走 rowid，不列於 `sqlite_master`）與手寫的 `Novel_searchText_trgm_idx`），
   本階段延續該驗收方式；「正式環境部署」本身需外部條件，依憲章第 IV 條 MUST 於文件標記為待外部條件 ——
   **本機容器不等於正式環境，本次補驗 MUST NOT 用來勾銷本項**。
   第三項為 2026-08-07 補入：三個排程作業交付的是受密鑰保護的入口與版控觸發指令，
   **接上哪一個平台的排程屬部署階段工作**（spec Clarifications 明文不繫結雲端廠商），本階段無從驗證。
   **2026-08-08 補記**：第二、三項的**作法**已定案並寫入 `deploy/deployment.md`（2026-09-06 自 `novelsite/` 移入）
   （Oracle Cloud 單機 + 同機 PostgreSQL + 系統 crontab），
   但**兩項 MUST 維持未勾銷** —— 定案的是計畫，待外部條件要的是**實際部署完成並驗證**，
   兩者不可混為一談（憲章第 IV 條）。有了文件就打勾，正是本節第 5 點極力區分的那種錯誤

**完成定義**：CSP 生效且主題腳本未被擋；`npm run build` / `lint` / `tsc --noEmit` / `test` / `test:e2e` 全綠；兩種 provider 的整合測試皆通過；待外部條件的**三項**已於 README 明列且未被打勾
（2026-08-07 自兩項改為三項，見上方第 6 點；`playwright install` 不在其中，它是第 5 項的前置步驟）。

**執行紀錄（2026-08-08，FEAT-4 4-D／T147～T162）**：第 1、3、4、5 項**已完成**，第 6 項依規定**維持未勾銷**。

- **第 4 項（E2E 其餘三條流程 + 雙軌整合測試）**：新增 `tests/e2e/reader-flow.spec.ts`、
  `privilege-flow.spec.ts`、`a11y-flow.spec.ts`（`author-flow` 為 FEAT-3 既有），
  四條流程共 **8 個測試案例全綠**。雙軌整合測試各跑一輪，**兩軌皆 64 檔 554 案、結果完全一致**（SC-014）。
- **第 5 項（Lighthouse 與跨引擎）**：對正式建置產物實測，首頁與閱讀頁的無障礙分數皆 **96（≥ 95）**，
  四項分數與未達滿分的成因已寫入 `README.md`。讀者流於 **chromium／firefox／webkit 三引擎全數通過**。
- **兩項新增的設定與工具面裁示**（皆已回寫至上游對應處）：
  1. `SESSION_COOKIE_SECURE`（見 §3.5 該列）—— WebKit 於 `http://localhost` 丟棄 `Secure` Cookie，
     不提供這個開關，FR-059 的三引擎驗收在 webkit 上不可能通過。
  2. `playwright.config.ts` 逐 project 指定 `X-Forwarded-For`（`.env.test` 的 `TRUSTED_PROXY_HOPS=1`）——
     三個 project 共用同一台伺服器與同一份記憶體限流表，不分桶時第三個引擎的註冊會撞上
     `REGISTER_RATE_IP_MAX`（預設 3），且失敗訊息會指向註冊表單而非限流。
     此作法與 §10.5「限流狀態的測試隔離」既有的鍵值天然隔離同源，**未在正式程式碼加任何可重置或停用限流的機制**。
- **交付前的全站掃描**：`tests/unit/feat4-scan.test.ts`（造假來源識別字、已失效的文案主張、
  假成功提示三類掃全站；硬編色碼與亂數元件 id 只掃本階段檔案並以既有基線比對）與
  `tests/unit/layering.test.ts` 的 T152 擴充（本階段新增的服務／資料存取／Route Handler／頁面
  全數納入分層稽核）。
- **原文「原生 SQL 只出現於 `repositories/stats.ts`」已取代**：`repositories/health.ts`（FEAT-1 的
  `SELECT 1` 存活探測）與 `repositories/search.ts`（FEAT-3 的雙軌全文檢索，見 §3.4）各有一處，
  兩者皆早於本階段且都不該被本階段刪掉。**實際守的規則是**：原生 SQL MUST 全數落在
  `lib/repositories/**` 之內，且其中只限這三支具名檔案 —— 照原文寫的測試從第一天就是紅的，
  而一開始就紅的測試最後一定是被放寬而不是被修好。
- **FR-064 的稽核落點自「本階段修改過的檔案」收斂為「本階段新增的行」**：實測顯示
  `AuthorDashboardView.tsx`、`RankingWidget.module.css`、`RankingPageView.module.css` 等
  三個檔案本階段只因**資料來源**改動而被碰過，其中的色碼一行都不是本次新增。
  以檔案為單位會逼人去改一票與本需求無關的既有樣式（憲章「變更範圍」明文禁止），
  故掃描改以**既有基線的命中次數**比對：多出任何一處即紅燈，既有的一處都不必改。
  既有基線已於 `README.md`「已知基線」一節誠實列出。

### Phase 14 ─ 郵件基礎設施、密碼救援與聯絡管道（GitHub issue #5 / #6）

> 對應 `features.md` 的 **FEAT-5**，規格見 `specs/005-email-recovery-contact/`。
>
> **為何新增本 Phase（2026-08-09 裁示）**：§7.2 與 §8 原本兩處都寫「郵件基礎設施就位（Phase 13）後解除」，
> 但 **Phase 13 的項目清單自始沒有任何郵件相關項目**，且該 Phase 已於 2026-08-08 記錄執行完畢。
> 原文照字面執行等於指向一個不存在的工作項 —— 兩個 issue 會永遠等在一個已經走完的階段後面。
> 故把郵件基礎設施自 Phase 13 移出，另立本 Phase 承接，§7.2 與 §8 的兩處指涉一併改寫。
>
> **為何兩個 issue 合為一個 Phase**：兩者的解除條件是**同一句話**（郵件基礎設施就位）。
> 分開做會把寄送能力、寄件網域設定與濫用防護各做一次，且先做的必須替後做的預留介面。

1. 寄送能力：薄介面（`Mailer`）隔開廠商 API（理由同 `RateLimitStore`／FR-050 —— 整合測試會實際啟動伺服器打真實 HTTP，
   **沒有可替換的實作就會在每次測試時真的往外寄信**），憑證與寄件位址一律由設定提供，
   **MUST NOT 進入版控的 `.env.test`**。
   **廠商 SDK MUST NOT 引入，Resend 一律以 `fetch` 直呼其 HTTPS API**（FEAT-5 plan 裁示，2026-08-09）：
   原文寫的是「隔開廠商 **SDK**」，而該原文要保護的兩件事（測試不得真的寄信、可抽換廠商）
   由 `Mailer` 介面本身完整達成，與是否引入 SDK 無關；`resend` 套件對本專案的用途只是包一個
   `POST /emails`，多一個要跟著升級的相依卻不減少任何一行我們要寫的程式碼
   （同 FEAT-4「本階段不新增任何執行期依賴」的既有慣例）。`deploy/deployment.md` §8 已同步。
   **實作數量與未設定時的行為（FEAT-5 Clarifications 2026-08-09）**：MUST 有**三種**實作 ——
   正式（實際寄送）／測試（收集寄件內容，供斷言收件人、主旨與連結）／開發（含重設連結輸出至伺服器主控台）。
   「測試要能斷言收到什麼」與「開發者要看得到重設連結」是兩種需求，合併為單一實作必使一方將就。
   **測試實作的收集位置 MUST 為 JSON Lines 落地檔（`MAIL_OUTBOX_PATH`，預設 `process.cwd()`／`.mail-outbox.jsonl`
   —— 工作目錄一律是應用根 `novelsite/`，非 repo 根；`novelsite/.gitignore` 的 `/.mail-outbox.jsonl`
   開頭的 `/` 錨定該目錄，基準取成 repo 根會使落地檔逃過忽略而被版控追蹤。
   原文寫 `<repo>/…` 語意含混，已於 `/speckit-analyze` 第二輪 2026-08-09 取代），
   MUST NOT 只存記憶體**（FEAT-5 plan 裁示，2026-08-09，取代原文的「記憶體收集」）：
   原文預設測試與伺服器同行程，但 §10.3 的整合測試與 a11y 測試都以 `next build` + `next start`
   啟**另一個行程**再打 HTTP —— 伺服器行程內的記憶體陣列在測試行程裡**永遠是空的**，
   而需要斷言收件人／主旨／連結的恰恰是這兩套（重設密碼頁的 a11y 稽核也需要一把真的憑證才進得去）。
   「不對外送信」與「可斷言內容」兩個保護目標不變，改變的只有收集位置；`.gitignore` MUST 收錄該檔。
   **選用依據 MUST 為顯式設定 `MAIL_MODE`（`production`｜`memory`｜`console`），MUST NOT 只依環境推導**
   （FEAT-5 Clarifications 2026-08-09）：§10.3 的整合測試以**正式建置產物**啟動測試伺服器，
   該伺服器的 `NODE_ENV` 是 `production`，若靠環境推導就會撞上下一句的「拒絕啟動」而**根本起不來**，
   且症狀是「環境變數驗證失敗」而非測試斷言失敗（`.env.test` 的 `VIEW_HASH_SECRET` 註解記載過同一個坑）。
   `.env.test` MUST 宣告 `MAIL_MODE=memory`，該模式 MUST NOT 要求任何憑證。
   `MAIL_MODE` 未明示時才依環境推導：**正式環境 MUST 拒絕啟動**（比照 `SESSION_SECRET`／`VIEW_HASH_SECRET`）、
   **開發環境 MUST 自動採用開發實作並於啟動記錄警示**。
   **MUST NOT 一律停用入口** —— 那會使本機永遠走不到「設定新密碼」頁，
   而該頁的 a11y 檢查與「全程自助復原」的驗證都在本機執行。
   **`MAIL_MODE=production` 時，`NEXT_PUBLIC_SITE_URL` 未明示 MUST 拒絕啟動**
   （FEAT-5 Clarifications 2026-08-09）：該值原有的靜默回落（`https://novelsite.tw`）
   對 metadata／sitemap 只是標註不準，但重設連結是絕對網址 ——
   **填錯等於每一封信裡的連結都指向別的網站，而系統仍回報「已寄出」**。
   本 Phase 把它從軟性預設變成硬性正確性需求。其餘 `MAIL_MODE` 維持既有回落，不影響開發與測試啟動；
   **MUST NOT 為郵件連結另立獨立的網址設定**（會多一個與站台網址不一致的值）
2. 密碼重設憑證的 schema（單次可用、有時效、**雜湊入庫**、同一使用者至多一筆有效）——
   欄位層級定義於 `/speckit-plan` 落到 §4.2，屆時本列以該處為準。
   **過期與已用畢列的清理沿用 §7.4 Session 的既有模式**（FEAT-5 Clarifications 2026-08-09）：
   於該使用者**下次申請重設時順帶刪除**，清理失敗 MUST NOT 導致申請失敗。
   **MUST NOT 為此新增第四個 `/api/cron/*` 入口** —— 那會使 README「部署平台排程設定」的待外部條件再多一項，
   而這張表的成長來源只有「有人申請重設」，量級遠低於 Session 表
3. 重設申請與重設執行兩個入口：申請端沿用既有雙鍵限流（**帳號鍵對不存在的帳號一律計數**、
   **限流判斷早於查 DB**，門檻見 §7.6 該列），回應 **MUST NOT 洩漏 Email 是否存在**；
   重設成功 MUST 撤銷該使用者當時全部 session（比照 §7.4 改密碼）。
   **寄送 MUST 於回應送出之後進行，MUST NOT 在請求生命週期內同步等待寄送結果**
   （FEAT-5 Clarifications 2026-08-09）：不存在的帳號會跳過「產生憑證 + 寄信」兩步，
   而寄信是一次對外 HTTPS 呼叫（數百毫秒），**同步寄送下兩者的時間差是結構性的且遠大於雜訊** ——
   「回應時間不得洩漏帳號存在性」在同步寄送下不可能成立。
   以「回應前不做任何寄送」結構性消除該差異，**MUST NOT 改用補假延遲對齊**（基準值會隨網路與服務商狀況漂移）。
   附帶效益：「郵件服務暫時不可用時回應維持不變」自動成立。背景寄送失敗 MUST 留記錄且 MUST NOT 使行程異常終止。
   **實作前 MUST 依 `AGENTS.md` 查證 `node_modules/next/dist/docs/` 中「回應後續行工作」的機制與其存活保證**，
   並以可重複的方式驗證該工作確實被執行 —— 整個安全論證都建立在「寄送真的發生在回應之後」上，
   該機制若不成立，結果是**重設信根本不會寄出**，而使用者看到的仍是那句一律相同的成功訊息。
   **查證結果（FEAT-5 plan／research R-1，2026-08-09）**：機制為 `after()`（`import { after } from 'next/server'`），
   出處 `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md` ——
   `v15.1.0` 起穩定（本專案 Next 16.2.10）、可用於 Route Handler、
   平台支援表列 **Node.js server 與 Docker 為 fully supported**（static export 不支援、serverless 需自行注入 `waitUntil`，
   兩者皆非本站部署形態）；`.../02-guides/self-hosting.md` §`after` 另載明 `next start` 於
   `SIGINT`／`SIGTERM` 的 graceful shutdown 會先跑完 pending callback。
   **驗證方式 MUST 為兩道而非一道，且需要 `MAIL_MEMORY_DELAY_MS`（新增設定，預設 0，`.env.test` 設 300）**
   （FEAT-5 plan 裁示，2026-08-09）：(a)「確實被執行」—— 輪詢 outbox 直到該封信出現，逾時即失敗；
   (b)「確實在回應之後」—— 對已註冊與未註冊 Email 各送一次申請並比對回應時間差。
   **沒有 (b) 的人工延遲，這道測試沒有鑑別力**：兩條路徑的天然時間差只有數毫秒，
   測不出「`after()` 生效」與「`after()` 沒生效但這次剛好很快」的差別；有了 300ms 的延遲，
   同步寄送必然使已註冊那一次多花 ≥300ms，斷言差值 < 200ms 即可證偽
4. **登入頁加上「忘記密碼」入口** —— §7.2 的「不得放任何忘記密碼入口」禁令於本階段解除（理由見該列）
5. 聯絡表單接上寄送並解除送出控制項停用；未登入可用，故 MUST 有速率限制與最小限度濫用防護。
   **濫用防護的隱藏誘餌欄位（honeypot）命中時 MUST 回 400，MUST NOT 回假成功的 200**
   （FEAT-5 plan 裁示，2026-08-09）：常見做法是回 200 騙機器人，但那正是本文件 §8 與
   `feat4-scan` 甲-3 明文禁止的**假成功**，且會在站上留下一個「回報成功但什麼也沒做」的分支，
   往後每個讀到它的人都得重新判斷那是不是 bug。誠實回應不影響任何真實使用者 ——
   該欄位對人不可見、不會被鍵盤走訪（`tabIndex={-1}`）、不會被自動填入（`autoComplete="off"`）。
   **本刀的寄送與第 3 項刻意相反：同步 `await`，失敗回 502 `MAIL_FAILED`** ——
   這裡沒有帳號存在性可洩漏，而使用者必須知道訊息到底出去了沒有。
   **「寄送失敗」這條分支的驗收 MUST 有可觸發的手段**（FEAT-5 plan 裁示，2026-08-09）：
   測試實作於**收件人 `to` 或回覆位址 `replyTo`** 等於 `fail@outbox.invalid` 時擲寄送錯誤。
   **判定擴及 `replyTo` 為 FEAT-5 T046 交付時裁示（2026-08-10），取代原文的「收件人等於」**：
   照原文的字面，**聯絡表單的失敗分支永遠觸發不到** —— 該封信的收件人一律是 `CONTACT_EMAIL`
   （FR-019：表單填入的 Email 只作回覆位址），測試無從把收件人換成保留位址；
   而把 `CONTACT_EMAIL` 整個設成保留位址會使「送出成功」那一案連一封信都收不到。
   於是「不得假成功」在**唯一會分別回報成功與失敗的那支表單上**沒有把關手段，
   而那正是本機制存在的全部理由。擴及 `replyTo` 不放寬任何門檻：`.invalid` 仍是保留 TLD，
   且密碼重設信不帶 `replyTo`，不受影響。
   **這不是測試後門** —— 它不繞過任何檢查、不改變任何門檻、不影響其他收件人，
   且 `.invalid` 是 RFC 2606 保留 TLD，永遠不會是真實信箱；
   沒有它就**無法驗證「不得假成功」這條規則本身**，而那正是 §8 誠實標示在本刀的全部內容。
   本機制 MUST 僅存在於測試實作（`MAIL_MODE=memory`），**MUST NOT** 出現在正式實作中
6. **對外聯絡信箱位址由設定決定**，營運者更換 MUST NOT 需要改原始碼；
   未設定時回落至過渡預設值並於啟動記錄標示。隱私權頁的個資權利行使段落 MUST 直接列出可實際收信的位址 ——
   該處是**法遵**管道而非一般功能入口，不得只給一個指向表單的連結。
   **`src/app/privacy/page.tsx` MUST 標 `export const dynamic = 'force-dynamic'`**
   （FEAT-5 T041 交付時裁示，2026-08-10）：驗收條件的字面是「**僅需變更設定並重啟服務**」，
   **不含重新建置**。該頁在此之前是純靜態頁，會被建置期預渲染而把位址**烤進 HTML** ——
   營運者換了信箱、重啟服務，頁面上仍是建置當下的舊位址，而**畫面看起來完全正常**，
   只有寄到舊位址的個資權利行使請求沒有人收得到。成本是該頁改為逐請求渲染（無資料查詢）；
   `sitemap.ts` 因同一類理由（不得凍結在建置當下）已有先例。
   **`src/app/contact/page.tsx` 同樣 MUST 標**（T053 交付時裁示，2026-08-10）：
   它把同一個位址下傳給表單，供**寄送失敗時**的替代管道提示使用（FR-021）——
   而那個提示只在寄送已經失敗時才出現，是最不該再給出一個舊信箱的地方
7. 誠實標示收尾：移除「本階段尚無密碼重設功能」與「功能開發中，尚無法送出訊息」兩類已失效主張，
   修正 `README.md` 已知限制的兩列（含「改密碼函式不對外開放」該句 —— 自 FEAT-3 起已不成立），
   並擴充既有的全站掃描測試防止回歸
7a. **`README.md` 已知限制 MUST 新增一列：註冊 Email 未經驗證所遺留的帳號接管風險**
   （FEAT-5 Clarifications 2026-08-09）。若使用者註冊時把 Email 填成**他人真實可用的位址**，
   本 Phase 交付後該位址的**擁有者**即可經重設流程接管該帳號。
   **這是本 Phase 把一個原本無法利用的條件變成可利用的路徑**（在此之前站上沒有重設信），
   該列 MUST 如此載明，**MUST NOT 以「既有問題」帶過**。
   仍不納入 Email 驗證的理由：**該結果方向正確** —— 帳號本就該由信箱擁有者控制，
   填錯位址是使用者自招，且那個帳號從來收不到站上任何通知；納入驗證會外溢到註冊流程與既有帳號的回溯補驗。
   一併排除「首次成功使用重設連結即視為已驗證」的折衷 —— 該標記在本 Phase 內沒有任何消費者
8. ⏸ **待外部條件（MUST NOT 標記為已完成）**：可用的郵件服務帳號、寄件網域，
   以及該網域的 **SPF／DKIM／DMARC 三筆 DNS 記錄**。
   **第三項是本 Phase 最容易被誤判為完成的一項** —— 缺了它，系統會回報「已寄出」而使用者收不到信，
   「寄送成功」的驗收於是表面通過、實際失效。**驗收 MUST NOT 以「系統回報成功」充當送達。**
9. **收尾紀錄的回寫對象共三份**（`/speckit-analyze` 第三輪補入，2026-08-09）：本節、`features.md`
   FEAT-5「完成定義」，**以及 `novelsite/plan.md` 的 Phase 14 里程碑列**。
   **第三份源自憲章**（`.specify/memory/constitution.md`「開發流程與品質閘門」）：該條明列
   `novelsite/plan.md` 與 `novelsite/nextstep.md` 為現行工作事實來源，
   **完成項目 MUST 更新勾選狀態與執行紀錄（含日期）**。
   先前 `specs/005-email-recovery-contact/tasks.md` 的收尾任務只寫本檔與 `features.md`，
   而 `novelsite/plan.md` 的 Phase 進度表停在 **Phase 13（2026-08-08）** ——
   FEAT-4 當時三份都寫了（`plan.md` Phase 13 ✅ 與 `nextstep.md` 收尾紀錄），
   照原文執行會留下一份停在上一階段的里程碑表。
   **`nextstep.md` 不新增勾選項**：該檔追蹤的是 H-1～H-3／M-1～M-5／E-1～E-5，
   **無任何一項對應本 Phase**，故只在該檔補一段「與 FEAT-5 的關係」載明此事，
   MUST NOT 在該檔另立一份會漂移的副本。

**完成定義**：忘記密碼者可全程自助完成「申請 → 收信 → 設新密碼 → 以新密碼登入」，不需人工介入；
對已註冊與未註冊 Email 的重設申請，回應完全一致且無法據回應時間差區分；重設連結用過一次或逾期後 100% 不可再用；
重設成功後其他裝置的既有登入立即失效；聯絡表單送出成功者訊息確實送達營運信箱、失敗者顯示失敗而非成功；
更換聯絡信箱不需改任何一行原始碼；全站與 `README.md` 零筆殘留的已失效主張且有掃描把關；
在寄送能力未設定的環境跑完整測試，零封郵件被送往外部。

**執行紀錄（2026-08-11，FEAT-5 T001～T065）**：第 1～7、7a 項**已完成**，
第 8 項（待外部條件）依規定**維持未勾銷**，第 9 項（收尾紀錄三份）即本段與
`features.md` FEAT-5「完成定義」、`novelsite/plan.md` Phase 14 里程碑列。

- **閘門**：`npm run build`／`npm run lint`／`npx tsc --noEmit` 三綠燈；
  單元 29 檔 440 案、整合 76 檔 602 案、a11y 3 檔 42 案、E2E 8 案全過。
- **雙軌（§10.5）**：`DATABASE_PROVIDER=postgresql npm run test:integration`
  **76 檔 602 案，與 SQLite 軌逐項一致**。本輪是 T024 手寫的 PostgreSQL
  `20260810064412_5b_password_reset` **第一次被實際執行** —— 產生它的當下本機既無 PostgreSQL
  亦無 Docker，只能依 `4d_ranking_scheduling` 兩軌的體例手寫（`prisma validate` 只看 schema、
  不看 migration SQL，故在此之前它沒有任何把關）。本輪以免安裝版 PostgreSQL 17.6 起一個
  本機執行個體套用全部 11 支 migration，`PasswordResetToken` 的六欄、`_pkey`、
  `tokenHash` 唯一索引、`userId`／`expiresAt` 兩個索引與 `ON DELETE CASCADE` 外鍵
  皆與 SQLite 軌對稱。**這仍不勾銷 Phase 13 第 6 項的「正式環境 PostgreSQL 部署驗證」**
  —— 本機執行個體不等於正式環境，理由同該項 2026-08-08 的補記。
- **零封外寄（第 1 項的驗收）**：四套測試的郵件設定皆來自 `.env.test` 的 `MAIL_MODE=memory`
  （E2E 的 `playwright.config.ts` 經 `loadTestEnv()` 取同一份），全程 `mail.send` 記錄一律
  `mode=memory`，`resendMailer` 的 `api.resend.com` 端點未被觸及。
- **第 7 項的掃描把關**：`tests/unit/feat4-scan.test.ts` 甲-2 加入 `尚無密碼重設功能`
  與 `尚無法送出訊息`（掃 `src/**`），並新增**甲-2b 只掃 `README.md`** 的獨立清單。
  **兩份清單 MUST NOT 合併**：甲-2 既有的 `僅保存在此瀏覽器` 現在就寫在 `README.md` 裡
  （FEAT-4 的已解除列引用了原文），併入會在動任何程式碼之前就先紅，而唯一的轉綠方式是刪掉 FEAT-4 的紀錄。
- **本機開發用的 `novelsite/.env` 於本輪補齊必填項**（未版控，非交付產物）：該檔在 T003 建立時
  只寫了 `MAIL_MODE`／`CONTACT_EMAIL` 兩個郵件值，缺 `DATABASE_URL`／`SESSION_SECRET`／
  `VIEW_HASH_SECRET` 三項，`npm run build` 因此以「環境變數驗證失敗：缺少 SESSION_SECRET」中止 ——
  **那是 FR-049 的預期行為而非缺陷**（README「環境變數」已載明建置需要這些值）。
- **未達成而刻意不勾的兩項驗收**：聯絡表單的「訊息**確實送達**營運信箱」與隱私權頁位址的
  「經外部信箱實測寄達」（tasks T043(b)）。兩者的驗收對象都是**送達**，
  而送達需要第 8 項的三個外部條件；以 outbox 或畫面提示充當送達，正是第 8 項明文禁止的事。

### Phase 15 ─ 正式上線就緒：資料防呆、子路徑相容、容器化與自動部署（GitHub issue #7 / #8 / #9）

> 對應 `features.md` 的 **FEAT-6**，規格見 `specs/006-production-launch-readiness/`。
>
> **為何新增本 Phase（FEAT-6 裁示，2026-08-13）**：Phase 13「強化與上線」的項目清單
> **自始不含容器化、CI/CD 與路徑前綴相容**，且該 Phase 已於 2026-08-08 記錄執行完畢。
> 三個 issue 若照字面掛在「上線」名下，等於掛在一個已經走完的階段後面 ——
> 與 Phase 14 新增時完全相同的問題。故另立本 Phase 承接。
>
> **為何三個 issue 合為一個 Phase**：它們互為前提。#9（子路徑）**擋在 #8 之前** ——
> 未完成則映像建置出來也只能掛在網域根目錄；#8 的容器啟動流程承接 #7 的參考資料建立；
> #7 的資料防呆 MUST 先於首次接上正式資料庫。

1. **6-A 正式環境資料安全（#7）**：放行守衛，判定實作於 **`prisma/seedGuard.ts`**、
   由 `prisma/seed.ts` 在**任何 prisma 呼叫之前**呼叫
   （**allowlist**：只在 `DATABASE_PROVIDER=sqlite`（未設定時視同 `sqlite`，同
   `src/lib/env.ts:137` 的回落）且非 production，或給了
   `SEED_ALLOW_DESTRUCTIVE=1` 時才執行）；新增 `npm run db:clear-content`
   （先印 23 張表的列數 → 非互動一律拒絕 → 互動輸入資料庫名稱確認 → 單一交易清除 21 張，
   **`Category` 與 `Tag` 保留**）；空資料庫的四頁整合測試。
   **判定 MUST NOT 只看 `NODE_ENV`** —— 正式主機上一個手開的殼層，`NODE_ENV` 是空的。
   > **為何判定不寫在 `seed.ts` 內**（FEAT-6 T007 實作裁示，2026-08-14）：
   > 原文寫「`prisma/seed.ts` 加放行守衛」，照字面實作**會讓守衛的單元測試自己變成一次
   > 破壞性操作**——`seed.ts` 的模組尾端就會執行 `main()`，`tests/unit/seed-guard.test.ts`
   > 一 import 它就開始清空並重建測試資料庫。故判定與訊息移入零副作用的
   > `prisma/seedGuard.ts`（不 import prisma、不讀 `.env`），`seed.ts` 於**任何 prisma
   > 呼叫之前**呼叫 `assertSeedAllowed(process.env)`，「MUST 在 `clearAll()` 之前」不變。
   > 同一輪一併裁示：**`DATABASE_PROVIDER` 未設定時視同 `sqlite`**——本專案的 `.env`
   > 依慣例不寫這一項（`src/lib/env.ts:137` 的回落值即為 `sqlite`），改判為
   > 「證明不了即拒絕」會擋下每一位 clone 下來直接跑 `npm run db:seed` 的開發者，
   > 與 contracts/cli-commands.md §1.4「開發預設下行為 MUST 完全相同」相衝；
   > 而該回落**不構成漏洞**：連線字串指向 PostgreSQL 時，`src/lib/env.ts` 的
   > 「provider 與 `DATABASE_URL` 不相符」驗證會在更早的模組載入期就拒絕啟動。
2. **6-B 子路徑相容（#9）**：`deploy/deployment.md` §9 的五項（`basePath` 由環境變數驅動、
   `proxy.ts` 兩處轉址改用 `request.nextUrl.clone()`、**26 處** client API 呼叫點改經
   新增的 `src/lib/apiUrl.ts`、`SESSION_COOKIE.path` 收斂為前綴、
   根目錄 `robots.txt` 由 Caddy 供給合併版而 `src/app/robots.ts` 保留不動）
   ＋ `layering.test.ts` 的字面量稽核 ＋ **第五套測試**（§10.1）。
   **已完成（2026-08-15）**：五套測試全綠（unit 454／integration 608／a11y 42／e2e 8／basepath 4）。
   **FEAT-6 收尾覆核（同日，T058）**：`npm run test:all` 再跑一次仍全綠，
   unit 482（+28 為本階段後續新增的單元測試，其中 20 案為破壞性偵測）／
   integration 608／a11y 42／e2e 8／basepath 4——**既有三套逐案相同**（SC-019）。

   > **「19 處」已更正為 26 處**（*實作裁示（2026-08-15）*）：原數字來自只看得見
   > `fetch('/api/…')` 字面量的樣式，漏掉 3 處常數（`lib/reader/**`）與 4 處經 helper 轉手
   > （`ReviewSection.tsx`）。**為什麼原文行不通**：那 7 處在子路徑下壞得完全一樣、
   > 而且全是靜默失敗，且原本的驗收方式（數 19 處 + grep 零命中）在它們全未修時**同樣通過**。
   > 完整理由與稽核規則的強化見 §5.7 的同名裁示。
3. **6-C 容器化（#8-1）**：`novelsite/Dockerfile` 三 stage（`build`／`runtime`／`cron`）、
   `deploy/compose.yml` 四服務（`cron` 另有唯讀 bind mount **`.:/app/deploy-cron:ro`**，
   理由見 §5.7）、`docker-entrypoint.sh`（**`migrate deploy` 在啟動期、
   不在建置期** —— 建置機連不到正式資料庫）、站方參考分類改由**冪等 migration** 建立
   （兩軌對稱，人工步驟數 0）、每日備份 + 異地上傳、
   **四服務逐一設 `logging: json-file` + `max-size: 10m` + `max-file: 3`**。
   **檔案側已完成（2026-08-15）**，容器實跑驗收（T041）與 SC-020／021／027 待外部條件。

   > **bind mount 來源為 `.`，不是 `./deploy`**（*實作裁示（2026-08-15）*）：
   > compose 的相對路徑以**compose 檔自己所在的目錄**為基準，而 `deploy/compose.yml`
   > 就在 `deploy/` 之內 —— 寫 `./deploy` 會解析成 `deploy/deploy`。
   > **為什麼原文行不通**：Docker 對不存在的 bind mount 來源會**自動建出空目錄**再掛進去，
   > 於是 `cron/crontab`、`cron/backup.sh` 與 `notify.sh` 三個檔案在容器內全都不存在。
   > 以 `docker compose config` 實測確認：`./deploy` 解析為 `<repo>/deploy/deploy`，
   > 改為 `.` 後解析為 `<repo>/deploy` 且三檔皆到位。
   > 正式主機上同樣成立（compose 部署為 `/srv/sites/compose.yml`，`.` 即 `/srv/sites`）。

   > **容器實跑驗收已完成（T041，2026-08-15）**，PostgreSQL 軌亦補跑
   > `DATABASE_PROVIDER=postgresql npm run test:integration`（608/608，與 SQLite 軌相同）。
   > **實跑當場抓到六個只在容器內才會現形的設定錯誤**，逐項的症狀、成因與修正見
   > `specs/006-production-launch-readiness/tasks.md` 的 T041 註記；其中兩個是
   > 「設了但沒生效、且沒有任何錯誤訊息」的典型：
   >
   > 1. **alpine 缺 `tzdata`** → `TZ=Asia/Taipei` 對 libc 無效而回落 UTC。
   >    Node 自帶 ICU 故日界正確、**看起來完全正常**，但 **crond 依系統時間觸發**——
   >    備份與每日彙總實際都晚 8 小時執行（FR-082 的驗收因此 MUST 檢查 `date` 而非只看 Node）。
   > 2. **`.sh` 為 CRLF**（`core.autocrlf=true` 且原無 `.gitattributes`）→
   >    `notify.sh` 在容器內 `illegal option -` 而**失敗通知一封都寄不出去**；
   >    同一成因會讓 `docker-entrypoint.sh` 直接讓容器起不來。已補 repo 根的 `.gitattributes`。
   >
   > 空庫只跑 `migrate deploy`（未 seed）後分類 6 筆、`Novel` 0 筆，重跑同一份 SQL 仍是 6 筆（SC-026 成立）。

   > **兩項補正（FEAT-6 裁示，2026-08-14 第三輪，出處 `specs/006-production-launch-readiness/`
   > `/speckit-analyze`）**：
   >
   > 1. **容器日誌輪替（新增 FR-094a）**。原文只寫了「舊映像清理」與「備份保留」，
   >    **日誌沒有任何一處承接**，於是會沿用 Docker `json-file` driver 的**無上限預設值**；
   >    而 §5.7 的排程每 10 分鐘輸出一次，全部導向容器日誌。它撐爆開機磁碟時
   >    **全部服務同時異常** —— PostgreSQL 寫不進去、Caddy 拿不到憑證、映像建置失敗 ——
   >    看起來像什麼都壞了，沒有任何一行訊息說「日誌太大」。
   >    每月人工水位確認（FR-096／B5）是**偵測**，不是清理策略，MUST NOT 互相取代。
   > 2. **`deploy/` 下的腳本 MUST 以 `sh <路徑>`／`bash <路徑>` 呼叫**，
   >    MUST NOT 依賴執行位元。本 repo `core.fileMode=false`（Windows 開發機），
   >    既有 `novelsite/scripts/` 全數為 `100644` —— 新增的 `.sh` **進版控時不帶執行位元**，
   >    而 `deploy/` 在容器內是 **`:ro` 掛載、`chmod` 不了**，`cron` stage 又 `COPY` 不到它，
   >    **沒有任何環節能補上那個位元**。症狀是備份每天凌晨兩點一行 `Permission denied`，
   >    **而負責喊出來的 `notify.sh` 因為同一個原因也叫不動** —— 為了「不靜默」而存在的
   >    機制自己靜默壞掉。`docker-entrypoint.sh` 是唯一例外：它 `COPY` 進映像、映像層可寫，
   >    由 Dockerfile 內 `RUN chmod +x` 修在源頭。
4. **6-D 自動部署（#8-2）**：`ci.yml`（GitHub-hosted，**十一個步驟**：
   **`db:generate`**／`format:check`／`lint`／`tsc --noEmit`／**`build`** ＋ **五套測試循序**；
   E2E 那一步 **MUST 裝三個瀏覽器引擎**——*實作裁示（2026-08-15，T046）*：
   契約原寫 `--with-deps chromium`，但 `playwright.config.ts` 的 `firefox`／`webkit`
   兩個 project 對應 FR-059／SC-013 的讀者流跨引擎驗收，只裝 chromium 會讓閘門
   以 `browserType.launch: Executable doesn't exist` **從第一天就是紅的**）、
   `deploy.yml`（**self-hosted runner 於正式主機**：**架構斷言** → 破壞性偵測 →
   必要時人工核准 → 原生建置 → 先套用結構後啟動 → 健康檢查輪詢至成功、
   總逾時 5 分鐘 → 雙軌失敗通知）、
   `rollback.yml`（`workflow_dispatch` 輸入版本識別）
   ＋ **`deploy/deployment.md` 的「回滾」章節**（結構異動不隨之回復、主機上的手動備援步驟）。
   **健康檢查失敗 MUST NOT 自動回滾** —— 保留現場供查因。
   **檔案側已完成（2026-08-15）**：`.github/workflows/ci.yml`／`deploy.yml`／`rollback.yml`、
   `.github/actions/deploy/action.yml`（兩條部署路徑共用）、
   `novelsite/scripts/detect-destructive-migration.ts` + 其 20 案單元測試、
   `deploy/prune-images.sh`、`deploy/deployment.md` §10「回滾」。
   **SC-022／023／028 為待外部條件**——三個工作流程檔在本機只驗得到語法與判定邏輯，
   驗不到 `workflow_run` 有沒有真的接上（接錯時它不報錯，只是**永遠不觸發**）。

   > **四項補正（FEAT-6 裁示，2026-08-14，出處 `specs/006-production-launch-readiness/`
   > `/speckit-analyze`）**。原文只寫「五套測試循序」，照字面實作出來的東西有三個洞：
   >
   > 0. **閘門漏了 `npm run db:generate`，照原文寫出來的 `ci.yml` 在乾淨 checkout 上必紅**
   >    （2026-08-14 第二輪補正）。`src/generated/prisma` 被 gitignore（`.gitignore:45`），
   >    `npm ci` 不會產生它（`prepare` 只有 `husky`，Prisma 7 也不再自動 postinstall generate），
   >    而 `build` 就是 `next build` 一句話。第一個會產生 client 的指令是 `npm run test`
   >    （`db:generate && vitest run`），排在測試段——於是 `tsc --noEmit` 與 `build`
   >    都跑在 client 還不存在的時候。`Dockerfile` 的 `build` stage 早已就地寫明同一條理由，
   >    **CI 只是沒有套用它**。故 `db:generate` MUST 緊接在 `npm ci` 之後。
   > 1. **閘門漏了三綠中的 `build`**。憲章第 IV 條把 `npm run build` 列為每次交付的硬性綠燈；
   >    「整合套件的 `globalSetup` 反正會 build」是隱含涵蓋，它在 `globalSetup` 被改動的
   >    那一天會靜默消失，且第五套那次 build **帶路徑前綴**，證明不了無前綴的建置是好的。
   >    故 `ci.yml` MUST **逐字列出** `npm run build`。
   > 2. **原文未寫 `deploy.yml` 的啟動條件**。`ci.yml` 與 `deploy.yml` 是兩個工作流程檔，
   >    跨檔的 `needs:` **不成立**；未明文時實作者會寫成 `push: main` 直接部署，
   >    **症狀是閘門紅了照樣部署，而流程紀錄上看起來一切正常**（FR-087 直接失守）。
   >    故觸發 MUST 為 `workflow_run`，且每個 job MUST 帶
   >    `if: github.event.workflow_run.conclusion == 'success'`——該事件在 `ci.yml`
   >    **失敗時也會觸發**，少了這一行等於沒有閘門。
   > 3. **原文無架構斷言，且回滾只寫了工作流程**。FR-080 要求「架構不符 MUST 在建置階段
   >    被發現」，原生建置使不符「理論上不可能」，但那是個沒有被檢查的前提——runner
   >    哪天被搬到別台機器，症狀會是**映像建得出來、跑起來才失敗**；故部署第一步 MUST 斷言
   >    `uname -m` 為 `aarch64`。回滾則 MUST 另有文件落點：FR-091 明列兩項**文件**要求，
   >    而 SC-028 的後半句（流程平台不可用時仍能回滾）**只能由文件成立**。
   >
   > **第三輪補正（FEAT-6 裁示，2026-08-14）——破壞性偵測 job 的三項落地條件**。
   > 上面第 3 點把「架構斷言 → 破壞性偵測 → …」寫成一條鏈，但沒有寫**偵測跑在哪台機器上**，
   > 而契約一度把它寫成 `ubuntu-latest`。三項皆為「照著做會壞、且症狀不指向原因」：
   >
   > 1. **`detect` job MUST 跑在 self-hosted**。它的輸入 `<deployed-sha>` 來自
   >    **正式主機上的 `docker inspect`**（讀 `org.opencontainers.image.revision` label），
   >    GitHub-hosted runner 碰不到那台機器的 docker daemon。跑在 `ubuntu-latest` 時
   >    **永遠取不到 base**，fail-safe 一律輸出 `destructive: true`，
   >    於是**每一次部署都停在人工核准** —— 規格 SC-025 的後半句
   >    「向後相容者要求核准比率 0%」100% 失敗，而流程紀錄上只看起來像
   >    「這個專案的核准設得比較嚴」。
   > 2. **該 job 的 `actions/checkout` MUST 帶 `fetch-depth: 0`**。預設值是 `1`，
   >    淺 clone 裡沒有 `<deployed-sha>` 那個 commit，`git diff` 會 `fatal: bad object`，
   >    落到與上一項完全相同的症狀。
   > 3. **pathspec MUST 帶 `novelsite/` 前綴**（`git diff --name-only <base>..HEAD --
   >    novelsite/prisma/migrations/postgres/`，cwd 為 repo 根）。
   >    這是**唯一一個往放行方向倒**的失敗模式：路徑寫錯時 `git diff` 不報錯、
   >    只回**空集合**，而空集合的正常語意是「本次無 migration」＝安全，
   >    於是**破壞性異動全數被自動套用到正式資料庫**，且流程顯示「偵測通過」。
   >    故腳本 MUST 在跑 diff 之前**斷言該目錄實際存在**，
   >    並在單元測試中讓「目錄不存在 → 破壞性」與「空集合 → 安全」**成對存在**
   >    —— 只驗後者時，這個 bug 會完美通過測試。
5. **6-E 人工操作盤點與文件同步（#8-3）**：A 區 19 項一次性前置設定、
   B 區 11 項週期性項目，**每一項 MUST 寫明「沒做會怎樣」**；
   `deploy/deployment.md` 失效原文 MUST 被取代而非並存。
   **已完成（2026-08-15）**：兩份清單落在 `deploy/deployment.md` §6.1／§6.2，
   §6.1 附三項排除表（分類／主機 crontab／映像庫 **MUST NOT 再列為人工項目**）；
   §3.4／§3.7／§3.8／§4／§6／§8／§9 與檔首警語**逐處取代**（非並存）；
   `manual-steps.md` 檔首標明其與 §6 的關係，**MUST NOT 成為第二份人工清單**。
   **SC-024 仍為待外部條件**——它驗的是清單夠不夠用，只有未參與開發的人走一次才會現形。

**本 Phase 的 schema 增量為零**：無新 model、無欄位異動、無新索引、無新的雙軌分歧點。
唯一的 migration 是 6 筆 `Category` 的 `INSERT … ON CONFLICT DO NOTHING`
（SQLite 軌為 `INSERT OR IGNORE`），故它會被 6-D 的破壞性偵測判為向後相容、走全自動路徑
—— **這是 FR-092／SC-025 的第一個實測案例；若它觸發了人工核准，是偵測邏輯誤判**。

**明示不做的五項**（MUST NOT 由後續階段自行補上）：停機時間上限與可用率目標
（規格 FR-089b 明示決定）、自動回滾、藍綠／滾動部署、監控與告警平台、
資料庫結構異動的自動回復機制。

**待外部條件（MUST NOT 標記為已完成，憲章第 IV 條）**：乾淨機器一道指令拉起、
重開機自行恢復、一次真實合併的全自動部署、回滾實測、異地備份的實際還原演練、
**由一位未參與開發的人依人工清單實際走一次前置作業（SC-024）** ——
**六項**皆需要一台已開通的 Oracle ARM 主機與其一次性前置設定。

> **SC-024 為第三輪補入（FEAT-6 裁示，2026-08-14）**：原文列五項，
> 而 `features.md` FEAT-6 的完成定義把「A／B 兩份人工清單就位，每項皆載明未執行的後果」
> 直接標為 SC-024 可勾。但 SC-024 的條文是「**一位未參與開發的人**依清單，
> 在不詢問開發者的情況下完成上線前置作業」—— 它驗的是**清單夠不夠用**，不是清單存不存在。
> 清單寫得完整但漏了一個隱含前提時，兩者在文件上長得一模一樣，
> 差別只有真的有人照著走一次才會現形。以「文件寫好了」勾掉它，
> 與憲章第 IV 條禁止的「以腳本寫好了充當完成」是同一種錯。
> 文件側的交付（A 區 19 項、B 區 11 項、每項附後果）**照常於 6-E 完成並可勾**，
> 只是它對應的是 FR-095～FR-097，不是 SC-024。

### Phase 16 ─ 作者批次上傳章節（GitHub issue #14）

> 對應 `features.md` 的 **FEAT-7**，規格見 `specs/007-batch-chapter-upload/`。
>
> **為何新增本 Phase（FEAT-7 spec 裁示，2026-08-19）**：Phase 11（FEAT-3）交付的作者寫入流
> **只有逐章路徑** —— `createChapterAction` 一次產生一章、正文靠人工貼進編輯器再
> `saveChapterDraftAction`。一部長篇動輒數十至數百章，照該流程要重複同樣的三步數百次。
> Phase 11～15 的項目清單中**沒有任何一項涵蓋批次匯入**，且 Phase 15 已為上線收尾，
> 故另立本 Phase 承接 —— 與 Phase 14、15 新增時同一種問題。
>
> **schema 增量為零**：`Volume`／`Chapter`／`ChapterContent` 三張表已足以承載（見 §4.2），
> 無新 model、無欄位異動、無新索引、無新的雙軌分歧點。批次匯入建立的是**既有形狀的章節**。

1. **匯入入口**：於某一卷底下新增批次上傳路徑，**同一個入口 MUST 同時支援多檔選取與
   整個資料夾選取**（FEAT-7 spec FR-001 裁示，2026-08-19）。**`.zip` 明訂排除於範圍外** ——
   伺服器端解壓需另行處理 zip bomb、解壓後總大小上限與 zip 檔名編碼（zip 的檔名編碼常非 UTF-8，
   中文章節檔名會直接壞掉），三者都與「省下逐章貼上」這件事無關。
2. **章號與標題一律自檔名解析**，沿用既有的 `第N章_標題.md` 慣例
   （即 `prisma/seed.ts` 的 `CHAPTER_FILE_RE`，與 `prisma/seed-data/<作品 id>/正文/` 下的版控正文同一組規則）。
   **MUST NOT 以「依檔名排序後接續該卷最大章號」或「取正文第一個 Markdown 標題」推測**
   （FEAT-7 spec FR-005 裁示，2026-08-19）—— 字典序會讓「第10章」排在「第1章」與「第2章」之間，
   而既有的 seed 正文檔內**根本沒有 Markdown 標題行**，兩種推測在本專案的實際資料上都會錯；
   錯了之後，作者要在數百章裡找出哪一章被放錯位置。檔名不符慣例者於預覽階段標示為錯誤。
3. **寫入前 MUST 有預覽**：逐檔列出來源檔名、章號、標題、字數與判定結果，
   作者確認後才建立；資料夾模式下被過濾掉的非 `.md` 檔與**位於子目錄內的檔案** MUST 於預覽以
   「已略過」列出（含檔名），MUST NOT 靜默丟棄。
   **原文寫「非 `.md` 檔與子目錄」，那樣不可執行**（FEAT-7 第五輪 analyze 修正，2026-08-21）：
   資料夾選取以 `<input type="file" webkitdirectory>` 實作，它交給程式的 `FileList`
   **只含檔案、不含任何目錄項目** —— 待判定的清單裡永遠不會出現目錄，會出現的是
   **子目錄內的檔案**（以 `webkitRelativePath` 帶出層級）。照原文實作，判定代碼 `DIRECTORY`
   永遠產不出來，而它的對照測試只能餵一個瀏覽器不可能給出的假輸入才會變綠 ——
   測試綠了，這一條卻沒有實作。改判「檔案位於子目錄內」後，作者選了作品根資料夾
   （章節其實在 `卷一/` 底下）時看得到少的是哪些檔，才是這一條的本意。
   出處：`specs/007-batch-chapter-upload/research.md` R-13、spec FR-001a。**預覽 MUST 附摘要列**（可匯入章數／正文為空章數／已略過數／錯誤與衝突筆數）
   —— 逐列標示在上千列的清單裡會被滑過去，摘要列是作者唯一會確實讀到的那一行。
   **可匯入章數含正文為空的那幾章**（FEAT-7 T005 實作裁示，2026-08-22）：兩者是包含關係、
   不是互斥的分割，摘要列的讀法是「可匯入 48 章，**其中** 2 章正文為空」。
   **不含的話 FR-021 會被自己否定** —— 一批全是空正文的檔案會得到「可匯入 0 章」，
   而「可匯入章數為 0」正是四個批次級阻擋條件之一，於是那批檔案送不出去，
   但下一行明訂空正文不阻擋匯入。出處：`specs/007-batch-chapter-upload/data-model.md` §2.3。
   **正文為空或僅含空白的檔案判定為「警告」而非錯誤**，不阻擋匯入（FEAT-7 clarify 裁示，2026-08-20）
   —— 現行 `createChapter` 建立的本來就是空章節，擋掉會使批次比單章嚴格。
3a. **預覽於瀏覽器端產生，伺服器不持有正文**（FEAT-7 clarify 裁示，2026-08-20）：
   前端讀檔、解析檔名、計算字數，伺服器於預覽階段**只提供該作品既有章節的章號與標題**供標示衝突，
   MUST NOT 接收正文、MUST NOT 建立任何暫存批次。正文只在作者確認後傳輸一次。
   **帶標題而非只帶章號**（FEAT-7 analyze 修正，2026-08-21）：**本項原寫「只提供該作品既有章號清單」，
   那樣不夠** —— 衝突列要顯示「與既有第 N 章《標題》衝突」（第 4 項、spec US3 AC3），
   只給章號的話那一列講不出撞到的是哪一章。且這不需要多做事：`getAuthorNovelManage` 回傳的
   `AuthorManageChapter` 本來就同時帶 `number` 與 `title`（見下方「技術落點」）。
   出處：spec FR-002a、research R-2。
   選此法而非「送兩次」或「伺服器暫存」：前者同批檔案走兩趟網路，後者引入暫存表、TTL 與清理作業。
   **清單範圍是作品而非目標卷**（clarify 第二輪修正，2026-08-20）—— 章號的唯一性約束是
   `@@unique([novelId, number])`，只比對該卷會漏掉與其他卷的衝突，漏掉的下場是
   預覽說可以匯入、送出時被資料層擋下。
3c. **章號跳號為警告、跨卷交錯不檢查**（FEAT-7 clarify 裁示，2026-08-20）：
   既有章號與本批次章號合併後若不連續，預覽 MUST 以警告標示並於摘要列計數
   （目的是抓出 `第100章` 誤打成 `第10章` 這類檔名錯誤），**MUST NOT 阻擋** ——
   **且該警告 MUST 只存在於摘要列，MUST NOT 同時是一種逐列判定**
   （FEAT-7 第五輪 analyze 補述，2026-08-21）：缺號是**序列**的性質，
   「第 21–99 章缺號」講的是一段**不存在**的區間，掛不到任何一個來源檔上。
   原本 `data-model.md` §2.2 把 `NUMBER_GAP` 同時列為逐列代碼又註明「摘要列層級」，
   兩種說法並存的結果是「哪一列該掛它」無人答得出來，而逐列驗收又要求它有一個案例。
   出處：spec FR-022、`data-model.md` §2.2。
   分批匯入（先匯 51–100、日後補 1–50）是正當用法。
   「章號落在其他卷既有章號區間內」則 **MUST NOT 判斷**：該判斷需伺服器一併回傳
   每個既有章號所屬的卷，把預覽介面撐大，而它抓到的問題大致已被缺號警告涵蓋。
3d. **確認後的進行中狀態與異常結束**（FEAT-7 clarify 裁示，2026-08-20）：
   送出控制項 MUST 於確認後立即停用（上界情境耗時可觀，未停用時第二次點擊會送出第二個完整批次）；
   上傳階段 MUST 顯示百分比、伺服器寫入階段 MUST 顯示不確定進度的「寫入中」
   （單一交易無法分段回報，假的百分比比誠實的忙碌指示更糟）。
   **前端逾時或斷線時 MUST NOT 自動重試** —— 伺服器交易可能已成功，重試只會整批撞號中止，
   作者看到的是與實際狀態無關的錯誤。改為**自動重查該作品既有章號清單**（第 3a 項的同一介面）
   判定實際結果：已存在則回報「已建立 N 章」；尚未出現時措辭 MUST 為
   「尚未看到新章節，請稍後重新整理確認」，**MUST NOT 表述為「匯入失敗」**——
   全有全無的交易在 commit 前查不到，查不到並不等於失敗，斷言失敗會誘使作者重送。
3b. **伺服器寫入時 MUST 全量重驗**（檔名慣例、章號、標題與正文長度、批次內與既有衝突、三項上限），
   MUST NOT 因前端已在預覽階段算過就採信 —— 前端解析是體驗，伺服器重驗是唯一的正確性依據。
   **解析規則（檔名 → 章號與標題、字數計算）MUST 只有一份實作**，以純函式由前後端共用；
   前後端各寫一份必然漂移，而漂移的症狀是「預覽說可以匯入、送出卻被拒」，
   且沒有任何一個測試會變紅。
4. **任一章號衝突即整批中止**（批次內重複、或與該作品既有章節重複皆然，
   FEAT-7 spec FR-011 裁示，2026-08-19）。**MUST NOT 提供跳過或覆寫的選項** ——
   覆寫會改動既有（含已發佈）章節且無還原路徑；跳過會讓「選了幾檔」與「匯了幾章」不一致，
   兩者都把核對成本丟回給作者。整批寫入 MUST 為全有全無，失敗時不留下任何已建立的章節。
5. **匯入的章節一律 `status='draft'`、`scheduledAt` 為 `null`**。排程與發佈沿用 Phase 12（FEAT-4 4-D）
   既有的 `publishChapter` 路徑，不在本 Phase 範圍內 —— 把排程塞進匯入，等於讓一個已經有
   多個失敗模式的作業再多一組。
6. **授權沿用既有守衛**：`requireAuthorForAction()` + 服務層擁有權判定，
   順序為身分（`UNAUTHENTICATED`）→ 角色（`FORBIDDEN`）→ 擁有權（`NOT_FOUND`），
   與 §7 既有作者寫入動作的錯誤語意完全一致。憲章第 II 條為不可協商條款，
   且本 Phase 開的是一條**一次能寫入數百章**的新寫入路徑。
7. **三項上限為 1000 檔／單檔 1 MB／總計 50 MB**（FEAT-7 clarify 裁示，2026-08-20），
   章節編號有效範圍為 **1–9999**。三者 MUST 同時於預覽階段（瀏覽器端）與寫入階段（伺服器端）判定，
   超限訊息 MUST 同時含實際值與上限值。**總大小 MUST 在緩衝完整請求內容之前**依請求宣告的
   `Content-Length` 判定並拒絕，**缺 `Content-Length` 者亦拒絕** —— 先把 50 MB 收完再說
   「超過上限」等於沒有上限，而「缺了就跳過檢查」等於為 chunked 傳輸開一個不設限的洞。
   **檔案數則於解析 multipart 之後判定**（FEAT-7 analyze 修正，2026-08-20）：
   原文寫「總大小**與檔案數** MUST 在緩衝完整請求內容之前依請求宣告的長度與檔案數判定並拒絕」，
   該敘述**不可執行** —— multipart 沒有宣告 part 數的標頭，緩衝前判定檔案數沒有著力點，
   依原文驗收會與實作永久對不上。總量既已由 `Content-Length` 封頂，最壞情況是緩衝了 50 MB
   才發現有 1001 個檔案，量體仍在上限內。出處：`specs/007-batch-chapter-upload/research.md` R-11。
   取值理由 MUST 保留於實作處：單檔 1 MB 是因單章正文上限 100,000 字元、中文 UTF-8 約 300 KB，
   留三倍餘裕使合法章節不被誤擋；總大小 50 MB 是因典型中文章節約 6–15 KB、1000 章約 15 MB，
   同樣留三倍餘裕。**總大小 MUST NOT 由檔案數乘單檔上限推導**（1000 × 1 MB = 1 GB）——
   它是獨立護欄，存在目的正是擋下「每一檔都貼著單檔上限」這種前兩項擋不住的情況。
   單章既有的長度上限（`MAX_LENGTH.chapterTitle=200`、`MAX_LENGTH.chapterBody=100_000`，見
   `src/lib/validation/common.ts`）**MUST NOT 因批次而放寬**。
7b. **每一次匯入嘗試 MUST 輸出一行結構化紀錄至標準輸出**（FEAT-7 clarify 裁示，2026-08-20）：
   發起者 id、作品 id、卷 id、檔案數、總位元組數、結果、耗時；**成功與失敗皆記**。
   **MUST NOT 寫入資料庫**（本階段 schema 增量為零，稽核表會連帶引入保留期、清理作業與隱私處置；
   容器日誌輪替上限已於 Phase 15 設定）。**MUST NOT 包含正文、章節標題或來源檔名** ——
   那是營運用的量體紀錄，不是內容備份，把未發佈草稿的標題寫進日誌是內容外洩。
   **本項與第 7a 項互為前提**：不設限流的重新評估條件是「單一作者短時間內反覆送出接近上限的批次」，
   沒有這行紀錄，那個條件無人看得到，等於寫了一個永遠不會被觸發的條件。
7a. **匯入 MUST NOT 另設頻率限流**（FEAT-7 clarify 裁示，2026-08-20），沿用 §7.6 既有政策
   （限流對象為未登入可達入口，登入後的作者寫入路徑一律無限流）。為單一寫入動作破例會使它成為
   全站唯一的例外，而測試該例外需要可重置或可停用的限流機制 —— 那正是 §7.6 明文禁止的東西。
   **代價是本功能的護欄完全落在第 6 項的擁有權判定與第 7 項的三項上限，沒有第二層可以擋**，
   兩者 MUST NOT 放寬或延後。殘留風險（已登入且擁有該作品的作者反覆送出貼近上限的批次）已知並接受；
   重新評估的觸發條件為「單一作者短時間內反覆送出接近上限的批次」，屆時的處置是在既有限流層
   加一條規則，而非放寬三項上限。
8. **匯入成功後 MUST 於同一交易內呼叫既有的 `refreshNovelCounters` 與 `touchNovel`**，
   使作品的 `chapterCount`／`wordCount` 與資料庫實際狀態一致；每章字數規則與單章儲存路徑一致
   （規則源自 **FEAT-2 FR-011a**；本階段由 FEAT-7 FR-008 要求一致）。
   **⚠️ 但這兩個數字在匯入後不會變動，而那是正確結果**（FEAT-7 analyze 修正，2026-08-20）：
   `refreshNovelCounters`（`src/lib/repositories/novels.ts:366`）的 `where` 為
   `{ novelId, status: 'published' }`，函式註解明寫「只計已發佈章節，與 FEAT-2 seed 建立的語意一致」，
   而匯入產出一律 `status='draft'`（見第 5 項）。計數會在作者日後逐章發佈時，由 Phase 12 既有的
   `publishChapter` 路徑遞增。
   **為什麼原文行不通**：原文寫「匯入成功後 MUST 於同一次作業內**回填**作品的 `chapterCount` 與
   `wordCount`」，字面讀是「數字要變」。照它驗收，FEAT-7 spec 的 US1 AC3 恆為假；
   而讓它變真的唯一作法是改掉 `refreshNovelCounters` 的 published-only 語意 ——
   那會**靜默改動單章儲存、發佈、下架、刪除、排程發佈共 5 條既有寫入路徑**的計數行為，
   遠超本 Phase 範圍。參照：單章的 `createChapter` 正因如此**不呼叫**它。
   **仍呼叫它的理由**：它是「依實際資料重算」而非「加 N」，成本一次 aggregate，
   換的是計數永不與明細脫節。**MUST NOT 為了讓數字動起來而改它的語意，
   亦 MUST NOT 另寫一套只給匯入用的計數規則**（FEAT-7 FR-013a）——
   兩者都會讓「作品字數」在站上有兩種意思。
   出處：`specs/007-batch-chapter-upload/data-model.md` §1.4、spec FR-013／FR-013a。
9. **正文 MUST 經過與單章路徑完全相同的寫入端淨化**（`chapterService.sanitizeBody`，
   即 M-2 的控制字元過濾：保留 `	`／`
`／`
`、不 trim、不改排版），
   **MUST NOT 另訂一套、MUST NOT 略過**（FEAT-7 clarify 裁示，2026-08-20）——
   批次匯入是本階段新開的寫入口，漏掉淨化的症狀只出現在批次路徑上，
   單章路徑的既有測試會照樣全綠，沒有任何一個測試會變紅。
   驗收上的「正文與來源檔逐字相同」因此 MUST 表述為「**經同一組淨化後**逐字相同」：
   不含控制字元的一般 Markdown 稿件即為逐字相同。

**完成定義**（**15 項，與 `features.md` FEAT-7 的完成定義一一對應**）：

1. 作者可在某一卷底下一次上傳多個章節檔並建立對應章節（多檔選取與資料夾選取皆可）
2. 寫入前提供預覽，作者確認後才實際建立；**取消不留下任何暫存資料**
3. 檔名不符、章號無效、編碼無法解讀、標題或正文超長、批次內重複、與既有衝突、單檔超限
   七類**逐檔判定**問題皆有明確繁中訊息並**指名來源檔**；授權類與請求格式類沿用既有通用文案
   且**不指名來源檔**（見下方「錯誤訊息的指名範圍」）
4. **非 `.md` 檔在資料夾模式列為「已略過」（不阻擋）、在多檔選取模式列為錯誤（阻擋），
   兩種模式各有驗收**（第 3 項旁的 FR-001c）；**子目錄內的檔案於資料夾模式列為
   「已略過（位於子目錄）」且檔名照樣出現在清單上**（第 3 項，2026-08-21 第五輪 analyze）
5. 任一失敗情境後該卷章節列數與 `Chapter`／`ChapterContent` 兩表列數與匯入前完全相同
6. **成功匯入後 `chapterCount`／`wordCount` 亦與匯入前相同**（published-only 語意，見第 8 項），
   將其中一章以既有單章路徑發佈後兩者才隨之增加
7. 未登入／讀者角色／非擁有者三種身分皆被拒且不產生任何資料列
8. 跨站來源與請求格式驗證皆早於身分驗證，且兩者各有驗收（第 6 項旁的 FR-015a）
9. **正文經與單章相同的 `sanitizeBody`；不含控制字元的稿件比對結果為逐字相同**（第 9 項）
10. **三項上限（1000／1 MB／50 MB）與章號範圍（1–9999）於前端與伺服器皆生效**；
    總大小依 `Content-Length` 於緩衝完整請求前即拒絕（缺該標頭者亦拒絕），
    檔案數則於解析 multipart 後拒絕（第 7 項）
11. 章號缺號以警告標示並於摘要列計數，且不阻擋匯入
12. 每次匯入嘗試皆可在伺服器紀錄找到對應的一行（**恰 9 欄**，含身分驗證前的提前返回 ——
    那時 `actorId`／`novelId` 為 `null` 但仍照常輸出），且該行不含正文、標題或檔名
13. 前端逾時而伺服器實際成功時，作者最終看到的訊息與資料庫狀態一致且未送出第二批
14. 單元測試涵蓋檔名解析、章號指派與衝突判定、權限拒絕、上限判定、空正文與缺號警告
15. `npm run build` / `lint` / `tsc --noEmit` 全綠

> **本段於 FEAT-7 第四輪 analyze 補齊（2026-08-21）**。**原文為 11 條散文，那樣行不通**：
> `features.md` FEAT-7 的完成定義是 15 項，而 `specs/007-batch-chapter-upload/tasks.md` T053
> 一直寫著「本檔的完成定義 MUST 與那 15 項一致」。實際比對後本檔缺四項 ——
> 第 2 項的「取消不留暫存」、第 3 項的指名／不指名分野、第 9 項的淨化逐字相同、
> 第 10 項的三項上限與章號範圍。**兩份上游真相來源就同一件事給出不同的完成標準，等於沒有標準**，
> 而交付前照哪一份核對就成了運氣問題。同時改為編號列表，讓「第 N 項」在執行紀錄裡指得動。
> 出處：`novelsite/features.md` FEAT-7 完成定義、`specs/007-batch-chapter-upload/tasks.md` T052／T053。

**執行紀錄（2026-08-22，FEAT-7／T001～T054）**：上方**完成定義的 15 項全部完成**，
且已與 `features.md` FEAT-7 的 15 項逐項核對 —— 條數相同、順序相同、**每一項的判準亦一致**
（本輪只做核對，未再補寫任何一份完成定義：兩份並存正是該段當初要消滅的東西）。

- **閘門**：`npm run build`（以 `MAIL_MODE=console`）／`npm run lint`／`npx tsc --noEmit` 三綠；
  單元 36 檔 542 案、整合 80 檔 632 案、a11y 4 檔 44 案、E2E 13 案
  （chromium 11 + firefox 1 + webkit 1）、basepath 1 檔 4 案，全過。
- **雙軌（§10.5）未完成**：SQLite 軌 80 檔 632 案全過；**PostgreSQL 軌未執行**——
  本機 `localhost:5432` 連線被拒、Docker daemon 未啟動，全機亦無 PostgreSQL 執行檔。
  屬待外部條件，**MUST NOT 當成已完成**。
- **上界壓測（第 10 項的資源面）**：1000 章全數落地，`Chapter`／`ChapterContent` 各 1000 列，
  伺服器端整筆 `durationMs=442`；`withTransaction` 的 `timeout: 30_000` 依實測**維持不變**
  （約 60 倍餘裕；調低只會在較慢的機器上換來偽紅燈）。
- **第 6 項（計數不變）與第 8 項（published-only）如規劃成立**：匯入後 `chapterCount`／
  `wordCount` 與匯入前相同，逐章發佈其一後才增加（`tests/integration/chapter-import-flow.test.ts`）。
  `refreshNovelCounters` 一行未改。
- **第 12 項（匯入紀錄）的實測**：測試伺服器 stdout 共 8 行 `chapter.import`，
  欄位鍵恰 9 個，含身分驗證前的三筆（`actorId`／`novelId` 為 `null` 但照常輸出）；
  以 `.md`／章節標題／`filename`／`title`／`bodyMarkdown` 掃描，命中數 0。
- **兩處與規劃不同的實作補述**（改成什麼／為什麼原文行不通／出處）：
  (a) **成功後的「已建立 N 章」由作品管理頁報出**，不由匯入面板自己顯示。
  **原本的作法行不通**：面板在成功回呼裡即收起（`onImported`），它自己那句訊息隨元件卸載，
  作者只會看到面板消失。`NovelManageView` 的 `VolumeSection` 因此新增 `notify` 入參，
  把該句送到頁首既有的 `role="status"` 區。出處：`quickstart.md` §3 US1 表、`tasks.md` T045。
  (b) **確認送出前 MUST 先把焦點移離送出鈕**（交給摘要列，`tabIndex={-1}`）。
  **第 1 項與 FR-004a 的「作業期間停用送出控制項」單獨落地是不夠的**：
  停用一個正被聚焦的元素會讓焦點掉回 `<body>`，鍵盤與螢幕閱讀器使用者得從頭 Tab 一遍
  才找得回作業進度。出處：`tasks.md` T046、`tests/a11y/batch-import.test.tsx`。
- **T054（`deploy/Caddyfile` 的 `request_body { max_size 55MB }`）本輪只做核對**：
  `ee3598c`（2026-08-20）已落地，`deploy/deployment.md` §3.3 亦同步，未新增第二個區塊。

**技術落點（FEAT-7 plan 定案，2026-08-20；細節見 `specs/007-batch-chapter-upload/`）**：

- **端點**：`POST /api/author/volumes/{volumeId}/chapters/import`（見 §5.5 該列）。
  **`next.config.ts` 的 `serverActions.bodySizeLimit` MUST 維持預設** —— 走 Route Handler 就是為了不動它。
- **預覽不新增端點**：`getAuthorNovelManage` 回傳的 `AuthorManageChapter` 已含 `number` 與 `title`，
  作品管理頁的 client 元件本來就拿得到。逾時後的重查（第 3d 項）以 `router.refresh()` 完成。
  這正是第 3a 項要的「章號與標題」，不必為預覽另開查詢。
- **寫入**：單一交易內 `chapter.createMany` + `chapterContent.createMany` 各一次（識別碼於應用層
  `randomUUID()` 先產生），再 `refreshNovelCounters` + `touchNovel`。
  **`repositories/tx.ts` 的 `withTransaction` 增加選填的 options 參數**：1000 章的上界下，
  Prisma 互動式交易的預設 5 秒 timeout 必然逾時，而全有全無不允許拆交易。**選填**是關鍵 ——
  既有 **24 個呼叫端（散在 9 個服務檔）**一行不改（數字經 2026-08-20 analyze 實測更正，原記 12）。逐筆 `create` 會是 2000 次來回，`createMany` 壓成 2 次。
- **純函式落點**：`src/lib/chapterImport/parse.ts`（**MUST NOT** `import 'server-only'`，
  前端與伺服器共用同一份，即第 3b 項的單一實作要求）；上限常數與匯入 schema 於
  `src/lib/validation/chapterImport.ts`。
  **`countWords` 自 `services/chapterService.ts` 移入 `validation/common.ts` 並於原處 re-export** ——
  該服務檔首行是 `import 'server-only'`，client 引用不到；`stripControlChars` 本來就住在 common。
  既有 import 路徑與既有測試一律不變。
- **匯入 schema MUST NOT 複用 `chapter.ts` 的 `bodyMarkdownField`**：該欄位帶
  `.refine(v => v.trim().length > 0)`，會把第 3 項明訂為警告的空正文升級為錯誤。
  **匯入 schema 只驗形狀與型別；長度與內容判定一律由 `gradePreview` 產出逐列 verdict**
  （FEAT-7 第五輪 analyze 修正，2026-08-21）。**原文寫「長度上限則照用 `MAX_LENGTH`，不放寬」**，
  而同一份規劃已裁示伺服器重驗 MUST 以 `gradePreview` 一次完成 ——
  **兩處並存等於同一件事有兩份判定**：一份回 Zod issue（手上只有陣列索引 `rows[7]`）、
  一份回 verdict（帶來源檔名）。誰先跑、訊息用誰的，兩處都沒寫，
  而先跑的那一份決定作者看到什麼；FR-019 要求逐檔判定類指名來源檔、FR-002c 要求判定只有一份實作。
  上限值仍取自同一個 `MAX_LENGTH`（不放寬，第 7 項），改的只是**在哪裡判**。
  出處：`specs/007-batch-chapter-upload/contracts/internal-modules.md` §2。
- **編碼判定**：`new TextDecoder('utf-8', { fatal: true })`。**`fatal: true` 是硬需求** ——
  預設的非嚴格模式會把壞位元組換成 U+FFFD 並靜默成功，正是本 Phase 明文禁止的行為。
  BOM 由 `TextDecoder` 預設（`ignoreBOM: false` ＝移除）處理，不手動裁切。
  檔名於解析前一律 `normalize('NFC')`（macOS 檔名為 NFD，長度與比對會因作者用哪台電腦而異）。
- **選檔機制**（FEAT-7 第五輪 analyze 定案，2026-08-21）：多檔選取為 `<input type="file" multiple>`、
  資料夾選取為 `<input type="file" webkitdirectory>`。後者的 `FileList` 只含檔案，
  子目錄內的檔案以 `File.webkitRelativePath` 帶出層級，故解析結果需多帶一個 `relativePath` 欄位
  （多檔模式為空字串）—— 少了它，判定函式的入參**型別上就不可能**回傳任何與路徑層級有關的結果。
  不採 File System Access API（`showDirectoryPicker()`）：它不是表單元件（`<label>` 關聯要另尋作法，
  憲章第 V 條），且 Firefox 不支援，為了顯示目錄名換掉整個選檔機制不划算。
- **逐列判定共 12 種代碼，且有明確優先序**（同輪定案）：一列**恰有一個**判定結果；
  判定 MUST 依 `data-model.md` §2.2 的優先序由上而下、先命中先勝、命中即停。
  **沒有優先序的後果**：一列同時命中多項是常態（1.2 MB 且與既有撞號、空正文又在批次內重複），
  回哪一個代碼變成實作者當下的選擇，而逐項驗收每一案都只餵單一條件 —— **任何順序都會綠**，
  作者卻可能拿到一個對他沒用的原因。12 種係由原本的 13 種修正而來（`DIRECTORY` 改判子目錄內的檔案、
  `NUMBER_GAP` 移出逐列判定，見第 3、3c 項）。
- **上傳進度用 `XMLHttpRequest`**：`fetch()` 沒有上傳進度事件，而串流上傳需 `duplex: 'half'`，
  瀏覽器支援度不足以換一個進度條。
- **紀錄**：新增 `logImportEvent`（`src/lib/chapterImport/log.ts`），
  **MUST NOT 擴充 `auth/audit.ts` 的 `logSecurityEvent`** —— 該函式的四欄位形狀被其單元測試鎖死。
  白名單組物件的手法照抄，那是第 7b 項「不得含正文／標題／檔名」唯一可靠的落實方式。
  **輸出恰 9 欄**：入參 7 欄（`actorId`／`novelId`／`volumeId`／`fileCount`／`totalBytes`／
  `result`／`durationMs`）加上函式自填的 `event`／`at`。
  **`actorId` 與 `novelId` 的型別 MUST 為 `string | null`**（FEAT-7 analyze 補述，2026-08-20）：
  第 7b 項要求「成功與失敗皆記」，而端點的來源比對、`Content-Type`、`Content-Length` 三步
  發生在身分驗證**之前**，那時 `actorId` 不存在、`novelId` 更要到服務層反查後才有。
  宣告為必填 `string` 會逼實作者填 `''` 或 `'unknown'`，而那種自造值在日誌查詢裡與真實 id 無法區分。
  **值為 null 時 MUST 照常輸出，MUST NOT 略過整筆** —— 略過的正好是被擋在門外的請求。
- **非 `.md` 檔的判定級別隨選檔模式而異**（FEAT-7 FR-001c，analyze 補述 2026-08-20）：
  資料夾模式為「已略過」（不阻擋，即第 3 項），**多檔選取模式為錯誤（阻擋）**。
  差異是刻意的：資料夾模式下裡面有什麼不是作者逐一挑的，自動過濾符合預期；
  多檔模式下作者是明確點選了那個檔，靜默略過會讓「我選了 30 個檔」與「系統說匯入 28 章」
  對不起來，而作者無從得知少的是哪兩個。
- **請求格式驗證（`Content-Type`、`Content-Length`）與來源比對 MUST 早於身分驗證**
  （FEAT-7 FR-015a，analyze 補述 2026-08-20）：兩者都不需要工作階段，
  且 `Content-Length` 那一步是第 7 項「緩衝完整內容之前」的唯一著力點，
  排到身分之後就得先把 50 MB 收下來。其結果是**未登入者對格式不合的請求得到 400 而非 401**，
  此為預期行為，**MUST NOT 視為第 6 項授權順序的違例** —— 第 6 項規範的是三道**授權**判定
  彼此的先後，不涵蓋授權之前的守衛。
- **部署面**：於**版控的** [`deploy/Caddyfile`](../deploy/Caddyfile) 的 `/novelsite*` 區塊設定
  `request_body { max_size 55MB }`，並於 `deploy/deployment.md` §3.3 同步。
  **這是硬化，不是修復**（FEAT-7 analyze 修正，2026-08-20）。
  **為什麼原文行不通**：原文寫「未調整的症狀是代理層直接回 413」。**該前提不成立** ——
  **Caddy 沒有預設的請求主體上限**（`request_body` 是 opt-in 指令）；1 MB 預設是 **nginx** 的
  `client_max_body_size`，本站不是 nginx。不設定時請求會被原封轉給應用，不會有 413，
  照原文除錯的人會去查一個永遠不會發生的錯誤。設它的理由是把上限釘在代理層，
  而非只靠應用層的 `Content-Length` 檢查。**55MB ＝ 50 MB 上限 + multipart 邊界與各部標頭的餘裕；
  MUST NOT 設成正好 50MB**（剛好貼齊上限的合法批次會在代理層被擋掉，而應用日誌裡什麼都沒有）。
  **落點是 `deploy/Caddyfile` 而非 `deploy/deployment.md` §6 的人工清單** ——
  該檔由 compose 以 `:ro` 掛入 caddy 容器、隨版控走；清單裡的字與檔案裡的設定沒有任何機制保持一致。

**錯誤訊息的指名範圍**（FEAT-7 FR-019，analyze 修正 2026-08-20）：全部訊息 MUST 為繁體中文。
**逐檔判定類**（檔名不符、章號無效、編碼、標題或正文超長、批次內重複、與既有衝突、單檔超限）
MUST 指名是哪一個來源檔。**授權類與請求格式類**（未登入、角色不足、找不到、來源不被信任、
缺 `Content-Type`／`Content-Length`、總大小或檔案數超限）沿用既有通用文案，**MUST NOT 指名來源檔**。
**為什麼原文行不通**：原文（FR-019）寫「**所有**錯誤訊息…MUST 指名是哪一個來源檔案」，
但授權錯誤發生在讀取任何檔案之前（沒有「哪一個檔」可指），
且「找不到」MUST 與資源不存在時逐字相同（第 6 項），指名任何細節即是洩漏；
總大小與檔案數超標的是**總量**，指哪一個檔都是誤導。
出處：`specs/007-batch-chapter-upload/contracts/batch-import-api.md` §1.3。

**治理同步（FEAT-7 analyze，2026-08-20）**：本階段的 `/speckit-analyze` 查出憲章
「開發流程 → 規劃文件」條款指名的 `novelsite/plan.md` 與 `novelsite/nextstep.md`
自 FEAT-2 起已非逐階段更新勾選與執行紀錄的地方 —— 實際承載的是**本檔與 `features.md`**。
憲章據此 **PATCH 至 v1.0.3**，改為指名這兩份；要求本身（勾選狀態 + 執行紀錄 + 日期）一字未改。
`plan.md` 與 `nextstep.md` **皆未廢棄**（憲章「上線前必經」仍引用 `nextstep.md` 的 H-1／H-2／H-3），
但不再是逐階段更新的工作清單。

**實作切分（四刀，順序即相依）**：7-A 純函式與其單元測試 → 7-B 伺服器寫入路徑與整合測試 →
7-C 前端面板與無障礙 → 7-D E2E 與文件回寫。7-B 完成時功能已可由整合測試證明成立。

---

### Phase 17 ─ 作者批次發佈與批次刪除章節

> **本 Phase 為 2026-08-22 新增**（FEAT-8 `/speckit-specify` 裁示，
> 規格見 `specs/008-batch-publish-delete/`）。
> **為什麼原文不夠**：§5.5 的章節寫入 Action 全部是**一次一章**
> （`publishChapterAction`／`deleteChapterAction`），而 Phase 16 交付的批次匯入
> **產出一律是草稿**（FEAT-7 FR-013）。兩者接在一起的結果是：
> 匯入 200 章只要 3 次操作，把它們發佈出去卻要 200 次；匯錯要退回要 400 次。
> **Phase 16 的項目清單已於 2026-08-22 全數執行完畢並結案**（GitHub issue #14 已關閉），
> 把新項目補進一個已收尾的階段會讓該階段的執行紀錄失真，故另立本 Phase 承接
> —— 與 Phase 14、15、16 新增時同一種問題。
> **相依 Phase 16**：本階段處理的正是它的產出。

**項目清單**

1. **批次發佈只做立即發佈**（FEAT-8 spec FR-007）。§5.5 的 `publishChapterAction` 自 FEAT-4 起
   已同時支援立即與排程（`scheduledAt?`），**但批次化只取立即發佈那一半**：
   批次排程要再決定「整批共用同一時刻」或「依章號遞增」，以及對應的預覽與驗證，
   是另一個功能的份量；排程的操作頻率也遠低於發佈。作者仍走既有單章路徑排程。
   **批次下架與批次取消排程同樣不在本階段**。

2. **「N 章 → 一則通知」是本階段的硬需求**（FR-010／FR-011）。
   `notifyNewChapters(novelId, chapters[])`（`src/lib/services/notificationService.ts:46`）
   **本來就接受章節陣列並只產生一則通知**，指向章號最大者 —— 排程掃描路徑
   （`publishScheduledChapters`）即如此使用。**批次發佈 MUST 接到那條既有路徑上**：
   逐章呼叫 `publishChapter` 來湊出批次，會讓每位收藏者為同一次操作收到 N 則通知。
   通知 MUST 於整批寫入交易**之後**、以**單次**呼叫送出；
   本批實際由草稿轉為已發佈的章節數為 0 時 MUST NOT 送出任何通知。

3. **選取內的已發佈章節一律略過**（FR-008）。不重複寫入、不重複通知、於摘要計數。
   判準與 `publishChapter` 既有的「只有真的由草稿轉為已發佈才通知」完全相同。

4. **排程時刻於同一交易內清空**（FR-012）。含原本已排程者。
   理由與 §4.2 `Chapter.scheduledAt` 註一致：這一欄就是重複發佈的唯一防護，
   不清空的話下一次掃描會再選中同一章並再發一次通知。

5. **上架日期沿用單章語意**（FR-013）：首次發佈才寫入 `publishedAt`，
   下架後由批次重發者保留原值（`setChapterStatusRow` 已如此實作，直接沿用、不另寫）。

6. **空正文章節警告但放行**（FR-014）。FEAT-7 明訂空正文匯入是警告而非錯誤，
   故「整卷全選發佈」很可能混到空章節。阻擋整批會讓一章空白擋掉 999 章；
   自動略過會使發佈結果與作者的選取不一致。**放行 ＋ 確認畫面與結果摘要明示數量**
   是三者中唯一不騙人也不擋路的。

7. **批次刪除允許刪已發佈章節，但確認要比單章更強**（FR-015～FR-017）。
   限定「只能刪草稿」會逼作者先逐章下架再批次刪；沿用單章的單層按鈕確認又不夠 ——
   一次誤點的後果從 1 章變成整卷已發佈內容。故確認畫面 MUST 明示
   「將刪除 N 章，其中 M 章已發佈」並需一次明確的二次確認。
   **全為草稿時 MUST NOT 施加同等摩擦**（沿用 `NovelManageView` 刪除卷的既有判準：
   對低風險操作施加同等摩擦，只會讓作者學會無視所有確認步驟）。

8. **刪除的連帶範圍以既有級聯為準**（FR-019）：`ChapterContent` 與 `Comment` 隨章節刪除；
   **`ReadingProgress` 與 `ReadingHistory` MUST NOT 被連帶刪除** ——
   §4.2 `ReadingProgress.chapterId` 的註已寫明它刻意不設 Chapter 關聯
   （續讀點指向的章節消失不該連坐整筆進度）。**刪除後 MUST NOT 自動補正剩餘章號**：
   自動補號會讓讀者已知的章號整批位移；連號需求走既有的 `reorderChaptersAction`。

9. **兩項操作皆全有全無，計數重算一次**（FR-009／FR-018／FR-024）。
   `refreshNovelCounters` 與 `touchNovel` 於同一交易內**各呼叫一次**，
   **不是每章一次** —— 逐章重算 1000 次是 1000 次全表聚合。

   > **快取失效：發佈側與刪除側各一份，且皆在交易之外**
   > （analyze 第三輪補正 2026-08-23，findings C3）。
   > 兩者都要對本批每一章 `invalidateChapter(id)`，再 `invalidateNovel` 與
   > `invalidateNovelsList`，落點比照既有的 `publishChapter`（`chapterService.ts:225-227`）
   > 與 `deleteChapter`（`:245-247`）。
   > **原規劃只在發佈側寫了這件事**，刪除側於 plan、契約與 tasks 三處都沒有落點 ——
   > 症狀是已刪章節的頁面續留在快取中，而沒有任何測試會變紅。
   > 失效呼叫 MUST 留在服務層（`tests/unit/layering.test.ts` 的 T095 靜態稽核鎖死
   > 「`invalidate*` 的呼叫端只有 `lib/services/`」）。

10. **逐章擁有權驗證，任一不屬己即整批失敗**（FR-021／FR-022）。
    授權判定 MUST 早於任何寫入且與寫入同在一個交易內。
    回應與「找不到」逐字不可區分（§5.5「非擁有者一律 404」）。
    整合測試以「9 章屬己 ＋ 1 章屬人」的批次斷言**零變動**。

11. **單次上限 1000 章**（FR-005），對齊 Phase 16 的單次匯入上限；前端與伺服器皆判定，
    訊息含實際值與上限值。超限一律 400 `VALIDATION_ERROR`，
    **不新增 `ErrorCode`** —— 理由同 Phase 16（`ErrorCode` 與 `STATUS_BY_SERVICE_CODE`
    是同一型別的兩半，新增會波及所有端點）。

12. **選取限單一卷，切換卷即清空**（FR-002）。跨卷選取的風險是
    「作者看不到、卻仍在集合裡的章節被一起刪掉」。與批次匯入同為卷層級入口。

13. **成功清空選取、失敗保留選取**（FR-006）。失敗後清空等於要作者重新勾選上百個核取方塊。

14. **逾時處置沿用 Phase 16**（FR-026）：不自動重試，改重查該卷章節清單判定實際結果；
    查不到變化時措辭為「尚未看到變更」而非「操作失敗」。

15. **每次嘗試記一行結構化 stdout**（FR-028）：發起者、作品、卷、操作別、章節數、
    **章號區段**（clarify 第二場次補入，見第 24 項）、結果、耗時；
    成功與失敗皆記，**MUST NOT 包含章節標題或正文**。沿用 Phase 16 的 `chapterImport/log.ts` 手法
    （白名單組物件，不改 `logSecurityEvent`）。
    **輸出恰 10 欄** ＝ 上列入參 **8** 欄 ＋ 函式自填的 `event: 'chapter.batch'` 與 `at`
    （實作裁示 2026-08-23／FEAT-8 T007）。**此處 MUST NOT 抄 Phase 16 的「9 欄」** ——
    那是 `chapter.import` 的數字，其入參是 `fileCount`／`totalBytes` 等 7 欄；
    本 Phase 拿掉那兩欄、換上 `operation`／`chapterCount`／`ranges` 三欄。
    `specs/008-batch-publish-delete/` 的三份文件原本連同「9 欄／入參 7 欄」一起抄了過來，
    與它們自己宣告的介面互相矛盾，已於同輪一併更正；
    數字由 `tests/unit/chapterBatch-log.test.ts` 以 `Object.keys().sort()` 鎖死。
    **結果代碼 MUST 為字面量聯集且恰 8 個值**：`ok`／`notify_failed`／`unauthenticated`／
    `forbidden`／`not_found`／`validation_error`／**`conflict`**／`internal_error`
    （analyze 修正 2026-08-22，findings I1）。**原規劃只列 7 個而漏了 `conflict`**；
    漏掉的後果是交易衝突只能記成 `internal_error`，與「程式壞了」不可區分，
    第 24 項要的「足以回答結果如何」就不成立。

    > **`conflict` 的可達性依據與紀錄落點於 analyze 第二輪更正（2026-08-23，findings I2／I3／U3）**。
    > **原文寫的三件事都行不通**：
    > (a)「服務層的 `catch` 沿用既有的 `toServiceError`」—— 該函式是
    > `src/lib/services/chapterService.ts:80` 的**模組私有函式、未匯出**，新服務引用不到；
    > 其底層的共用 `translateDbError` **只認 `P2002` 唯一鍵衝突**，而本階段兩項操作
    > 都不寫 `Chapter.number`、也不新增列，**`P2002` 不可能發生** ——
    > 照原文實作，`conflict` 與 §5.5 的 409 會是**永遠不亮**的出口。
    > 正確來源是 **Prisma `P2034`（`TransactionWriteConflict`）**，
    > 由本階段自有的 `toBatchServiceError` 映射為 `CONFLICT`／409；
    > **MUST NOT 為此改動共用的 `translateDbError`**（會波及 9 個服務檔、24 個呼叫端）。
    > (b)「§5.5 該兩列的錯誤欄也含 409」—— **當時並不含**（原寫 `400 / 401 / 404`），
    > 已於同輪補上 409。
    > (c) 紀錄的呼叫落點原規劃在服務層 —— **未登入與角色不足由 `requireAuthorForAction()`
    > 在 Action 層擲出**（`src/lib/auth/guard.ts:130`），根本到不了服務層，
    > 那兩個出口會少記一行。落點 MUST 為 **Action 層**（與 Phase 16 的 route 入口同一層級），
    > 服務層改以回傳值把 `novelId` 交出來。
    > 併同更正：`volumeId` 欄的型別為 **`string | null`** ——
    > 它在**未經 Zod 的請求主體**內（不像 Phase 16 是路徑參數），
    > 身分／角色／格式三個出口取不到保證是字串的值；
    > 而**擁有權失敗那一行的 `actorId` 不是 `null`**（該判定在身分驗證之後，
    > 那一行少了它就答不出「誰動了別人的作品」）。

16. **「限單一卷」是伺服器端不變量**（FEAT-8 clarify 裁示 2026-08-22，spec FR-021a）。
    入參 MUST 指明一個卷，伺服器 MUST 驗證批次內每一章都屬於該卷；任一不屬即整批失敗，
    回應與擁有權失敗、「找不到」逐字不可區分（§5.5 該兩列已據此改寫）。
    **原本只寫在前端規則（FR-002）不夠**：前端的一個缺陷或直接呼叫端點，
    就能讓「全有全無」與「一批一則通知」跨到另一個卷去。

    > **落地方式：每一個寫入語句的 `where` 都帶 `volumeId`，不是一段前置檢查**
    > （analyze 第二輪補正 2026-08-23，findings C1）。
    > 規劃產出的契約原本**只有 `deleteChaptersBulk` 收 `volumeId`**，
    > `publishChaptersBulk` 沒有 —— 發佈側的卷歸屬因此只剩「候選查詢列數比對」這一段，
    > 而前置檢查是可以被漏掉的、`where` 條件不會。
    > 兩支 bulk 函式**皆 MUST 收 `volumeId` 參數**，與憲章第 II 條
    > 「所有寫入 query MUST 帶擁有者條件」（不可協商）一致。

17. **卷內章節數超過 1000 時，選取輔助動作停用**（FEAT-8 clarify 裁示 2026-08-22，spec FR-005a）。
    「全選本卷」「只選草稿」若會使選取數超過上限，該動作 MUST 停用並說明原因與實際章節數，
    停用原因 MUST 可被輔助技術讀出（沿用 §6.2「停用原因須可被輔助技術讀出」的既有判準）。
    **MUST NOT 截斷成前 1000 章**（「全選」名實不符），
    **MUST NOT 讓作者選出一個永遠送不出去的集合**（唯一出路是手動取消數百個勾選，
    正是本功能要消滅的操作量）。逐章勾選仍可用，勾到第 1001 章時由上限判定阻擋。

18. **無障礙：既有門檻之外追加三項斷言**（FEAT-8 clarify 裁示 2026-08-22，spec FR-030～FR-032）。
    §10 既有的 a11y 套件查得到「核取方塊有沒有名稱」，查不到批次 UI 特有的兩個風險，故追加：
    (a) 每個選取控制項的可辨識名稱 MUST 含**章號與標題**（一排無名稱差異的核取方塊，
    對讀螢幕的作者等於一排無法區分的「核取方塊」）；
    (b) 選取數變動 MUST 以即時區域播報；
    (c) 確認 MUST 為 modal、焦點移入與歸還受管理，且**第 7 項的警語
    MUST 是該確認的可及名稱或描述的一部分** —— 聽不到那句話，那道加強確認等於不存在。

    **(d) 上列三項 MUST 另有一條「鍵盤 only 走完整路徑」的 E2E，且 MUST 涵蓋
    「選取 → 批次發佈 → 確認」與「選取 → 批次刪除 → 二次確認」兩條**
    （*實作裁示（2026-08-23，T048a）*，依據 spec SC-010）。
    **為什麼 (a)(b)(c) 不夠**：那三項是**元件層**斷言，三者全綠仍證明不了整條路徑**走得完**
    （焦點逸出對話框、二次確認按不到、停用的控制項擋在中間，都不會讓它們變紅），
    而其餘的批次 E2E 一律以點擊操作。**為什麼一條不夠**：發佈側的確認畫面
    沒有二次確認步驟、Tab 序也不同，刪除那一條走得完**不蘊含**發佈那一條走得完。
    落點為 `tests/e2e/a11y-flow.spec.ts`（同一案內依序走完兩條）。

19. **「正文為空」的判定基準為字數 0**（FEAT-8 clarify 裁示 2026-08-22，spec FR-014a）。
    沿用 `countWords`（`src/lib/validation/common.ts`：去除所有空白後的字元數），
    **MUST NOT 另訂第二套判定**。章節管理畫面本來就顯示每章字數
    （`AuthorManageChapter.wordCount`），據此判空不需額外讀取正文；
    另訂基準（去空白後比對空字串、或以位元組數判定）等於為同一個問題留兩份會漂移的答案 ——
    FEAT-7 的教訓（解析規則 MUST 為單一純函式）在此一體適用。

20. **確認畫面 MUST 給章號區段而非只給數量**（FEAT-8 clarify 裁示 2026-08-22，spec FR-025a）。
    連續章號合併為區段呈現（例：「第 1–150、第 200–210 章，共 161 章，其中 35 章已發佈」），
    刪除的確認 MUST 一併說明**不可復原**。**只給數量擋不住「選錯範圍」**：
    作者以為選的是第 201–400 章、實際選到第 1–200 章時，兩者的數字一模一樣；
    而 1000 列的逐章清單無法掃視，等於沒有給。

21. **「本批實際由草稿轉為已發佈」以條件更新的影響列數判定**
    （FEAT-8 clarify 第二場次裁示 2026-08-22，spec FR-010a）。
    **MUST NOT 以讀取時的狀態快照判定**：`publishDueScheduled` 與批次發佈可能同時碰到同一章
    （該章排程在幾分鐘後，作者卻先按了批次發佈），快照判定會把掃描剛發佈的那章也算進本批，
    收藏者收到**兩則**通知、摘要數字也虛報。手法沿用 cron 路徑既有的
    `publishScheduledChapterRow` —— 條件更新後看影響列數，0 列即不計入本次。
    被對方搶先的章節不計入、**不報錯**，MUST NOT 因此讓整批失敗。

22. **通知失敗 MUST NOT 讓已完成的發佈回報為失敗**
    （FEAT-8 clarify 第二場次裁示 2026-08-22，spec FR-010b）。
    通知在整批寫入交易之後送出；建立失敗時，摘要 MUST 如實顯示「已發佈 N 章」
    並**另外標示「追更通知未送出」**，記入伺服器紀錄，**不自動重試**。
    **回報成整批失敗會誘導作者重送**，而第二批會因章節都已發佈而被全數略過
    （0 發佈、0 通知）——收藏者反而永遠收不到。

23. **確認畫面與結果摘要的章號區段呈現**
    （FEAT-8 clarify 第二場次裁示 2026-08-22，spec FR-025b／FR-027a）。
    結果摘要 MUST 同樣以章號區段**指名被略過的章節與空正文章節**，MUST NOT 只給數量 ——
    「已發佈 197 章、略過 3 章」看不出那 3 章是被排程掃描搶先（沒事）還是選錯了範圍（有事）。
    區段數很多時 MUST **全部列出**於可捲動容器，**MUST NOT 設門檻、摺疊或截斷**：
    區段本身已是壓縮，截斷等於把錯誤藏進被截掉的那一段，且門檻數字沒有非任意的定法。

24. **結構化紀錄 MUST 含章號區段**（FEAT-8 clarify 第二場次裁示 2026-08-22，spec FR-028a）。
    第 15 項的欄位清單據此擴充為「發起者、作品、卷、操作別、章節數、**章號區段**、結果、耗時」。
    **只記章節數不夠**：批次刪除不可復原，事後要回答「這批刪了哪幾章」時紀錄是唯一線索，
    而「刪了 200 章」答不出這個問題。章號既非標題也非正文，不觸及該項的排除範圍，
    且區段壓縮後長度可控（整卷連續 1000 章只佔一段）。

25. **條件更新 MUST 用 `updateManyAndReturn`，MUST NOT 用「先 `findMany` 再 `updateMany`」**
    （FEAT-8 plan 裁示 2026-08-22，`research.md` R-2）。
    第 21 項只說了「以影響列數判定」，**但通知還需要知道是哪幾列**（要指向章號最大者）。
    `updateMany` 只回 `{ count }`；「先查再更新」則在兩語句之間留下時間窗 ——
    排程掃描可在窗內發佈同一章，此時 `count` 會小於候選數，
    而**哪幾章被搶先是無從得知的**，只能在「整批失敗」（第 21 項明文禁止）
    與「猜一個集合去發通知」之間二選一。`updateManyAndReturn` 把兩件事收斂成同一個語句。
    **可用性已就地驗證（2026-08-22）**：`src/generated/prisma/models/Chapter.ts:1311` 有其型別，
    而該產出來自 **SQLite 軌**（`prisma/headers/sqlite.prisma`）——
    Prisma 對不支援的 provider 直接不產生該方法，**它存在即證明 SQLite 支援**；
    PostgreSQL 本就在支援清單內。無雙軌分歧點。
    另：**`in` 子句 MUST 分批送出，每批至多 500 個識別碼**
    （實作裁示 2026-08-23／FEAT-8 T014）。**原文寫「1000 個 bind 參數已於 SQLite 3.53.2
    實測通過（32766 才是上限），`in` 子句不必分批」是錯的** —— 那量到的是**原生 SQLite**
    的上限，而擋下這件事的是 **Prisma 自己的守衛**：Prisma 7.9 對 SQLite 軌的單一查詢
    參數數量設有上限，超過即擲 **`P2029`（`The query parameter limit supported by your
    database is exceeded`）**。本 Phase 上界為 1000 章，而每一句的 `where` 還多帶
    `volumeId`（發佈側再加 `status`）—— **1000 個識別碼必然超限**，
    已於 `tests/integration/chapter-batch-publish.test.ts` 的上界案例實測擲出 `P2029`。
    分批 **MUST NOT 改變語意**：全部批次都在**同一個交易**內，全有全無不變；
    每一批仍是「判定與取值同一個語句」（本項禁的是拆成 `findMany` ＋ `updateMany` 兩句，
    不是禁止分批）。候選查詢分批後 **MUST 於合併後重新依 `number` 排序** ——
    每一批各自有序不等於全體有序。500 而非 999：PostgreSQL 軌上限（65535）遠高於此，
    取一個兩軌都寬裕的值，就不必為 provider 差異在資料存取層分岔。

26. **`publishedAt` 對齊 `setChapterStatusRow`，MUST NOT 照抄 `publishScheduledChapterRow`**
    （FEAT-8 plan 裁示 2026-08-22）。這兩支既有函式對該欄的處置**本來就不一致**：
    前者首發才寫、重發保留原值（`repositories/chapters.ts:259`），
    後者無條件寫入 `now`（`:435`）。第 5 項要的是前者，
    故批次發佈 MUST 依 `publishedAt` 是否為 `null` 分**兩次**條件更新
    （首發組寫入日期、重發組不寫），兩組的 `where` 皆帶 `status='draft'` 故互斥。
    **後者的不一致不在 Phase 17 範圍，不修**（憲章「變更範圍」：不順手改未壞的相鄰程式碼），
    但在此記下，以免下一個人照抄。

27. **兩項操作的交易 MUST 傳入 `{ timeout: 30_000, maxWait: 5_000 }`**
    （analyze 第二輪補正 2026-08-23，findings U1）。
    值與 Phase 16 的匯入交易（`chapterImportService.ts:264`）相同。
    **MUST NOT 依賴預設值**：Prisma 互動式交易預設 **5 秒**，
    而本 Phase 明訂 1000 章的上界壓測要「在交易 timeout 內完成」——
    照預設值寫，那一案必然紅。規劃階段的 research R-5 已裁示要傳，
    **但它沒有落到任何一個任務或介面上**，等於沒裁示；此處補上確切的值。

28. **本 Phase 必須動到兩支既有測試資產，且它們是交付的前提而非附帶**
    （analyze 第三輪補正 2026-08-23，findings C1／C2）。
    **原規劃把「既有檔案改動」列為 4 處，全部是 `src/` 下的檔案，一支測試也沒算進去** ——
    同一個盲點漏了兩件性質不同的事：

    | 檔案 | 改動 | 不改的後果 |
    |---|---|---|
    | `tests/integration/author-role-guard.test.ts` | `EXPECTED_ACTIONS` 由 **14** 增為 **16**，並補兩個新 Action 的樣本入參 | 該檔以 `found.sort()` **逐字比對** `actions.ts` 的匯出集合，新增 Action 的當下 `npm run test:integration` **立刻紅**，且紅的是一支與本功能無關的既有測試（憲章第 IV 條） |
    | `tests/helpers/serverLog.ts` | 新增 `BatchLogRecord` 與 `waitForBatchLogs`（`event: 'chapter.batch'`；`volumeId` 為 `string \| null`；支援 `volumeId` 或 `since ＋ operation` 兩種過濾） | 既有 `waitForImportLogs` 只認 `chapter.import`、其 `volumeId` 是必填 `string`。第 15 項的紀錄斷言**沒有任何讀取路徑**，最後會被降級成「只驗資料庫」 |

    **併同裁示：整合測試的受測層級分兩種，選錯的那一案等於沒寫。**
    資料庫效果、通知則數、計數重算、全有全無 → **服務層直呼**
    （沿用 `author-write-ownership.test.ts` 的先例）；
    **結構化紀錄的任何一欄、未登入 401、角色不足 403 → MUST 經
    `callAction`（`tests/helpers/serverAction.ts`）打真實 Action 端點** ——
    第 15 項把紀錄放在 Action 層、`requireAuthorForAction()` 也在那一層，
    **服務層直呼永遠到不了那三類斷言**。
    該路徑另有一個前置：**Next 只把「被 client component 實際引用」的 Server Action
    註冊進 `.next/server/server-reference-manifest.json`**，
    而 `callAction` 由匯出名反查該檔 —— 故那些測試案 MUST 排在
    「`NovelManageView` 掛上批次操作列」之後。

**本階段 schema 增量為零**：寫的都是既有欄位（`status`／`publishedAt`／`scheduledAt`）
與既有的刪除級聯，不新增 migration。

**實作切分（四刀，順序即相依）**：8-A 純函式與其單元測試 → 8-B 伺服器寫入路徑與整合測試 →
8-C 前端選取面與無障礙 → 8-D E2E 與文件回寫。8-B 完成時功能已可由整合測試證明成立。
規劃產出見 `specs/008-batch-publish-delete/`（`plan.md`／`research.md`／`data-model.md`／
`contracts/`／`quickstart.md`）。**不新增任何套件、不新增 migration。**

**執行紀錄**

| 日期 | 範圍 | 結果 |
|---|---|---|
| 2026-08-23 | tasks Phase 1＋2（Setup ＋ Foundational：`chapterBatch/ranges.ts`、`chapterBatch/log.ts`、`validation/chapterBatch.ts`、`getVolumeChaptersByIds`、`chapterBatchService` 的共用守衛與 `toBatchServiceError`、`Modal` 焦點兩項、`waitForBatchLogs`） | 完成 |
| 2026-08-23 | tasks Phase 3（**US1 批次發佈**：`publishChaptersBulk`、`publishChapters`、`publishChaptersAction` ＋ Action 層 `logBatchEvent`、`BatchActionBar`／`NovelManageView` 選取面） | 完成。`npm run test` 39 檔／**572** 案、`npm run test:integration` 81 檔／**649** 案、`npm run test:a11y` 5 檔／**50** 案全綠；`MAIL_MODE=console npm run build`、`npm run lint`、`npx tsc --noEmit` 三綠。新增 `tests/integration/chapter-batch-publish.test.ts`（14 案，含一批一則通知、100 章 5 秒、1000 章上界、交易內失敗回復、通知失敗經 Action 端點驗紀錄）。`author-role-guard.test.ts` 的 `EXPECTED_ACTIONS` 同批由 14 增為 **15**（`publishChaptersAction`；`deleteChaptersAction` 隨 Phase 4 加入後為 16） |
| 2026-08-23 | tasks Phase 4＋5（**US2 批次刪除** ＋ **US3 授權邊界**：`deleteChaptersBulk`、`deleteChapters`、`deleteChaptersAction`、刪除確認與二次確認、兩側未登入 401／角色不足 403 與跨作者整批拒絕） | 完成。`EXPECTED_ACTIONS` 同批由 15 增為 **16**（加入 `deleteChaptersAction`）。新增 `tests/integration/chapter-batch-delete.test.ts`（含 100 章 5 秒、1000 章級聯上界、交易內失敗回復、快取失效與發佈側對稱） |
| 2026-08-23 | tasks Phase 6＋7（**US4 選取輔助與結果摘要** ＋ 收尾：三個輔助動作與其超限停用、逐章勾選上限阻擋、摘要章號指名、a11y 三項斷言、E2E 五條、文件回寫） | 完成。`npm run test` 39 檔／**572** 案、`npm run test:integration` 83 檔／**673** 案、`npm run test:a11y` 6 檔／**54** 案、`npm run test:e2e` **18** 案（chromium 四流程 ＋ 讀者流的 firefox／webkit）全綠；`MAIL_MODE=console npm run build`、`npm run lint`、`npx tsc --noEmit`、`npm run format:check` 全綠。**Phase 17 的 28 項全部交付** |

**Phase 6＋7 產生的兩項裁示**（詳見 `specs/008-batch-publish-delete/tasks.md` 各任務的「執行結果」）：
第 18 項補入 **(d)**「鍵盤 only 的完整路徑 E2E，且兩條都要走」（本節上方已就地補入）；
逾時的 E2E **拆成兩案**（「伺服器已成功、回應遲到」與「請求尚未送達、章節毫無變化」
是兩種不同的伺服器狀態，同一案製造不出來，而 FR-026 只對後者訂了逐字文案）。
**併同記下一件實測**：`router.refresh()` 與尚未結算的 Server Action 共用同一條 React transition，
故逾時當下的重查結果**不保證**在回應抵達前繪出 —— 該案因此斷言
「逾時分支的兩種措辭之一出現、且不出現『操作失敗』」＋「最終訊息與資料庫一致」，
**MUST NOT 寫死成「重查後已看到 N 章」**（那會是一個看時序運氣的紅燈）。

**Phase 3 產生的三項裁示**（詳見 `specs/008-batch-publish-delete/tasks.md` 各任務的「執行結果」）：
第 25 項的 `in` 子句分批（本節上方已取代原文）；
Action 層 MUST 自未經驗證的入參安全讀出 `volumeId`／`chapterCount`，否則第 15 項那兩欄
在每一個失敗出口都只能是 `null`／`0`；「全有全無」的失敗注入 MUST 落在**交易內**，
由外部（跨卷章節）製造的失敗全部發生在交易之前，證明不了交易邊界。

### Phase 18 管理者後台（Admin Dashboard）

> **FEAT-9 新增（2026-09-03，對應 GitHub issue #15）**。規格見 `specs/009-admin-dashboard/`。
> **背景**：現行全站對 `admin` 角色僅在三處當作 `author` 的同義詞，無任何 `/admin` 路由與專屬後台。
> 示範帳號 `admin@novelsite.tw` 在上線前必須清空（Issue #7），正式環境需要不依賴 seed 的管理員產生管道。
> 本階段建立獨立管理者防禦邊界，落地使用者治理、違規內容管理、標籤治理、營運統計儀表板與稽核留痕。
>
> **✅ 完成紀錄（2026-09-03，Phase 1 至 Phase 8，T001～T056）**：全數交付並通過各項綠燈閘門（`npm run build`、`npm run lint`、`npx tsc --noEmit`、`npm test` 573 案全綠、整合測試 5 檔 78 案全綠、無障礙測試 6 案全綠）。
> 核心交付成果：
> 1. 三層防線架構（`proxy.ts` 路由攔截、`guard.ts` 權限覆核、Server Action 獨立守衛）與速率限制（每位管理員 60 次/分鐘，超限自動記下 `admin.rate_limit_exceeded` 稽核日誌）。
> 2. 正式環境管理員帳號提升工具（`npm run admin:promote <email>`）與維運手冊更新。
> 3. 使用者停權與角色變更機制（附帶 Session 即時撤銷與自我降級/最後管理員防呆）及 15 分鐘一次性重設連結生成。
> 4. 作品與章節違規下架（`admin_suspended` 狀態，阻絕作者單章與批次公開發佈）與硬刪除字數及章節數原子性重算。
> 5. 標籤治理（新增、更名、去重合併關聯轉移、`searchText` 同步重建、強制刪除作品關聯清理）。
> 6. 營運統計儀表板（全站指標概覽卡片、7/30 天台北日對齊趨勢折線圖、分類分佈長條圖）與安全稽核留痕（純追加無修改/刪除出口，90 天前 IP SHA-256 不可逆雜湊化）。
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

**核心架構決策（2026-09-03 `/speckit-specify` 裁示）**：

1. **獨立管理者邊界守衛**：
   - 路由攔截層（`proxy.ts`）受保護路徑擴充納入 `/admin` 及 `/admin/*` 前綴，非 admin 角色（`reader` / `author`）存取一律重導向或拒絕，並寫入 `authz.denied` 安全紀錄。
   - `guard.ts` 新增 `requireAdmin()`（頁面導航轉址）與 `requireAdminForAction()`（Server Action 專用 403 例外守衛）。
   - 伺服器端每次驗證 MUST 覆核資料庫 `User.role === 'admin'` 與帳號未停權，不依賴用戶端快照。

2. **正式環境首位管理者產生管道**：
   - 交付專用 CLI / npm 維運指令 `npm run admin:promote <email>`，供主機維運者直接在終端安全提權指定已註冊使用者，徹底排除對 seed 帳密的依賴，並載入 `deploy/deployment.md`。

3. **使用者管理與停權防呆**：
   - 使用者模型（`User`）擴充 `isSuspended Boolean @default(false)`。
   - 停權（`suspendUserAction`）時於同一交易內撤銷該使用者全部現存 Session（`Session.revokedAt = now`）。
   - 角色變更（`changeUserRoleAction`）時亦撤銷舊 Session。
   - **管理者自我防呆**：伺服器端強制檢查禁止管理者停權或降級自身帳號；當全站啟用中 admin 人數為 1 時，禁止降級或停權最後一位 admin。

4. **書籍與內容管理（下架 vs 刪除語意）**：
   - 作品模型（`Novel.status`）值域擴充 `admin_suspended`（管理員違規下架）。
   - 進入 `admin_suspended` 狀態之作品，公開區域（搜尋、分類、排行、作品詳情頁）一律回傳 404 或排除；作者管理端標註「已被管理員下架」且無法單方面改回公開。
   - 實體刪除違規章節時，於同一交易內重算所屬作品之章節數與總字數，並使關聯快取失效。
   - 違規留言處置支援隱藏（`status='hidden'`）與刪除（`status='deleted'` 墓碑，保留討論串階層）。

5. **標籤治理與去重合併**：
   - 支援標籤新增、更名（slug 與 name 唯一性檢查）與安全刪除（未關聯作品）。
   - 支援標籤合併（`mergeTagsAction`）：將關聯「源標籤」之所有作品轉移至「目標標籤」，作品已具備目標標籤者自動去重，轉移完成後安全刪除「源標籤」，並於交易內更新關聯作品之 `searchText` 與快取。

6. **營運統計儀表板**：
   - 後台首頁儀表板展示關鍵指標概覽卡片（全站使用者數、作品數、章節與字數）。
   - 展示近 7 天 / 近 30 天全站去重瀏覽人次趨勢、每日註冊趨勢、每日留言互動趨勢，優先自既有 `NovelDailyStat` 彙總查詢，避免全表掃描。

7. **關鍵操作稽核留痕（Audit Log）與安全防護**：
   - 新增 `AuditLog` 資料表：記錄 `actorId`（純 User ID，不存 Email 明文以保護 PII）、`action`（`user.suspend` / `user.role_change` / `novel.admin_suspend` / `chapter.admin_suspend` / `chapter.delete` / `tag.merge` / `admin.rate_limited` 等）、`targetType`、`targetId`、`diff`（JSON 字串）、`reason`（≤200 字，破壞性操作必填）、`ip`、`createdAt`。
   - **`diff` 的內容規格（2026-09-06 補）**：`tag.delete` 與 `tag.merge` MUST 一併寫入 `affectedNovelIds`（受影響作品 id 陣列；超過 500 筆截斷並標記 `truncated: true`）。只記 `affectedNovelsCount` 時，事後查不出是哪幾部作品受影響，而這兩個動作皆不可逆（`Tag.id` 為 cuid，重建同名標籤是新 id）。
>
> **2026-09-06 篩選失效修正（UI 重構同批）**：四個管理列表頁（使用者／作品內容／標籤／稽核）
> 的搜尋與篩選按下去畫面不動。**伺服器端從來沒壞** —— `/admin/users?search=X` 一直回傳
> 正確的過濾結果；壞的是瀏覽器裡那一段：四個表格元件都把 `initial*` props 複製進
> `useState` 以支援操作後的樂觀更新，而 `useState` 的初始值只在**掛載當下**取一次。
> `router.push` 換了查詢字串後，RSC 重新算過、props 也換了，但元件實例沒被重建，
> 畫面就停在舊清單。
> **修法**：頁面層對表格元件加上隨篩選條件變動的 `key`，強制重建（篩選輸入框本身也由
> `useSearchParams()` 初始化，一併重建才不會出現「輸入框顯示 A、清單是 B」的中間態）。
> **為何整合測試抓不到**：整合測試直接對伺服器發 HTTP，不經過瀏覽器導覽，
> 這個 bug 在那一層是隱形的。故新增 E2E `tests/e2e/admin-flow.spec.ts`（5 案）作為回歸防線，
> 並實際驗證過：拿掉 `key` 後該檔立刻紅（搜尋後預期 1 列、實得 16 列）。
>
> **2026-09-06 第二輪修正：`key` 重建改為 props 同步 + 搜尋去抖**。
> 前一版用 `key` 強制重建修好了「篩選沒反應」，但引入新症狀：作品內容管理與標籤治理的
> 搜尋框**每打一個字就失去焦點**，得用滑鼠點回去才能繼續打 —— 那兩個頁面的搜尋是
> `onChange` 直接 `router.push`（邊打邊搜），於是每個字元都觸發一次導覽 + 一次重建。
> **修法兩件**：
> (a) `useSyncedList`（`src/components/admin/useAdminList.ts`）在**渲染期間**比對 props
>     身分並重設本地清單（React 官方的 Adjusting state when a prop changes），
>     **不重建元件**，焦點與捲動位置都留得住。MUST NOT 改回 `useEffect` + `setState`：
>     那會多一次「舊資料畫一遍再重畫」的閃爍，且被 `react-hooks/set-state-in-effect` 擋下。
> (b) 搜尋輸入加 300ms 去抖（`useDebouncedCallback`）。實測三個字元的輸入，
>     去抖前送出 **3 次** RSC 請求、去抖後 **1 次**。
>
> **測試上的誠實註記**：焦點掉落**無法用 Playwright 重現** —— 合成按鍵不經過中文輸入法的
> 組字流程，而焦點正是在組字中途被 `router.push` 打斷才掉的；實測「每鍵導覽 + key 重建」
> 的壞組態下，合成輸入的焦點依然留在 INPUT。故 E2E 的判別點改為**請求次數**
> （`framenavigated` 也不行：兩種組態都只算到 1 次）。該斷言已驗證會在移除去抖時變紅
> （預期 1 筆、實得 3 筆）。
>
> **同批的 UI 重構根因**：admin UI 引用的 402 個 CSS 變數中 **278 個（69%）指向不存在的
> token**（`--space-md`、`--color-text-primary`、`--color-bg-surface` 等），每個 padding
> 與文字色都解析成空值 —— 版面塌掉是**樣式根本沒套用**，不是設計不好看。已全部改用專案
> 實際的 token。圖表另有兩項硬性錯誤一併修正：趨勢圖的左右雙 Y 軸拆成兩張單軸圖
> （兩線交叉點原本只是刻度縮放的巧合），序列色由寫死 hex 改為 `--viz-series-1/2` token。
   - 關鍵管理操作完成後立即寫入稽核記錄；記錄採純追加與不可竄改（Append-only & Immutable）原則，管理介面絕不提供任何刪除或修改端點。來源 IP 於 90 天後自動不可逆雜湊化（Clarification 2026-09-03）。
   - 全後台 API 與 Action 實施統一速率限制（每位管理員 60 次/分鐘，FR-028）。
   - 密碼重設支援「寄送重設信」與「產生一次性重設連結（15 分鐘 TTL）」雙軌交付（Clarification 2026-09-03）。

**Schema 變更**：
- `User` 新增 `isSuspended Boolean @default(false)` 與 `suspendedAt DateTime?`，建立索引 `@@index([isSuspended])`
- `Novel.status` 與 `Chapter.status` 擴充支援 `admin_suspended`（管理員違規下架/封存，作者無法自行發佈）
- 新增 `AuditLog` 模型（純追加、無外鍵級聯）
- SQLite 與 PostgreSQL 雙軌 migration

**實作切分（五刀，順序即相依）**：
- 9-A 權限邊界、管理員產生 CLI 與速率限制（`proxy.ts`、`guard.ts`、`rateLimit.ts`、`admin:promote` 腳本）
- 9-B 資料層擴充與 Schema Migration（`isSuspended`、`suspendedAt`、`AuditLog` 表、狀態擴充、雙軌 migration）
- 9-C 使用者管理與防呆（服務層、Action、後台使用者管理介面、一次性密碼重設）
- 9-D 內容審查與標籤治理（作品/章節下架與復權、章節留言處置、標籤合併去重）
- 9-E 統計儀表板與稽核日誌檢視（趨勢圖表、指標聚合、審計日誌列表、空態/載入態、文件回寫）

---

### Phase 19 作品管理頁面的卷內章節瀏覽（Volume Chapter Scroll）

> **FEAT-10 新增（2026-09-06）**。規格見 `specs/010-volume-chapter-scroll/`。
> **背景**：作品管理頁把**每一卷的每一章**都攤在同一頁。一部 200 章的作品，
> 頁面高度隨章節數線性成長，作者要看第 5 卷的卷名得先捲過前四卷的所有章節。
>
> **本階段是純前端改動**：**零 migration、零 Server Action、零新套件、零資料存取層改動**。
> 只動六個既有檔案（`NovelManageView.tsx`、`NovelManageView.module.css`、
> `SiteHeader.module.css`、`StaticPage.module.css`、`AccountSettingsView.module.css`、
> `SearchView.module.css`）並新增四支測試。
>
> **實作切分（三塊，順序即相依）**：
> - **10-A 全站 CSS 變數閘門**（FR-017～FR-019）：本頁的文字與表面色階**當時完全沒生效**——
>   24 處 `var()` 指向不存在的 token（`--color-text-primary` 等），整條宣告被丟棄，
>   畫面上看到的是繼承色而不是任何錯誤。**先立閘門再疊功能**：在沒生效的色階上疊摺疊列與
>   捲動容器，做出來的東西看起來會像沒做。閘門為**兩個值**，見 §10.2。
> - **10-B 卷摺疊與卷內捲動**（FR-001～FR-016）：卷標題列成為 `<button aria-expanded>`
>   摺疊控制（與既有的「新增章節」是**彼此獨立**的互動點）；收合狀態顯示章數與已發佈／草稿數；
>   單卷預設展開、多卷預設全收合且**不再重算**；展開後章節清單包在
>   `max-height: min(60dvh, 30rem); overflow-y: auto` 的容器內，
>   容器帶 `tabIndex={0}` 與 `aria-label`（**Chromium 與 WebKit 不會自動讓可捲動 `<div>` 可聚焦，
>   Firefox 會**——少了它就是在 Firefox 上測全綠、其他瀏覽器的鍵盤使用者完全捲不動）。
>   移動章節後以 `scrollIntoView({ block: 'nearest' })` 把該章捲回可視範圍。
>   **`selection` 的資料來源仍是 `volume.chapters` 完整陣列**，MUST NOT 改成可見子集。
> - **10-C 作品資訊表單的重填時機**（FR-020）：伺服器端會 `trim()`、表單狀態不會，
>   存了「` 標題 `」之後畫面仍顯示未修剪的值。修法是「**只有本表單自己送出成功才以新 props 重填**」——
>   `run()` 因此加了一個**可選的成功回呼**參數（其餘四個區塊不傳、行為不變）。
>   **MUST NOT 改成「props 一變就重填」**：本頁其他操作也會 `router.refresh()`，
>   那會在作者打字打到一半時清掉輸入——用一個空白字元的問題換一個資料遺失的問題。
>
> **✅ 完成紀錄（2026-09-06，`specs/010-volume-chapter-scroll/tasks.md` T001～T036）**：
> 靜態檢查（`tsc`／`lint`／`format:check`）全綠；單元 41 檔 **585 案**全綠（含兩支新增掃描）；
> a11y 8 檔 **76 案**全綠（含 `tests/a11y/volume-collapse.test.tsx` 16 案）；
> E2E `tests/e2e/volume-scroll.spec.ts` **9 案**全綠；`MAIL_MODE=console npm run build` 綠。
> 手動驗證（真實 Chromium 逐項量測）26 項中 **24 項通過**，兩項未達標**皆不在本階段的六個檔案內**：
> **SC-002**（第 5 卷標題列 bottom 2138px > 1600）——章節區自身只有 335px，
> 起點卻已在 y=1828（作品資訊 1009px ＋ 分卷 521px），要達標只能改章節區以外的版面；
> **SC-007 的整頁橫向捲動**（375px 下 `scrollWidth 427`）——來源是 `AuthorSidebar` 的水平導覽，
> 該卷收合與展開時完全相同。兩者皆為既有問題，已回寫 spec 並列為另案。
>
> **同批一併修正的一處**：搜尋建議的鍵盤高亮（`.suggestion--active`）。
> 規格原本認為把 `var(--color-bg-subtle, var(--color-bg))` 換成 `var(--color-muted)` 即可，
> **實測推翻**：`--color-muted` 壓下拉本體 `--color-surface` 只有
> **1.13:1／1.03:1／1.06:1**（light／dark／eyecare），遠低於 WCAG 1.4.11 對非文字 UI 狀態的 3:1，
> 換哪一個底色 token 都一樣。已另加 `outline: 2px solid var(--color-accent)`
> （實測 3.19:1／8.08:1／4.01:1），與全站 `:focus-visible` 的樣式一致。

---

## 10. 驗證與測試計畫

> 對應全域規範「先定義成功條件，再迴圈驗證至通過」。專案目前**無任何測試**（N-7），本節為從零建立。

### 10.1 工具

| 層級 | 工具 | 指令 |
|------|------|------|
| 單元 | Vitest（**node 環境**，`tests/unit/**`） | `npm run test` |
| 整合（API/Action + 真實 DB） | Vitest + 獨立測試資料庫（每檔前清空認證域，見 §10.3）+ **正式建置產物**（`next build` → `next start` 於測試連接埠，見 §10.3 註記） | `npm run test:integration` |
| E2E | Playwright | `npm run test:e2e` |
| 靜態 | tsc / ESLint / Prettier | `npx tsc --noEmit`、`npm run lint`、`npm run format:check` |

> **`.prettierrc` 的 `endOfLine` 自 `lf` 改為 `auto`，且全庫重跑一次 `prettier --write`**
> （*裁示（2026-08-15，T046 收尾）*）。
>
> **為什麼原文行不通**：`format:check` 於本階段首次納入 CI 閘門（FR-087），實測發現它
> **在乾淨 checkout 上是紅的**，而且是兩個互相遮蔽的原因疊在一起：
>
> 1. **內容真的沒格式化**——以版控內容（LF）實測，**84 個檔案**與 Prettier 3.9.5 的輸出不同
>    （多為 Prettier 升版後的換行策略差異，如 `src/lib/siteConfig.ts` 的 `.replace()` 斷行）。
>    先前沒人發現，是因為第 2 點讓本機的檢查結果永遠是「幾乎全紅」，看起來像雜訊。
> 2. **`endOfLine: "lf"` 與本機的 `core.autocrlf=true` 直接相斥**——工作區是 CRLF，
>    於是本機 `npm run format:check` **每一個檔案都紅**，紅的原因與內容無關。
>    這使得這道檢查在本機**不具任何鑑別力**，開發者只會學會忽略它。
>
> 改為 `auto` 後：本機（CRLF）與 CI（Linux checkout，LF）**比的都只有內容**，兩邊結果一致。
> 換行字元本身另有更精確的守則——`.gitattributes` 已把「會被 Linux 直接執行的檔案」
> （`*.sh`、`deploy/cron/crontab`）鎖為 `eol=lf`，那才是換行真正會出事的地方
> （FEAT-6 T041 實測：`set -eu
` 讓 busybox 回 `illegal option -`）。
> **MUST NOT 為了讓 `format:check` 管換行而把 `endOfLine` 改回 `lf`**——
> 那會換回一道本機恆紅、因此沒有人看的檢查。
| 無障礙 | 自動化 a11y 檢查（Phase 9 範圍：**本階段新增／修改的頁面**，全站稽核屬 Phase 13） | `npm run test:a11y` |
| **子路徑（FEAT-6 新增，2026-08-13；已交付 2026-08-15）** | Vitest + **帶 `NEXT_PUBLIC_BASE_PATH` 的正式建置產物**，只驗四件框架管不到的事：首頁可達、未登入轉址目的地帶前綴、頁面資料請求可達、工作階段憑證路徑範圍 | `npm run test:basepath` |

> **首頁案例的期望值更正為「`/novelsite` → 200」**（*T028 實作裁示（2026-08-15）*）：
> 契約 `contracts/internal-modules.md` §5 原寫 `GET {base}/novelsite/ → 200`，
> 但**帶尾斜線的實測結果是 308**——Next 的尾斜線正規化會把 `/novelsite/` 轉到 `/novelsite`。
> **原文行不通的原因**：站台是好的，錯的是期望值；照原文寫死 200 會讓這個案例
> 從第一天就是紅的，而一個一開始就紅的案例最後一定是被放寬而不是被修好。
> 尾斜線那一版保留為同案例的第二個斷言（驗 308 的目的地**帶前綴**），
> 因為正規化轉址同樣經過 FR-073 那條路徑。

> **第五套為何獨立、不參數化進整合套件（FEAT-6 裁示，2026-08-13）**：`basePath` 是**建置期常數**，
> 驗它必須有一份帶前綴的建置產物；把它塞進整合套件等於改動該套件的 globalSetup，
> 與規格 FR-078a／SC-019「既有四套在不設前綴時通過數與行為完全不變」直接相斥。
> **MUST NOT 與整合、a11y 兩套並行**：三者共用建置產物目錄與測試資料庫，
> 帶前綴的建置覆蓋同一份產物時，症狀是「另一套測試莫名其妙開始失敗」，而原因不會指向這裡
> （同下方「三個 vitest 設定檔」註記的既有理由，本次由三套擴為四套）。

> **四個 vitest 設定檔各司其職**，MUST NOT 合併（原文「三個」於 FEAT-6 擴為四個，2026-08-13）：
>
> | 設定檔 | environment | `resolve.conditions` 含 `react-server` | include | globalSetup |
> |---|---|---|---|---|
> | `vitest.config.mts`（單元） | `node` | **必須** | `tests/unit/**` | 無 |
> | `vitest.integration.config.mts`（整合） | `node` | **必須** | `tests/integration/**` | 共用 |
> | `vitest.a11y.config.mts`（a11y） | `jsdom` + React plugin | **不得** | `tests/a11y/**` | 共用 |
> | `vitest.basepath.config.mts`（子路徑，FEAT-6 新增） | `node` | **必須** | `tests/basepath/**` | **專屬**——以 `NEXT_PUBLIC_BASE_PATH` 建置，故不可共用 |
>
> - **分立的根本理由是解析條件無法兩全**（規格審查第五輪更正）：`server-only` 的 `exports`
>   **只有** `react-server` 一個條件解析到空模組，其餘一律是主動擲錯的進入點 —— Vitest 的
>   **node 與 jsdom 環境都不套用該條件，兩者同樣會擲錯**。原先寫的「jsdom 才會擲錯、改用 node
>   即可迴避」並不成立。正解是：引用 `repositories/*` 的套件（單元、整合）於設定檔補上
>   `resolve.conditions: ['react-server', …]`；而 a11y **不得**補（`react` 也宣告該條件，補了會
>   解析到不含 `useState` 等用戶端 Hook 的伺服器版本，React Testing Library 直接無法渲染）。
> - **連帶：a11y 套件不得 import 任何 `src/**` 伺服器端模組**。其受保護頁面的登入憑證改以
>   `SEED_USER_PASSWORD` 經 HTTP 登入**示範帳號**取得（故該套件**不得**呼叫清空認證域的輔助程式，
>   示範帳號才會全程在庫）；`RegisterForm` 之類引用 Server Action 的元件一律以 `vi.mock` 隔離。
> - **單元測試環境仍為 node**：受測模組皆為伺服器端，不需要瀏覽器 DOM。
> - **a11y 不得併入 `npm run test` 的設定檔**：a11y 頁面層要 `fetch` 測試伺服器取回正式建置
>   產物的 HTML，併入後 `npm run test`（不啟伺服器）必然失敗，連帶讓 §10.6 的綠燈閘門
>   永遠達不成。
> - **整合與 a11y 共用 `tests/globalSetup.ts`**，各自啟一個伺服器於**動態空閒埠**
>   （`TEST_PORT` 有設定才用該值），baseURL 以 vitest `provide()` 傳給測試。測試端一律自該
>   值取網址，**不得硬編連接埠** —— 兩者同時執行時寫死埠號必然互撞。
> - **測試伺服器的 stdout／stderr 以 `pipe` 接出並同步 tee 至 `novelsite/.server-stdout.log`**
>   （**FEAT-7 T031a 裁示，2026-08-22**；該檔已列入 `.gitignore`，每次 globalSetup 啟動時清空）。
>   **原文的 `stdio: 'inherit'` 行不通**：`inherit` 讓子行程直接寫父行程的檔案描述子，中間沒有任何
>   一段是測試行程碰得到的，於是**伺服器端以 `console.log` 輸出的稽核與匯入紀錄完全無從驗證**——
>   而契約要求「所有出口都要記錄，含身分驗證前的提前返回」，那件事只有打真實端點才證明得了
>   （單元測試只驗得到記錄函式被正確呼叫時的形狀，驗不到端點有沒有呼叫它）。
>   **MUST NOT 改成讓產品程式自己寫檔**——為了測試改掉產品程式的輸出出口，測到的就不是要交付的
>   那一條路徑。改 `pipe` 後仍原樣轉寫到本行程的 stdout／stderr，主控台輸出與先前一致；
>   **MUST 持續消費這兩個管線**，`pipe` 而不讀會在管線緩衝填滿時把子行程卡在寫入上。
>   讀取端為 `tests/helpers/serverLog.ts`（比照 `client.ts`／`outbox.ts`，**不得 import 任何 `src/**`**）。
> - **但 `test:integration` 與 `test:a11y` 不得並行執行**（規格審查第四輪修正）：動態埠只解決埠衝突，
>   兩者仍共用**同一個測試資料庫**與**同一個 `.next` 輸出目錄**。並行時整合測試的認證域清空會讓
>   a11y 已登入的 Cookie 失效（其「斷言 200」隨機失敗），兩次 `next build` 亦互相覆寫產物。
>   彙總指令 MUST 以 `&&` 循序串接。
> - **測試環境變數集中於版控的 `.env.test`，由 `tests/testEnv.ts` 的 `loadTestEnv()` 注入兩側**
>   （第四輪補入、第五輪擴充）：三個 vitest 設定檔的 `test.env`（**測試執行器**）與 globalSetup
>   啟動的四個子行程（`migrate deploy`／`db:seed`／`next build`／`next start`）一律使用該環境，
>   `DATABASE_URL` 依 `DATABASE_PROVIDER` 自 `TEST_DATABASE_URL_{SQLITE,POSTGRES}` 擇一**強制覆寫**。
>   **缺此注入的三個後果皆為靜默**：`TRUSTED_PROXY_HOPS` 預設 `0` → `X-Forwarded-For` 被忽略、
>   全部測試共用直連位址，§7.6 的位址鍵隔離完全失效；`DATABASE_URL` 沿用開發者殼層 →
>   逐表清空直接刪掉 `dev.db` 的認證域，違反 §10.3 的「不污染開發資料庫」；
>   **只注入子行程而漏掉測試執行器**（第五輪發現）→ 逐表清空與角色 fixture 就是在測試行程內
>   直接連 DB 的，同樣清掉 `dev.db`，而且更難察覺 —— 伺服器那一側看起來完全正常。
>   兩側**必須出自同一函式**，不得各自拼裝。**不得要求開發者手動 `export`**（本機與 CI 須共用同一套啟動方式）。
> - **`DATABASE_PROVIDER` 是唯一由指令層傳入的變數**（第五輪補入）：`.env.test` **不得**收錄它 ——
>   收錄並注入後會覆蓋 `DATABASE_PROVIDER=postgresql npm run test:integration` 的指定，
>   §10.5 的兩輪測試會跑在同一種資料庫上，「兩者結果完全一致」將**恆真且毫無驗證力**。
>   未指定時預設 `sqlite`；globalSetup **必須**於啟動記錄輸出本輪實際採用的種類，
>   使「兩輪確實不同軌」可被肉眼覆核（忘記帶變數時兩輪皆綠，沒有任何其他訊號）。
> - **a11y 頁面層取受保護頁面 MUST 帶登入 Cookie 並斷言 200**：Phase 9 的目標頁面清單共 **13 頁，
>   其中 8 頁位於受保護前綴**（`/author/` 的 `dashboard`、`novels`、`earn`、`create`、`editor/{chapterId}`
>   與 `/profile/` 的 `settings`、書架、歷史），未帶憑證的 `fetch` 取回的是 302 或登入頁 HTML ——
>   `axe.run()` 會對同一份登入頁驗 8 次而全綠，等於什麼都沒驗，且違反 §10.3
>   「不得寫成假自動化」。**Cookie 由 `tests/helpers/client.ts` 的 `loginAs()` 以 `SEED_USER_PASSWORD`
>   登入示範帳號取得**（第五輪修正：原寫 `createUser()`，但該函式經 repository，a11y 套件不得引用）。
> - **頁面清單 MUST 由「版面或控制項有可見／語意變更」反推**（第四輪修正、第五輪補判準）：
>   原清單 9 頁漏掉 `/author/create`（`CreateNovelForm`）、`/author/editor/{chapterId}`（`ChapterEditor`）
>   與 `/reader/{novelId}/{chapterId}`（閱讀偏好面板加註）；第五輪再補 **`/novels/{novelId}`**
>   （`NovelHero` 的加入書架控制項加註「僅存本機」）—— 前兩者正是「停用原因可被輔助技術讀出」
>   的主要落地處，後兩者正是「標示與區塊程式化關聯」的落地處，漏驗等於這兩條規則在最主要的
>   落地處沒有防線。**判準本身亦須明訂**：跨頁基礎設施（nonce 注入、`SessionProvider`）技術上
>   觸及全部 26 頁，但不改變任何頁面的可存取語意，**不得**據此把 26 頁全列入 —— 那等同 Phase 13
>   的全站稽核。三個動態路由的參數 MUST 自示範資料取實際值（**經公開頁面的 HTTP 回應解析，
>   不得經 repository**），硬編猜測值會驗到 404 頁。
>   **同一反推原則適用於「既有 26 頁全部可正常開啟」的驗收**：其中 9 頁（`/author/*` 6 頁 +
>   `/profile/*` 3 頁）在信任邊界完成後為受保護路由，同樣 MUST 帶 Cookie 並斷言 200，
>   MUST NOT 把 302 或登入頁計為「正常開啟」。
> - **`tests/helpers/` 置於 `tests/` 根層，但兩檔的引用邊界必須切分**（第五輪修正）：
>   `client.ts`（`baseUrl`／`testFetch`／`loginAs`，純 HTTP、不 import 任何 `src/**`）由整合與 a11y
>   兩套件共用，不得各自複製；`fixtures.ts`（`createUser`，經 repository + `hashPassword`）與
>   `resetAuthTables.ts`（經 `db.ts`）**僅整合測試可引用** —— a11y 的解析條件下 `server-only` 會擲錯。

### 10.2 單元測試覆蓋範圍

| 模組 | 測試內容 |
|------|----------|
| `lib/auth/password.ts` | hash 不等於明碼、`verify` 正確／錯誤密碼、相同密碼兩次 hash 不同（salt） |
| `lib/auth/sessionToken.ts` | 簽發→驗簽往返、竄改 payload（含竄改 `role`）拒絕、**`SESSION_COOKIE.maxAge` 等於絕對上限換算的秒數**（回退為閒置期限會使滑動延展在瀏覽器端永不生效，見 §7.1）。**純憑證層，不需 mock 任何 repository** |
| `lib/auth/session.ts` | 閒置逾期拒絕、**滑動延展生效**、**節流門檻內不寫入且門檻過後才延展**、**絕對上限不被延展突破**、撤銷後失效、**改密碼後全數失效**。**以 `vi.mock` 替換 `repositories/sessions`，不連真實 DB** —— 「節流門檻內不寫入」的斷言對象正是**是否呼叫了寫入函式**，spy 計次比查 DB 精準；時間以 `vi.useFakeTimers()` 推進 |
| `lib/security/csp.ts` | `buildCspPolicy()`：`isDev: false` 的輸出不含 `'unsafe-inline'`／`'unsafe-eval'` 且 `script-src` 含 `'strict-dynamic'` 與傳入的 nonce；`isDev: true` 僅多出 `'unsafe-eval'`；`style-src` 兩種模式皆含 `'unsafe-inline'`（唯一既有例外） |
| `lib/env.ts` | **直接以四組輸入呼叫 `validateEnv()`**：缺 `SESSION_SECRET`／長度 < 32 bytes／等於範例值／provider 與連線字串協定不符，四者皆擲錯且訊息指明哪一項。**不得以重設模組快取 + 改寫 `process.env` 的方式間接測模組載入副作用** —— 測試行程必然已被注入合法設定（見 §3.5 純函式要求） |
| `lib/auth/audit.ts` | 輸出為**單行 JSON** 且四個固定欄位齊備（事件類型／時間／來源位址／結果）；傳入含密碼與 token 的物件時，輸出字串中**不得出現**該兩者的值 —— 這是「不含密碼原文」唯一的自動化防線。**但本測試無法證明它有被呼叫** —— 三個呼叫點以 §10.6 的原始碼稽核核對（見 §7.6） |
| `lib/validation/*` | 每個 Zod schema 的合法／非法輸入（email 格式、密碼長度、rating 1–5、**評論 1–1000 字、章節留言 1–500 字**，含 trim 後為空的情形；見 §4.2 `Review.content`／`Comment.content`） |
| `repositories/mappers.ts` | DateTime → ISO 字串、tags join table → `string[]`、`penName ?? name` 遞補 |
| `repositories/search.ts` | provider dispatch 正確選擇實作；空字串回空陣列；特殊字元不造成 SQL 錯誤 |
| `services/rankingService.ts` | 計分公式（**四項齊備**——含 `rating × ratingCount × 0.5`，故測試資料集 MUST 有一部「閱讀／收藏／留言皆為 0 但有評分」的作品，否則第四項漏算也會全綠）、名次升降（up/down/same/new）判定 |
| `hooks/useReaderStateMerge.ts` | **觸發判定**（未登入不送；書架與歷史兩鍵皆空不送；任一非空送一次）、**清除時機**（2xx 後只清書架與歷史，偏好與主題兩鍵保留；非 2xx 時四鍵全留）、**不重複觸發**、**截斷告知**（`truncated: true` 有呼叫 Toast）。FEAT-4 裁示 2026-08-07 補入：「合併成功後本機為空、再次登入不再觸發」是純客戶端行為，伺服器端整合測試看不見 `localStorage`，E2E 亦不走合併路徑 |
| `lib/auth/rateLimit.ts` | **位址鍵與帳號鍵各自達上限即拒**、**換位址不能繞過帳號鍵**、時間窗過後重置、**成功登入後帳號鍵計數重置**、**依 `TRUSTED_PROXY_HOPS` 正確取得來源位址且不受偽造 `X-Forwarded-For` 影響** |
| `lib/mail/index.ts` | **FEAT-5 新增（2026-08-09）**：三個 `MAIL_MODE` 值各選到哪一支實作；**未明示時依 `NODE_ENV` 推導**。**這條規則只在此處斷言**，`lib/env.ts` 那一列 MUST NOT 重覆——同一條規則兩處斷言，改動時只會有一處被改到 |
| `lib/mail/log.ts` | **FEAT-5 新增（2026-08-09）**：`logMailAttempt()` 的輸出**不含正文、不含 `token=`、不含憑證明碼**；且 `MAIL_MODE=production` 下 `ConsoleMailer` 不被建構。**沒有這一支，「記錄不得含正文或重設連結」只有實作沒有把關**，而 `console` 模式印全文是刻意的例外，兩者只差一個模式判斷 |
| `lib/env.ts`（FEAT-5 擴充） | `MAIL_MODE` 三值皆被接受；**`production` 缺 `RESEND_API_KEY`／缺 `MAIL_FROM`／未明示 `NEXT_PUBLIC_SITE_URL` 三者各自擲錯且訊息指名缺漏項**；`memory`／`console` 零憑證不擲錯；`memory`／`console` 產生「目前不會真的寄信」的啟動警示；`CONTACT_EMAIL` 未設定時回落預設值並標示。沿用既有的「直接以輸入呼叫 `validateEnv()`」作法 |
| `lib/auth/passwordResetToken.ts` | **FEAT-5 新增（2026-08-09）**：明碼熵長度、`sha256` 雜湊、`expiresAt` 計算、有效性判準的**四種 status**（`usable`／`consumed`／`expired`／`unknown`）。回 `null` 就分不出三者，畫面只能給一句含糊的話（§4.2 該 model 註）。**檔名於 FEAT-5 T016 裁示（2026-08-10）**：原文只寫「密碼重設憑證（純函式）」而未指落點，同時 `data-model.md` §2.2 寫「由**服務層**推出四種 status」——**兩者相加無法實作**：`services/passwordResetService.ts` 帶 `import 'server-only'` 並拉進 repositories 與 `lib/mail`，判準若只活在該檔內，唯一的單元驗證方式是 mock 掉整條相依鏈，**那測到的是流程不是判準**。故判準連同其餘三項落在零 I/O 的憑證層 `lib/auth/passwordResetToken.ts`（比照 `lib/auth/sessionToken.ts` 之於 `lib/auth/session.ts`），服務層**呼叫**它、MUST NOT 自行拼裝（`data-model.md` §2.2 同輪已就地取代） |
| `lib/validation/contact.ts` | **FEAT-5 新增（2026-08-09）**：`name`／`email`／`message` 三欄的邊界值；**honeypot `website` 非空即失敗** |
| `lib/validation/auth.ts`（FEAT-5 擴充） | **FEAT-5 新增（2026-08-09，`/speckit-analyze` 第三輪補入）**：`passwordResetConfirmSchema` 對弱密碼／過短／缺漏的拒絕結果**與註冊用 schema 逐案一致**。§9 Phase 14 要求重設沿用既有密碼規則，但**該要求先前只有實作沒有把關** —— 另訂一套較寬的規則不會讓任何測試變紅，而重設是設定密碼的**第三個入口**（註冊、改密碼、重設） |

| `tests/unit/style-token-scan.test.ts` | **FEAT-10 新增（2026-09-06）**：**全站** CSS 變數閘門，斷言**兩個閘門值**。**閘門值 1** = 無 fallback 的未定義 `var()` 引用數 **MUST 為 0**（清理前 24）；**閘門值 2** = fallback **整體**為寫死色碼（`#rgb`／`#rrggbb`／`#rrggbbaa`／`rgb()`／`rgba()`／`hsl()`／`hsla()`）的引用數 **MUST 為 0**（清理前 4）。**兩個都要有**：第二類引用**有** fallback，本來就不在閘門值 1 的計數內——只斷言閘門值 1 的話，那幾處改不改閘門都是綠的，而 SC-009 宣稱自己由這道掃描驗證，那個保證會是空的。判「fallback **整體**等於色碼」而**非「內含色碼」**：`var(--shadow-md, 0 8px 24px rgb(0 0 0 / 12%))` 的 fallback 是陰影值，陰影本來就含顏色。另含**掃描器自身**的四個邊界案例（合法 fallback／註解內的示意文字／行內 `style` 設定的變數視為已定義／色碼 fallback 只進閘門值 2）——同一份掃描曾給過 20／29／24 三個數字，前兩個都是誤報 |
| `tests/unit/scroll-container-css.test.ts` | **FEAT-10 新增（2026-09-06）**：**單一元件**的捲動容器版面規則。MUST 含 `max-height:` 且其值含 `dvh`（FR-008「隨可視視窗高度調整」的充分條件，同時擋掉 `vh` 與純 px）、含 `overflow-y: auto`／`overflow-x: hidden`、有 `:focus-visible` 的 accent 外框，且 **MUST NOT 含 `height:`／`min-height:`**（這是 FR-007「內容不足不留白」的充分條件）。**MUST NOT 逐字比對 `min(60dvh, 30rem)`**——該數值刻意不入規格，逐字比對會讓依實測調值時弄紅另一個檔案。**MUST NOT 與上一列併成一支**：一支是全站閘門、一支是單一元件的版面規則，併在一起之後「全站閘門已綠」與「這個檔已綠」不再是同一句話 |

> **FR-006／FR-007／FR-012／SC-004 的成功條件不由本表任何一列承載，而由可重現的手動驗證步驟承載**
> （FEAT-10，2026-09-06；憲章第 IV 條明文接受此形式）。**理由是它們在自動化層沒有可觀測的差異**：
> jsdom 沒有版面計算（`scrollHeight`／`clientHeight` 恆為 0），且純 CSS `max-height` 方案下
> **3 章與 120 章渲染出來的 DOM 完全相同**；E2E 的測試資料每卷只有幾章、不會產生捲軸，
> `scrollTop` 恆為 0 而 `toBeInViewport()` 恆真。
> **為它們寫一個恆綠的自動化測試比沒有測試更糟**——它會讓人以為驗過了。
> 步驟見 `specs/010-volume-chapter-scroll/quickstart.md` 的手動確認清單（**前置：先把某一卷建到 20 章左右**）；
> 2026-09-06 實測結果與兩項另案項目記於同目錄 `tasks.md` 的 T034。
> 摺疊語意、捲動容器的 DOM 結構與選取語意另由 `tests/a11y/volume-collapse.test.tsx`（16 案）承載。

> **上表末 6 列為 FEAT-5 新增**（2026-08-09；前 5 列於 `/speckit-analyze` 第二輪回寫本表，
> `lib/validation/auth.ts` 那一列為第三輪補入）。
> 先前只寫在 `specs/005-email-recovery-contact/quickstart.md` §4.1，沒有進本表 ——
> 而本表才是測試計畫的架構真相（`CLAUDE.md` 文件同步鐵律）。

### 10.3 整合測試與邊界案例（含預期結果）

> **Phase 9（FEAT-1）須全數自動化案例 1–6、13、14、21、22**，於**獨立於開發資料庫的測試資料庫**執行，不污染 `dev.db`。其餘案例隨對應 Phase 補齊。
>
> **編號對照（規格審查第四輪補入）**：`specs/001-trust-boundary-dual-track/spec.md` 的 FR-032 把同一組 10 個案例**重新編為 1–10**。兩套編號並存，引用時 MUST 標明出處：
>
> | 本表（§10.3） | 1 | 2 | 3 | 4 | 5 | 6 | 13 | 14 | 21 | 22 |
> | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
> | **FR-032** | 1 | 2 | 3 | 4 | 5 | 6 | **7** | **8** | **9** | **10** |
>
> **測試伺服器**：整合測試打的 HTTP 端點必須由**正式建置產物**提供 —— 測試流程先 `next build`，再以正式模式 `next start` 於測試專用連接埠，測試發送真實 HTTP 請求。**不得以 dev server 或行程內模擬請求替代**：安全標頭、頁面產生方式與快取語意在 dev 模式下與 prod 不同，以其驗證 §7.5 的 CSP 等同未驗證。本機與 CI 使用同一套啟動方式，不得分為兩種行為。代價是每輪多一次建置，Phase 9 僅 10 個案例 × 2 provider，時間可接受。
>
> **測試資料庫的準備**：`test:integration` 的 globalSetup MUST 在 `next build` **之前**對測試資料庫套用結構（`migrate deploy`）並載入示範資料（`db:seed`）。**此步驟不可省** —— 測試資料庫為空時，就緒探針 `GET /api/health` 本身要查詢資料庫，輪詢將永遠等不到 200，整條整合測試路徑無從啟動；示範資料另提供案例 22 所需的作品內容。開發者 MUST NOT 被要求手動建立測試資料庫結構（PostgreSQL 軌只需 `docker compose up -d`，其 init 腳本 `scripts/init-test-db.sql` 備妥 `novelsite_test` **與 `novelsite_shadow`** 兩個資料庫）。**`novelsite_shadow` 於 2026-08-08 補入該腳本**：`prisma.config.ts` 與 `README.md` 自 FEAT-3 起即宣告「shadow database 由 docker-compose 內建」，但腳本只建了 `novelsite_test` —— 既有本機的 shadow 是當時手動補的，新開發者重建 volume 後 postgres 軌會無法產生 migration，且錯誤訊息不會指向這裡。
> **另註（2026-08-08 實測）**：**警告：postgres 軌執行 `migrate dev` 會產生一支「DROP INDEX `Novel_searchText_trgm_idx`」的 migration。**
> 該 GIN 索引是 FEAT-3 手寫於 `3a_search` 的 `migration.sql`、**刻意不寫進 model 定義**（Prisma schema 表達不了 `gin_trgm_ops`），
> 於是 `migrate dev` 每次都把它視為「資料庫多出來的東西」而要求刪除。
> **處置**：postgres 軌若需產生 migration，MUST 於事後檢查產物是否含這一行 DropIndex；
> 若有，MUST 刪除該行（或改回 `migrate diff --from-schema ... --to-schema ...`，該作法不比對實體資料庫故不會誤判），
> 並確認 `Novel_searchText_trgm_idx` 仍存在。2026-08-08 實測時已誤產生一次並已還原。
>
> **資料隔離機制**：每個測試檔開始前**依外鍵順序清空認證域資料表**（`Session` → `User`），結束後不做事。**不採交易回滾** —— 測試打的是完整 HTTP 請求路徑，請求由獨立連線處理，測試端開的交易包不住它。同一套清空機制須在兩種 provider 上皆可用（SQLite `DELETE FROM` + 重置 `sqlite_sequence`；PostgreSQL `TRUNCATE … RESTART IDENTITY CASCADE`）。
>
> **清空範圍不含內容資料表**：`Novel`／`Chapter` 等 MUST NOT 被清空 —— 案例 22 要請求首頁、書庫與閱讀頁，清掉內容即失去渲染對象。內容由前述示範資料提供，測試全程只讀不寫。Phase 9 的作品與使用者無外鍵關聯，故清空使用者不影響內容。
>
> **整合測試的帳號一律由 fixture 建立**：示範資料的三個帳號在**第一個測試檔清空後即不存在**，因此案例 6 等需要 `author`／`admin` 的測試 MUST 以 `tests/helpers/fixtures.ts` 自行建立（經 repository 層 + `hashPassword`，不得直接寫明碼），MUST NOT 依賴 seed 帳號 —— 註冊端點只能產生 `reader`。
>
> **a11y 套件的帳號來源相反**（第五輪補入）：該套件 **不得**呼叫清空認證域的輔助程式，故 globalSetup 每次 `db:seed` 建立的三個示範帳號全程在庫；其受保護頁面憑證 MUST 以 `SEED_USER_PASSWORD` 經 HTTP 登入取得。它**不能**改用 `fixtures.ts` —— 該檔經 `repositories/*`（`server-only`），而 a11y 設定檔不得加 `react-server` 解析條件（見 §10.1）。因此 `SEED_USER_PASSWORD` 有兩個用途：使示範資料載入可重現（整合測試側），以及作為 a11y 套件的登入憑據。
>
> **但登入不得逐頁做（第六輪補入）**：登入位址鍵為 5 次/分鐘且依 §7.6 的計數語意**計入所有送達的請求**（含成功者）。a11y 頁面層有 **8 個**受保護頁、§10.6 的「既有 26 頁可正常開啟」有 **9 個**，逐頁呼叫登入會在第 6 次起全被 429 —— 拿不到 Cookie，取回的又是登入頁，於是「斷言 200」失敗，或（若斷言寫得寬鬆）**又變回第四輪修掉的「對同一份登入頁驗 8 次」**。兩處 MUST 於 `beforeAll` **每個角色只登入一次並重用 Cookie**（`readerCookie`／`authorCookie` 各一），或每次登入使用專屬 `X-Forwarded-For`。
>
> **限流狀態隔離**：逐表清空**還原不了限流計數**（它在測試伺服器行程的記憶體中，不在 DB）。若所有測試共用 localhost 同一位址，光是案例 1–3 的註冊就會撞上「註冊 3 次/小時/位址」而在第 4 次註冊時擋死自己。因此測試環境設 `TRUSTED_PROXY_HOPS=1`，**每個測試檔送出專屬的 `X-Forwarded-For`**、**每個測試用獨立 email**；刻意觸發限流的案例 4 用自己的位址與 email，不影響其他測試。**不得加測試專用的限流重置後門**（見 §7.6）。
>
> **註冊類測試需再細一級**：依 §7.6 的計數語意，註冊限流**計入所有送達的請求**（含 400 驗證失敗與 409 衝突）。案例 1–3 皆為註冊，共用單一檔案位址時三個案例正好觸底、毫無餘裕。因此**註冊類測試 MUST 讓每個測試案例使用專屬 `X-Forwarded-For`**，不是每個檔案一個。
>
> **案例 4 需再細一級**：其 **5 次失敗嘗試 MUST 各用不同位址**。位址鍵門檻同為 5 次/分鐘，整案共用單一位址時第 6 次會先被位址鍵擋下，證不到帳號鍵。兩個子案例（既有帳號／不存在帳號）MUST 各用一組互不重疊的位址與 email（見 §7.6）。
>
> **不得寫成假自動化**：需要真實瀏覽器才驗得到的項目（本機儲存竄改、主控台違規清零、主題無閃爍、註冊耗時）Phase 9 **MUST 以人工驗收承載** —— 整合測試發真實 HTTP 請求、無瀏覽器亦無 `localStorage`，Playwright 屬 Phase 13。寫成整合測試只會得到一個驗不到目標卻恆綠的測試。
>
> **可重複性驗收**：`test:integration` MUST **連續執行兩次**皆全綠（測試自行清理、無殘留狀態），且執行前後 `dev.db` 的各表筆數**完全一致**（測試打的是獨立測試資料庫）。
>
> **provider 切換**：資料存取客戶端的產生物依 provider 而異、兩軌共用同一個輸出目錄。切換軌別前 MUST 重新 `db:generate`，MUST NOT 沿用前一軌的產生物 —— 沿用會讓第二輪以錯誤的產生物連上另一種資料庫。此步驟 MUST 內建於 `test:integration` 的 globalSetup，不依賴人工記得。
>
> **就緒探針**：測試伺服器的就緒偵測以輪詢 `GET /api/health`（回 200 即就緒）達成。因此 `/api/health` MUST 屬於**基礎建設批次**（Phase 9 的 1-B），MUST NOT 排在任何整合測試之後 —— 否則測試啟動時只會輪詢到 404 而永遠等不到就緒。

| # | 案例 | 預期結果 |
|---|------|----------|
| 1 | 以既有 email 註冊 | 409 `CONFLICT`，訊息「此 Email 已被註冊」；DB 不新增列 |
| 2 | 密碼 7 字元註冊 | 400 `VALIDATION_ERROR`，`fields.password` 有訊息 |
| 3 | 登入後查 DB | `User.passwordHash` 不等於明碼且以 `$argon2id$` 開頭 |
| 4 | 對**同一帳號**錯誤密碼登入 5 次後第 6 次（**5 次失敗各用不同位址**，藉此證明擋下第 6 次的是帳號鍵而非位址鍵）；**對不存在的 email 同樣操作** | 兩者皆 429 `RATE_LIMITED` + `Retry-After`，回應**完全相同**（不得據以判斷帳號存在與否） |
| 5 | 未登入 GET `/author/dashboard` | 302 → `/auth/login`，**回應本體不含後台任何內容** |
| 6 | 讀者（`role='reader'`）GET `/author/dashboard` | 302 → `/`；`role='author'` 與 `role='admin'` 則正常進入 |
| 7 | A 作者以 B 的 `novelId` 呼叫 `updateNovelAction` | 404（不洩漏存在性），DB 未變更 |
| 8 | 同一使用者對同作品評論兩次 | 第二次 409 `CONFLICT` |
| 9 | 未登入 POST `/api/bookshelf/{id}` | 401 `UNAUTHENTICATED` |
| 10 | GET 未發佈章節（非擁有者） | 404 |
| 11 | GET 已發佈章節（**未登入訪客**） | **200 且回傳完整正文**——驗證全免費定位，無任何鎖定分支 |
| 12 | 章節 Markdown 含 `<script>alert(1)</script>` | 讀者端渲染為純文字，DOM 內無 `<script>` |
| 13 | 跨站 Origin 發送 Server Action / 寫入 API | 403（Origin 檢查） |
| 14 | 呼叫伺服器端改密碼函式後，用舊 session cookie 請求 | 401（該使用者全部 session 已撤銷） |
| 15 | 搜尋詞含 `%`、`_`、`'` | 正常回應，不報錯、不誤配 |
| 16 | 搜尋詞大小寫混雜（`JIAN` vs `jian`），**另補一組非 ASCII 大小寫**（含重音拉丁字母） | 兩種 provider 的結果**內容與排序完全一致**。非 ASCII 一組為 FEAT-3 補入：ASCII 案例無法區分「查詢已於服務層轉小寫」與「靠資料庫折疊」兩種實作，而後者在兩軌不一致（§3.4） |
| 17 | **併發**建立章節時兩者取得同一個「最大編號 +1」（FEAT-3 起編號由系統指派，作者無從指定，故此為唯一的撞號來源） | 其一成功、另一回 409 `CONFLICT`，DB 無重複編號；原始資料庫例外**不得**冒泡為 500。卷編號同理 |
| 18 | 刪除作品 | 其 Volume / Chapter / ChapterContent / Review 級聯刪除，無孤兒列 |
| 19 | 進度上報 `percent=150` | 400 `VALIDATION_ERROR` |
| 20 | 空搜尋字串 `?q=` | 回空陣列，不做全表掃描（以查詢計數驗證） |
| 21 | 任一頁面的回應標頭與 CSP nonce（**須跑在正式建置產物上**） | §7.5 六個安全標頭齊備；同頁連續兩次請求的 nonce **不相同**；標頭中的 nonce 與 HTML 內 `<script nonce>` **一致**；`script-src` 不含 `'unsafe-inline'`／`'unsafe-eval'` |
| 22 | 分別請求公開頁（`/`、`/novels`、閱讀頁）、受保護頁、**兩類靜態資源**（`_next/static/…` 與 `public/` 下的檔案如 `/next.svg`）與 **API 端點**（`/api/health`） | 公開頁與受保護頁取得**同一套 CSP** 與各自的 nonce；靜態資源與 API **不經攔截層**、回應不含 CSP 標頭，但仍具備 `next.config.ts` 設定的其餘五個安全標頭（驗證 §7.1 的 matcher 範圍與 §7.5 的職責切分）。**兩類靜態資源各取一個樣本為第六輪補入** —— 只驗 `_next/static` 時，matcher 若漏掉 `public/` 的副檔名排除仍會全綠 |
| 23 | **密碼重設全程**（Phase 14／FEAT-5）：申請 → 自 outbox 取憑證 → 設新密碼 | 新密碼登入成功、舊密碼 401。**另三項**：(a) 以憑證明碼查 `PasswordResetToken` 表回 **0 列**；(b) 信件內文含有效期分鐘數與「若非本人申請可忽略本信」；(c) 連結的 host 等於 `SITE_URL`。**送入的 Email MUST 含大小寫混合案例**（`A@Example.com` 查得到 `a@example.com` 的帳號）—— 漏了正規化的外觀與「帳號不存在」完全一樣 |
| 24 | 已註冊 vs 未註冊 Email 各送一次重設申請 | 狀態與回應主體**逐位元組相同**；未註冊者 outbox **零新增** |
| 25 | 同上兩種 Email，量測回應時間差（`MAIL_MEMORY_DELAY_MS=300`） | (a) outbox 輪詢於逾時內命中 → 背景寄送**確實被執行**；(b) 時間差 **< 200ms** → 寄送**確實在回應之後**（同步寄送必然多花 ≥300ms）。**這兩道缺一，「信根本沒寄」在畫面上與「寄成功」完全一樣** |
| 26 | 重設連結用過一次／逾期／同帳號連續申請兩次後開第一封 | 依序回 400 `INVALID_TOKEN`／400 `EXPIRED_TOKEN`／第一封失效。**另斷言**：第二次申請後該使用者的憑證**列數為 1**（舊的已被順帶刪除，不是留著標記為已作廢） |
| 27 | 重設成功後以舊 Cookie 請求；另：登入後自行改密碼 | 舊 Cookie 401（全部 session 已撤銷）；改密碼後該使用者**全部未使用的重設憑證一併作廢**——沒有這一條，一封還在有效期內的舊重設信可以覆寫剛改好的新密碼 |
| 28 | 同一 Email 申請重設第 4 次，**已註冊與未註冊各一組**（`/speckit-analyze` 第三輪 2026-08-09 補入後半組） | 兩組**皆**回 429 `RATE_LIMITED`；已註冊那組的 outbox **只有 3 封**（帳號鍵 3 次/小時，§7.6）。**未註冊那組是「帳號鍵對所有送入的 Email 一律計數」（§7.6）的唯一把關** —— 只對存在帳號計數的實作會讓未註冊者第 4 次回 200、已註冊者回 429，**差異本身就是帳號枚舉管道**，而案例 24 只各送一次、原本的案例 28 只用一種 Email，兩者都看不見。**兩組 MUST 各用一個互不相同的 `X-Forwarded-For`**：位址鍵是 5 次/分鐘，八次請求走同一位址會在第 6 次被**位址鍵**擋下，未註冊那組於是拿到一個與帳號鍵無關的 429 —— **測試會為了錯的理由變綠** |
| 29 | 聯絡表單送出（Phase 14／FEAT-5） | 200，outbox 收到含稱呼／Email／訊息三段的信；該筆的 `replyTo` 為表單填入的 Email；**收件人是 `CONTACT_EMAIL` 而非表單 Email**（站台 MUST NOT 成為 spam 放大器） |
| 30 | 聯絡表單寄送失敗（**以表單 Email 填 `fail@outbox.invalid` 觸發** —— 該值成為信件的 `replyTo`） | **502 `MAIL_FAILED`**，回應與畫面文案**不含任何「已送出」字樣**；outbox 零新增。這是 §8「不得假成功」在本刀的唯一證明路徑。**觸發方式於 T046 交付時就地取代（2026-08-10）**：原文寫「以收件人 `fail@outbox.invalid` 觸發」，而聯絡信的收件人一律是 `CONTACT_EMAIL`（FR-019），**照原文這條分支永遠觸發不到**；判定已擴及 `replyTo`（見 §9 Phase 14 第 5 項） |
| 31 | 同一位址送出聯絡表單第 4 次 | 429，outbox 只有 3 封（3 次/小時/位址） |
| 32 | 四個導向聯絡管道的入口（頁尾／說明頁／關於頁／隱私權頁） | 四頁 HTML 皆含 `/contact` 連結；`/contact` 回 200 且送出鈕**非 `disabled`**。**四者先前只有一個有實作任務，其餘三個靠「自然成立」——沒有東西把關的自然成立，下一次改版就會斷掉**。**隱私權頁的 `mailto:` 斷言已拆至案例 33**（`/speckit-analyze` 第三輪，2026-08-09） |
| 33 | 隱私權頁的個資權利行使段落（**屬 5-A，不需寄送能力**） | `/privacy` 的 HTML 含 `CONTACT_EMAIL` 的 `mailto:` 位址，而非只有指向 `/contact` 的連結；**位址亦以明文出現（不只藏在 `href` 裡）**，且既有的 `/contact` 連結仍在（新位址是追加、不是取代，T040a 交付，2026-08-10）。**本案例自案例 32 拆出**（`/speckit-analyze` 第三輪，2026-08-09）：它斷言的實作由 **5-A** 交付，混在 5-C 的入口測試裡會使 **5-C 隱性依賴 5-A** —— 而 §9 Phase 14 與 `features.md` 都寫「三刀在基礎層之後完全平行」，**5-C 若先合併，該斷言交付即紅，且紅燈與 5-C 的實作進度無關** |
| 34 | 登入頁的救援入口 | `/auth/login` 的 HTML **含 `/auth/forgot-password` 連結**（§7.2 該列的禁令於本 Phase 解除，改為 MUST 提供入口）。**先前只有實作、零把關**：a11y 清單裡的 `/auth/forgot-password` 目標只證明**那一頁存在**，不證明登入頁到得了它（`/speckit-analyze` 第三輪，2026-08-09） |

> **案例 23–34 為 FEAT-5 新增**（2026-08-09；案例 23–32 於 `/speckit-analyze` 第二輪回寫本表，
> **案例 33、34 與案例 28 的後半組為第三輪補入**）。
> 對應 `specs/005-email-recovery-contact/quickstart.md` §4.2 的十二個整合測試檔，
> 沿用本節既有的隔離規則：**每個測試檔專屬 `X-Forwarded-For`、每個案例獨立 Email**
> （案例 28、31 的門檻只有 3 次/小時，餘裕比 Phase 9 更小），
> 且 **MUST NOT 為測試加入任何可重置或停用限流的機制**（§7.6）。
> **案例 28 是本節唯一需要「一個檔案兩個位址」的例外**（第三輪補入）：
> 它要送兩組各 4 次共 8 次請求，而位址鍵是 5 次/分鐘 —— 共用一個位址會在第 6 次被位址鍵擋下，
> 使第二組拿到一個與帳號鍵無關的 429。兩個位址仍 MUST 為本檔專屬、不與其他測試檔重疊。
> 案例 30 的 `fail@outbox.invalid` **僅存在於 `memory` 實作**、MUST NOT 進正式實作 ——
> 它不繞過任何檢查、不改任何門檻，且 `.invalid` 是 RFC 2606 保留 TLD，永遠不會是真實信箱。

### 10.4 E2E 主要流程（Playwright）

> **導入時機（2026-07-30 修訂）**：框架、設定檔與 CI 瀏覽器安裝屬 **Phase 11（FEAT-3）**，
> 該階段只交付**第 2 條作者流**；其餘三條留 Phase 13（FEAT-4）。原表述「Playwright 屬 Phase 13」
> 已不適用。FEAT-3 的 E2E 只跑 SQLite 一軌、只跑 chromium，以正式建置產物、專屬埠與獨立
> `e2e.db` 執行——資料庫種類差異已由 §10.5 的雙軌整合測試覆蓋，E2E 再跑一次兩軌無新增資訊。

1. **讀者流**（FEAT-4）：註冊 → 首頁 → 作品頁 → 閱讀第 1 章（驗證正文來自 DB）→ 加入書架 → 換章 → 登出再登入 → 書架與續讀位置保留。**本條 MUST 於三種瀏覽器引擎各跑一次**（跨瀏覽器驗證的落點，見 Phase 13 第 5 項）；其餘三條維持單一引擎
2. **作者流**（**FEAT-3**）：登入 → 開通作者 → 建立作品 → 撰寫並發佈第 1 章 → 以另一瀏覽器 context 的訪客身分讀到該章
3. **越權流**（FEAT-4）：作者 A 直接輸入作者 B 的編輯器網址 → 被導離或 404
4. **無障礙**（FEAT-4）：Skip Link 可鍵盤觸發；閱讀頁字級／主題切換後重載仍保留
5. **卷內章節瀏覽**（**FEAT-10**，`tests/e2e/volume-scroll.spec.ts`，9 案）：摺疊／展開、
   **鍵盤 Enter 與空白鍵切換**（jsdom 不實作按鈕的 activation behavior，這一條只有真實瀏覽器驗得到）、
   排序／批次發佈／刪除後該卷**仍為展開**（FR-011）、重新整理後**回到預設狀態**（FR-013，
   即「展開狀態不被持久化」）、作品資訊表單的**兩個重填方向**（FR-020：自己儲存成功後顯示修剪過的值；
   **他處操作觸發刷新時未儲存的輸入原樣保留**）。
   **登入 MUST 只在 `beforeAll` 做一次並重放 Cookie**——`LOGIN_RATE_ACCOUNT_MAX` 預設 5，
   每案各登入一次時第 6 個會撞帳號層限流，症狀是 `waitForURL` 逾時而非斷言失敗。
   **MUST NOT 斷言 `scrollTop` 或 `toBeInViewport()`**：測試資料下該卷沒有捲軸，那兩者恆真。
   **「新增章節後仍展開」不列入**：`createChapterAction` 成功後 `redirect()` 離開管理頁，沒有可斷言的對象

### 10.5 雙軌驗證

同一份整合測試分別以兩種 provider 執行（PostgreSQL 執行個體由 repo 內的 `docker-compose.yml` 提供，見 §3.2）：

```bash
docker compose up -d                                             # 取得本機 PostgreSQL（含 novelsite_test）
# npm script 本身只有一行 `vitest run -c vitest.integration.config.mts`（第六輪釐清）；
# 下列整串是 tests/globalSetup.ts 的內容，**唯一擁有者是它，不得同時寫進 npm script**
#   —— 兩邊都寫會建置兩次、啟兩個伺服器（第二個必然搶不到同一個埠）：
#   db:generate → 測試 DB migrate deploy → 測試 DB db:seed
#              → next build → next start（動態空閒埠；stdout／stderr 以 pipe 接出，原樣轉寫到
#                 本行程之餘同步 tee 至 novelsite/.server-stdout.log，見 §10.3，FEAT-7 T031a）
#              → 就緒偵測 →（測試結束）關閉伺服器
# 測試環境另設 TRUSTED_PROXY_HOPS=1，各測試檔以專屬 X-Forwarded-For 隔離限流鍵
# DATABASE_PROVIDER 是唯一由指令層傳入的變數；DATABASE_URL 由 loadTestEnv() 自 .env.test 依它選定並強制覆寫
DATABASE_PROVIDER=sqlite     npm run test:integration
DATABASE_PROVIDER=postgresql npm run test:integration
```

**通過條件**：兩者測試結果完全一致（含搜尋大小寫、排序穩定性、級聯刪除行為）。

> **`DATABASE_PROVIDER` 不得寫進 `.env.test`**（第五輪補入）：寫入並被注入後會覆蓋上面兩行的指定，兩輪跑在同一種資料庫上，本節的「完全一致」將**恆真且毫無驗證力**。跑完兩輪後 MUST 回頭比對 globalSetup 啟動記錄印出的 provider 確實不同 —— 忘記帶變數時兩輪皆綠，沒有任何其他訊號。

> **Phase 9 的適用範圍**：Phase 9 的資料模型尚無可測的級聯關係（§10.3 的 10 個案例不含級聯刪除），搜尋亦屬 Phase 11。因此 Phase 9 的「完全一致」指**錯誤碼與排序穩定性**；級聯刪除與搜尋大小寫的雙軌一致性隨 Phase 10／11 的對應案例補齊。
>
> **切換 provider 前 MUST 重新 `db:generate`**（見 §10.3 的 provider 切換註記）。

**migration 重置的驗收**（一次性，見 §3.2）：兩軌各只有一個初始 migration、舊的單軌 migration 已不存在；自空 DB 套用初始 migration + `db:seed` 後，網站內容與改造前一致。

### 10.6 完成與交付準則（Definition of Done）

每個 Phase 皆須滿足：

- [ ] 該階段所有測試案例通過（失敗則修正程式碼並重跑，直到全綠）
- [ ] `npm run build`、`npm run lint`、`npx tsc --noEmit` 全綠
- [ ] 該階段對應的 `nextstep.md` 編號在 §8 對照表可勾銷
- [ ] 雙軌（sqlite / postgresql）皆可執行（切換前已重新 `db:generate`）
- [ ] 該階段新增／修改的頁面 `npm run test:a11y` 零違規（Phase 13 起改為全站）
- [ ] `test:integration` **連續執行兩次**皆全綠，且執行前後 `dev.db` 各表筆數不變（§10.3 可重複性驗收）
- [ ] `test:integration` **自完全空白的測試資料庫**（先 drop 或刪除 `test.db`）執行一次仍全綠 —— 驗證結構套用與示範資料載入確實內建於 globalSetup，而非依賴上一輪殘留
- [ ] `npm run test` **在未啟動任何伺服器的情況下獨立通過**（驗證單元設定檔未混入 a11y）
- [ ] **a11y 確實驗到受保護頁面**：暫時移除頁面層測試傳入的登入 Cookie，該測試 MUST 失敗（取回登入頁而非後台）。若移除後仍全綠，代表它一直在驗登入頁，無障礙驗收未達標
- [ ] **a11y 與逐頁檢查的清單由實際改動反推**：頁面層清單 MUST 涵蓋該階段每一個**版面或控制項有可見／語意變更**的頁面（Phase 9 為 **13 頁**，含 `/author/create`、`/author/editor/{chapterId}`、`/reader/{novelId}/{chapterId}`、`/novels/{novelId}`）；跨頁基礎設施（nonce、`SessionProvider`）**不使 26 頁全數列入**；「既有 26 頁可正常開啟」的檢查中，受保護的 9 頁 MUST 帶登入 Cookie 並斷言 200
- [ ] **測試環境設定隨 repo 版控且注入兩側**：clone 後不需手動 `export` 即可跑整合測試；`TRUSTED_PROXY_HOPS=1` 與測試資料庫連線在**測試執行器與四個子行程**上皆生效（未生效時位址隔離失效、且會清掉 `dev.db` 的認證域）。另 `git check-ignore -v .env.test` **須無輸出** —— 驗證 `!.env.test` 確實排在 `.env*` 之後而生效
- [ ] **雙軌兩輪確實跑在不同資料庫**：`test:integration` 兩輪的 globalSetup 啟動記錄所印的 `DATABASE_PROVIDER` MUST 不同。忘記帶該變數（或誤把它寫進 `.env.test`）時兩輪皆綠，§10.5 的「兩者結果完全一致」會恆真而毫無驗證力
- [ ] **三個 vitest 設定檔的解析條件正確**：單元與整合含 `react-server`（否則 `repositories/*` 的 `server-only` 在 import 階段擲錯）、a11y **不含**（否則 `react` 解析到伺服器版本，React Testing Library 無法渲染）；且 `tests/a11y/**` 中無任何 `src/**` 伺服器端模組的 import
- [ ] **新增樣式一律走既有設計 token**：停用態與「示範資料」標示的顏色／間距取自 `design-tokens.css`，無硬編色碼，且三個主題下皆可讀（憲章技術約束）
- [ ] **誠實標示以全站掃描收尾**：`grep -rn "showToast(\|setSubmitted(\|setSent(" src`，每一處命中都能回答「這個操作真的寫入了嗎」；否即須停用並標示「功能開發中」。逐項清單必漏 —— `ContactForm` 與 `/author/earn` 是第三輪才發現、**`AuthorNovelList` 的連載狀態切換是第六輪才發現**的漏項。
      **掃描樣式必須夠寬（第六輪修正）**：原樣式 `showToast(.*'success'…` 要求呼叫名稱與參數落在**同一行**，會漏掉跨多行書寫的呼叫 —— `AuthorNovelList` 的狀態切換正是這種寫法，實測原樣式的命中中沒有它。**安全網本身也會有漏洞**：掃描樣式若寫得太精確，它就退化成另一份列舉。故只搜**呼叫名稱本身**，命中數變多是可接受的成本
- [ ] **`logSecurityEvent` 的三個呼叫點皆存在（第六輪新增）**：`grep -rn "logSecurityEvent(" src` 的命中須涵蓋 `auth.login.failed`、`auth.rate_limited`、`authz.denied` 三類，任一類為 0 即 §7.6 的安全事件記錄未完成。**這是「該有的有」型稽核** —— 前面各項驗的是「不該有的沒有」，而只有實作與單元測試的函式在從未被呼叫時，所有測試依然全綠
- [ ] **攔截層未把資料存取層拉進來（第六輪新增）**：`src/proxy.ts` 的 import **僅限** `next/server`、`@/lib/security/csp`、`@/lib/auth/sessionToken`、`@/lib/auth/audit`；出現 `@/lib/auth/session`、`@/lib/auth/guard`、`@/lib/repositories/*`、`@/lib/db`、`@prisma/*` 任一即為違反（§7.1「憑證層與工作階段層必須是兩個模組」）
- [ ] **API Route 未直連資料庫（第六輪新增）**：`/api/health` 的延遲與 `ok` 取自 `repositories/health.ts` 的 `pingDatabase()`，端點內無 `import { prisma }` 或 `$queryRaw`（§2.2 R1、§5.3）
- [ ] **登入次數未撞上位址鍵限流（第六輪新增）**：a11y 頁面層（8 個受保護頁）與「既有 26 頁可正常開啟」（9 個受保護頁）**每個角色只登入一次並重用 Cookie**。登入位址鍵為 5 次/分鐘且計入所有送達請求，逐頁登入會在第 6 次起全被 429、取回登入頁 —— 那正是上一項 a11y 反向驗證要防的同一個坑，只是換了個成因（§7.6 限流狀態的測試隔離）

**回應時間目標（Phase 9 起適用）**：註冊與登入的 p95 < 1 秒。**量測方式**：對**正式建置產物**連續發送至少 30 次註冊與 30 次登入請求，取第 95 百分位並記錄於 README。唯一的變數是 §7.2 的 `ARGON2_PARAMS`；逼近上限時 MUST 下調 `memoryCost` 後重新量測，MUST NOT 略過量測直接宣稱達標。

> **量測 MUST 避開限流**：設 `TRUSTED_PROXY_HOPS=1` 並讓**每一次請求各用一個 `X-Forwarded-For` 位址**，登入量測另用足量的不同帳號。註冊 3 次/小時、登入位址鍵 5 次/分鐘、帳號鍵 5 次/15 分鐘，共用位址時第 4 次起全被 429；**被限流的請求不執行密碼雜湊**，量測值會失真且偏樂觀。**MUST NOT** 為量測調高門檻或停用限流（見 §7.6）。

---

## 附錄 A：新增依賴

| 套件 | 用途 | 階段 |
|------|------|------|
| `jose` | session JWT 簽發／驗證 | Phase 9 |
| `@node-rs/argon2`（或 `bcrypt`） | 密碼雜湊 | Phase 9 |
| `zod` | 入參驗證（client/server 共用） | Phase 9 |
| `vitest` | 單元／整合／a11y 測試執行器（三份設定檔，見 §10.1） | Phase 9 |
| `@vitejs/plugin-react` + `vite-tsconfig-paths` | a11y 互動狀態層渲染 Client Component、路徑別名解析 | Phase 9 |
| `jsdom` + `@testing-library/react` + `@testing-library/dom` | a11y 的 DOM 環境與元件渲染 | Phase 9 |
| `axe-core` | 自動化無障礙檢查（不引入 Playwright，見 §10.1） | Phase 9 |
| `dotenv` | `prisma.config.ts` 與 `tests/testEnv.ts` 直接 import；現為傳遞相依，須補為明確宣告 | Phase 9 |
| `@prisma/adapter-pg` + `pg` | PostgreSQL driver adapter | Phase 9 |
| `rehype-sanitize` | Markdown 淨化 | **Phase 11（FEAT-3）** |
| `@playwright/test` | E2E（FEAT-3 只交付作者流一條，見 §10.4） | **Phase 11（FEAT-3）** |

## 附錄 B：Next.js 16 文件查證結果

實作前務必 `npm install` 後閱讀 `node_modules/next/dist/docs/` 的對應章節（`AGENTS.md` 強制要求）。

**查證日期**：2026-07-23（Next.js 16.2.10、Prisma 7.9.0）。完整依據與替代方案評估見
`specs/001-trust-boundary-dual-track/research.md`。

| # | 項目 | 狀態 | 結論 |
|---|------|------|------|
| 1 | 路由攔截檔名與 matcher | ✅ 結案 | 更名為 **`proxy.ts`**（本專案落在 `src/proxy.ts`），匯出具名 `proxy` 或 default + `config.matcher`。全專案只允許一個。matcher 採 `{ source, missing }` 物件形式排除 `api`／`_next/static`／`_next/image`／`favicon.ico` 與 prefetch。**額外發現**：Proxy 預設跑 Node.js runtime，`runtime` 設定選項不可用（見 §7.1 的執行環境更正）。另注意 matcher 排除某路徑會**同時跳過該路徑上的 Server Function**，故每個 Server Action 內部仍須自行驗權 |
| 2 | Route Handler `params` | ✅ 結案 | `context.params` 為 **Promise**，一律 `await ctx.params`（`v15.0.0-RC` 起）。Phase 9 新增的端點皆無動態區段 |
| 3 | Server Actions 內建 CSRF | ✅ 結案 | Server Actions **已內建** `Origin` ↔ `Host`（或 `X-Forwarded-Host`）比對，不符即中止，且僅允許 POST。**Route Handler 無此保證** —— §7.6 的 Origin 檢查**仍須自行實作**並套用於 `/api/*` 寫入端點。§10.3 案例 13 因此 MUST 打 Route Handler 才驗得到 |
| 4 | 快取指令 | ⏸ 非 Phase 9 範圍 | `use cache` 等屬 **Cache Components**，於 Next 16 為 `cacheComponents: true` 的 **opt-in**，本專案未啟用。§2.5 的快取策略隨 Phase 10 起實作時再查 |
| 5 | `cookies()` / `headers()` | ✅ 結案 | 皆為 **async**，一律 `await` |
| 6 | `next.config.ts` `headers()` | ✅ 結案 | 仍受支援，且套用於**所有**回應含靜態資源 —— 正好用於「靜態資源有 HSTS 等防護但無 CSP」的職責切分（見 §7.5） |
| 7 | Metadata / sitemap 動態產生 | ⏸ 非 Phase 9 範圍 | Phase 9 僅受 M-5「站台網址單一設定來源」影響，API 形狀不變。動態 sitemap 屬 Phase 11 |
| 8 | CSP nonce 傳遞慣例 | ✅ 結案 | Proxy 產生 nonce 後 MUST 同時寫入**請求標頭** `x-nonce`、**請求標頭** CSP 與**回應標頭** CSP —— Next.js 自請求標頭的 CSP 以 `'nonce-{value}'` 樣式解析並**自動**套到框架腳本、頁面 bundle、Next 自產的內聯腳本與樣式，以及有 `nonce` prop 的 `<Script>`。因此**不需列舉框架腳本雜湊**（§7.5 定案的依據）。Server Component 以 `(await headers()).get('x-nonce')` 讀取。使用 nonce 即 MUST 動態產生 —— 本專案於 root layout 呼叫 `headers()` 作為單一觸發點。**但該觸發點對宣告了 `generateStaticParams` 的路由不成立，那些路由 MUST 另外自行標 `export const dynamic = 'force-dynamic'`**（實測，2026-09-05）：`generateStaticParams` 一存在，該路由即被視為「靜態產生 + `dynamicParams: true`」，未列出的參數會在**首次請求時以靜態產生的脈絡**渲染，此時 root layout 的 `headers()` 不會把它轉成動態頁，而是擲出 `DynamicServerError`。**症狀是該路由一律 500，容器日誌只有 `digest: 'DYNAMIC_SERVER_USAGE'`，完全不會提到 `generateStaticParams`**。`/novels/[id]` 與 `/categories/[id]` 兩支的 `generateStaticParams` 已因此移除（原為 FEAT-6 / T041 於建置期資料庫連不上時回 `[]` 的作法——容器建置期**永遠**連不到資料庫，故它在正式環境的唯一效果就是觸發本錯誤）。另有 `experimental.sri`（hash-based CSP，可保留靜態化）但標為 experimental 且無法處理動態產生的腳本，Phase 9 不採，留待 Phase 13 重估 |
| 9 | `next start` 測試用法 | ✅ 結案 | 支援 `-p/--port`（亦可用 `PORT`）與 `-H/--hostname`，須先 `next build`。就緒偵測以輪詢 `GET /api/health` 達成（該端點因此必須屬基礎建設批次，見 §10.3） |
| 10 | `redirect()` 在巢狀 layout 中無法阻止子頁面渲染 | ✅ 結案（**Phase 9 實作期間發現，訓練資料未涵蓋**） | 巢狀路由段落（layout／page）在 App Router 的串流架構下**平行解析**：`author/layout.tsx` 呼叫 `requireAuthor()` 並 `redirect()`，但其 `children`（page 段落）作為獨立 Suspense 邊界，其資料擷取與渲染**不受父層 layout 的控制流程阻擋**。實測（`/author/dashboard` 在 JWT 快照為 `author`、DB 已改為 `reader` 的情境）：回應仍為 200，且 RSC flight payload 內同時含有 layout 的 `NEXT_REDIRECT` 訊號**與** page 段落已完整渲染的真實資料（含 `AuthorDashboardView` 的實際統計數字）——**僅有 layout 轉址並不足以避免受保護內容外洩**（違反 FR-011）。**定案**：每個受保護頁面 MUST 在其 `page.tsx`（及有 async 資料需求時的 `generateMetadata()`）**自行**呼叫 `requireAuthor()`/`requireUser()` 作為**第一個** `await`，先於任何資料擷取；`generateMetadata()` 亦需獨立呼叫 —— 靜態 `export const metadata` 不受元件的 `redirect()` 節制，而 async `generateMetadata()` 內部呼叫 `redirect()`／`notFound()` 合法（隨版文件 `generate-metadata.md` 確認），可避免連 `<title>` 都外洩。**教訓**：「兩道防線」不能只設在 layout 這一層，US2 的 9 個受保護頁面（`author/{dashboard,novels,earn,create,editor/[chapterId],guide}`、`profile/{bookshelf,history,settings}`）均已逐一補上頁面層守衛（`tasks.md` T058-T059 的 layout 守衛之外，見各 page.tsx 開頭的 `requireAuthor()`/`requireUser()` 呼叫） |

**附帶結案（非 Next.js，但同屬「實作前待查」）**：Prisma 7.9 **不支援** `datasource.provider = env(...)`
（實測 `P1012: A datasource must not use the env() function in the provider argument`）。
§3.2 的「實作待辦」據此結案：`scripts/build-schema.ts` 產生器**不可廢除**。
