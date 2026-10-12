# 線上小說平台｜NovelSite — 完整規劃文件

> **定位**：繁體中文原創文學平台，以「沉浸式閱讀體驗」為核心，打造極簡高質感的現代 Web UI/UX。
> 競品參考：起點中文網（功能深度）× Medium（排版美學）× Notion（簡潔哲學）

---

## 一、目標定義（Goal）— MVP 核心功能

MVP 聚焦「讀者流」與「作者創作流」兩條主軸，以下為 **六大核心頁面**：

### 📖 1. 首頁（Homepage）
- Hero Banner：精選推薦作品，具視差捲動效果（GSAP ScrollTrigger）
- 分類快捷入口：玄幻、都市、言情、科幻、歷史、懸疑
- 新書推薦卡片區（Stagger 入場動畫）
- 熱門排行榜（側邊 Widget 或獨立 Section）

### 📚 2. 作品總覽頁（Novel Detail Page）
- 封面 + 作品資訊（作者、字數、更新頻率、分類標籤）
- 簡介展開 / 收合
- 章節列表（分捲）
- 讀者評論 & 評分
- CTA：「立即閱讀」「加入書架」

### 📄 3. 閱讀頁（Reader Mode）—— 本次 UX 重點頁面
- 沉浸式全螢幕閱讀模式
- 可調字體大小 / 行距 / 背景主題（白紙模式 / 護眼模式 / 夜間模式）
- 章節翻頁（上 / 下章節導航）
- 閱讀進度條（Top Progress Bar）
- 浮動工具欄（字體調整、設定、目錄）

### 🏆 4. 排行榜頁（Ranking）
- 週榜 / 月榜 / 總榜切換 Tab
- 各分類排行
- 卡片式呈現，含排名徽章

### ✍️ 5. 作者後台（Author Dashboard）
- 作品管理（新增、編輯、上架）
- 章節編輯器（富文本 / Markdown）
- 數據儀表板（瀏覽量、收藏量、評論數）
- 讀者留言管理

### 👤 6. 使用者系統（Auth + Profile）
- 登入 / 註冊（Email + 社群登入）
- 個人書架（收藏管理）
- 閱讀歷史紀錄
- 通知中心

---

## 二、設計系統（Design System）

> 以下設計系統由 **UI/UX Pro Max Skill** 搭配「沉浸式閱讀 × 內容優先 × 極簡現代」關鍵字生成，並針對繁體中文閱讀場景深度客製化。

### 🎨 主題定調

| 屬性 | 說明 |
|------|------|
| 設計風格 | **Content-First Minimalism**（內容優先極簡主義） |
| 核心哲學 | 「文字是主角，UI 是配角」 |
| 視覺靈感 | 高質感紙質感 × 現代無襯線字型 × 日式設計留白美學 |

---

### 🌈 色彩系統（Color Tokens）

#### 淺色模式（Light Mode）—— 閱讀白紙主題

| Token | 色碼 | CSS Variable | 說明 |
|-------|------|--------------|------|
| Primary | `#3D2B1F` | `--color-primary` | 深咖啡墨色，主標題 |
| Secondary | `#92400E` | `--color-secondary` | 暖琥珀棕，輔助強調 |
| Accent / CTA | `#D97706` | `--color-accent` | 金黃色，行動呼籲按鈕 |
| Background | `#FDFAF5` | `--color-background` | 暖白紙色，減輕白光刺眼 |
| Foreground | `#1A1A1A` | `--color-foreground` | 正文墨色 |
| Surface | `#FFFFFF` | `--color-surface` | 卡片、彈窗背景 |
| Muted | `#F5F0E8` | `--color-muted` | 柔性分區背景 |
| Border | `#E8E0D4` | `--color-border` | 細線、分隔線 |
| Subtle | `#78716C` | `--color-subtle` | 副文字、Metadata |

#### 深色模式（Dark Mode）—— 夜間閱讀主題

| Token | 色碼 | CSS Variable | 說明 |
|-------|------|--------------|------|
| Primary | `#E8DCC8` | `--color-primary` | 暖米白，主標題 |
| Background | `#0F0E0C` | `--color-background` | 深炭黑，護眼底色 |
| Foreground | `#D4C9B5` | `--color-foreground` | 正文暖灰，WCAG 4.5:1+ |
| Surface | `#1C1A17` | `--color-surface` | 卡片背景 |
| Accent | `#F59E0B` | `--color-accent` | 強調金，深色中的暖光 |
| Border | `#2E2A25` | `--color-border` | 微妙邊框 |
| Subtle | `#6B6560` | `--color-subtle` | 次要文字 |

#### 護眼模式（Eye-Care Mode）—— 閱讀頁專屬

| Token | 色碼 | 說明 |
|-------|------|------|
| 背景 | `#F2EBDD` | 暖黃羊皮紙色 |
| 正文 | `#3A2E22` | 深棕墨色 |
| 工具欄 | `rgba(242,235,221,0.92)` | 半透明毛玻璃 |

---

### 🔤 字體系統（Typography）

> 繁體中文環境特別優化：系統字型 Fallback 鏈確保跨平台一致性

```css
/* 標題字族 — 兼顧辨識度與現代感 */
--font-heading: 'Noto Serif TC', 'Noto Serif', 'Georgia', serif;

/* 正文字族 — 閱讀舒適度最優先 */
--font-body: 'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', 
             'Hiragino Sans', sans-serif;

/* 介面 UI 字族 — 極簡現代感 */
--font-ui: 'Inter', 'Noto Sans TC', system-ui, sans-serif;

/* 程式碼 / 等寬 */
--font-mono: 'JetBrains Mono', 'Fira Code', monospace;
```

#### 字體尺寸階層（Type Scale）

| Token | 尺寸 | 用途 |
|-------|------|------|
| `--text-xs` | 12px | 標籤、版權、時間戳 |
| `--text-sm` | 14px | 副標、Metadata、按鈕 |
| `--text-base` | 16px | 閱讀正文（預設） |
| `--text-md` | 18px | 卡片標題 |
| `--text-lg` | 20px | 章節標題 |
| `--text-xl` | 24px | 頁面副標題 |
| `--text-2xl` | 32px | 頁面主標題 |
| `--text-3xl` | 48px | Hero 大標 |
| `--text-4xl` | 64px | 超大展示標題 |

**閱讀頁可調範圍：** 14px — 18px — 22px（三段快速切換）

---

### 📐 間距系統（Spacing Scale）

以 **8px 基準格** 建立呼吸感強的間距系統：

```css
--space-1: 4px;    /* 最小微間距 */
--space-2: 8px;    /* 元素內部 */
--space-3: 12px;   /* 緊密卡片 */
--space-4: 16px;   /* 標準間距 */
--space-5: 24px;   /* 區塊內部 */
--space-6: 32px;   /* 卡片間距 */
--space-8: 48px;   /* Section 間距 */
--space-10: 64px;  /* 大區塊間距 */
--space-12: 96px;  /* Hero 大留白 */
```

---

### 🔘 圓角系統（Border Radius）

| Token | 值 | 用途 |
|-------|-----|------|
| `--radius-sm` | 4px | 標籤、Badge |
| `--radius-md` | 8px | 按鈕、輸入框 |
| `--radius-lg` | 12px | 卡片 |
| `--radius-xl` | 16px | 模態窗、大卡 |
| `--radius-full` | 9999px | 圓形頭像、Pill 標籤 |

---

### ✨ 效果與動態規範（Motion System）

| 場景 | GSAP 方案 | 時長 | 緩動 |
|------|-----------|------|------|
| 頁面載入 - 卡片入場 | `gsap.from('.card', { opacity:0, y:12, stagger:0.05 })` | 350ms | `power1.out` |
| Hero 標題入場 | `gsap.from('.hero-title', { opacity:0, y:24, duration:0.7 })` | 700ms | `expo.out` |
| 捲動揭示 | ScrollTrigger + `{ opacity:0, y:12, duration:0.35 }` | 350ms | `power1.out` |
| 閱讀進度條 | CSS `scaleX()` + JS 動態更新 | 即時 | `none` |
| 工具欄顯示/隱藏 | `gsap.to('.toolbar', { autoAlpha: 1, y:0 })` | 200ms | `power2.out` |
| 頁面切換 | `gsap.fromTo` 淡入淡出 | 300ms | `power2.inOut` |

> ⚠️ **可及性原則**：所有動畫須通過 `gsap.matchMedia()` 偵測 `prefers-reduced-motion`，
> 若使用者啟用「減少動態效果」，一律將 `duration` 設為 `0`。

---

## 三、閱讀頁 UX 深度優化方案（Reader Mode）

> 核心目標：讓讀者「進入心流（Flow State）」，UI 應自動隱退，文字應完全主導。

### 🖥️ 版面配置

```
┌─────────────────────────────────────────────────┐
│ [進度條 ████████████░░░░░░░░░░░░]  2%           │  ← 頂部進度條（4px 高）
├─────────────────────────────────────────────────┤
│                                                 │
│          [上一章] 第 23 章：命運的轉折 [下一章]   │  ← 章節導航（細小、低對比）
│                                                 │
│  ┌───────────────────────────────────────┐      │
│  │                                       │      │
│  │   正文區域                            │      │
│  │   max-width: 680px（約 32-38 字/行）  │      │
│  │   line-height: 1.9（中文寬鬆行距）    │      │
│  │   font-size: 18px（預設，可調）       │      │
│  │   letter-spacing: 0.05em（中文間距）  │      │
│  │                                       │      │
│  └───────────────────────────────────────┘      │
│                                                 │
├─────────────────────────────────────────────────┤
│  [≡ 目錄]  [Aa 字體]  [☾ 夜間]  [⚙ 設定]      │  ← 底部浮動工具欄（滾動時淡出）
└─────────────────────────────────────────────────┘
```

### 🧠 低視覺疲勞設計原則

| 原則 | 實作策略 | 參數 |
|------|----------|------|
| **最佳閱讀行寬** | 限制正文容器寬度 | `max-width: 680px`（約 35 字/行） |
| **舒適行距** | 中文排版需更寬鬆 | `line-height: 1.9 ~ 2.0` |
| **字間距優化** | 中文略微增加字距 | `letter-spacing: 0.04em` |
| **段落間距** | 視覺分段，避免密集 | `margin-bottom: 1.5em` |
| **非純白底色** | 降低螢幕直視刺激 | 背景 `#FDFAF5`（暖白）|
| **字色非純黑** | 降低強烈對比疲勞 | 正文 `#2D2A27`（深暖棕）|
| **工具欄自動隱藏** | 向下捲動時隱藏，向上時顯示 | GSAP `autoAlpha` 切換 |
| **無干擾模式** | 雙擊進入全隱藏模式 | 隱藏所有 UI，再次雙擊恢復 |
| **三段背景主題** | 白紙 / 護眼 / 夜間 | CSS 變數一鍵切換 |
| **字體大小快調** | A- / A / A+ 三檔 | 14px / 18px / 22px |
| **記憶個人偏好** | 跨章節保持設定 | `localStorage` 儲存 |

### 📱 行動裝置閱讀優化

- 左右滑動切換章節（手勢）
- 點擊畫面中央顯示/隱藏工具欄
- 橫向模式自動縮小 max-width 至 90vw
- 底部安全區域 safe-area-inset-bottom 適配

---

## 四、完整開發里程碑（Milestone SOP）

### 🏁 Phase 0 ─ 環境建置（Week 1）

- [X] 確認技術棧：Next.js 15（App Router）+ TypeScript
- [X] 建立 Monorepo 結構（或單一 Next.js 專案）
- [X] 設定 ESLint / Prettier / Husky pre-commit hook
- [X] 建立 `/design-system/MASTER.md` 設計系統文件
- [X] 建立 `design-tokens.css`（全域 CSS 變數）
- [X] 設定 Google Fonts（Noto Serif TC + Noto Sans TC）
- [X] 建立 Git 分支策略（main / develop / feature/*）

---

### 🎨 Phase 1 ─ 設計基礎與元件庫（Week 2-3）

- [X] **全域樣式** (`global.css`)：Reset、Typography、Spacing、Color Tokens
- [X] **基礎元件**：
  - `Button`（Primary / Secondary / Ghost / Danger）
  - `Badge`（分類標籤）
  - `Card`（書籍卡片）
  - `Avatar`（作者頭像）
  - `Input` / `Textarea`
  - `Modal` / `Drawer`
  - `Tabs`
  - `Progress`（閱讀進度）
- [X] 深色 / 護眼模式切換機制（CSS 變數 + `data-theme` attribute）
- [X] GSAP 初始化與全域動畫設定（`gsap.defaults`、`matchMedia` 減少動態）
- [X] 響應式斷點確認（375 / 768 / 1024 / 1440px）

---

### 🏠 Phase 2 ─ 首頁開發（Week 4）

- [X] Hero Section（精選作品輪播 + 視差效果）
- [X] 分類快捷導航 Bar
- [X] 新書推薦卡片區（ScrollTrigger Stagger 入場）
- [X] 本週熱門排行（側邊欄 Widget）
- [X] 頁尾（Footer）
- [X] SEO：Meta 標題、描述、OG 圖片

---

### 📚 Phase 3 ─ 作品頁開發（Week 5）

- [X] 作品封面 + 資訊 Hero 區
- [X] 簡介摺疊展開（`line-clamp` + GSAP 展開動畫）
- [X] 章節列表（分捲、分頁、搜尋）
- [X] 讀者評分 + 評論區
- [X] 加入書架 / 分享功能
- [X] 相關推薦作品

---

### 📖 Phase 4 ─ 閱讀頁開發（Week 6-7）— 核心里程碑

- [X] 正文排版系統（max-width、line-height、letter-spacing）
- [X] 頂部閱讀進度條（CSS scaleX 動畫）
- [X] 上/下章節導航（鍵盤快捷鍵 ← →）
- [X] 浮動工具欄（捲動自動隱藏/顯示）
- [X] 字體大小切換（A- / A / A+）
- [X] 背景主題切換（白紙 / 護眼 / 夜間）
- [X] 無干擾模式（雙擊 Toggle）
- [X] `localStorage` 記憶使用者偏好
- [X] 行動裝置手勢支援（左右滑動換章）
- [X] 章節目錄 Drawer

---

### 🏆 Phase 5 ─ 排行榜頁（Week 8）

- [X] 週榜 / 月榜 / 總榜 Tab 切換
- [X] 各分類子排行
- [X] 排名徽章設計（Top 3 特別樣式）
- [X] 動畫切換效果（GSAP Timeline）

---

### ✍️ Phase 6 ─ 作者後台（Week 9-10）

- [X] 後台 Layout（側邊導航 + 主內容區）
- [X] 作品列表管理
- [X] 章節 Markdown 編輯器（支援中文輸入法）
- [X] 數據儀表板（Chart.js 折線圖、柱狀圖）
- [X] 草稿 / 發佈工作流

---

### 👤 Phase 7 ─ 使用者系統（Week 11）

- [X] 登入 / 註冊頁（Email）
- [X] 個人書架頁
- [X] 閱讀歷史紀錄
- [X] 帳號設定頁

---

### 🚀 Phase 8 ─ 品質審查與上線（Week 12）

- [ ] 跨瀏覽器測試（Chrome / Safari / Firefox / Edge）— **暫不執行**（需人工／實機）
- [ ] 行動裝置測試（iOS / Android）— **暫不執行**（需實機）
- [x] WCAG AA 無障礙審查 — 已補「跳至主要內容」Skip Link、修正表單元件 id（`Math.random()` → `useId`，消除 hydration 隱患）；表單 a11y（label/aria）與 `prefers-reduced-motion` 原已完善
- [~] Lighthouse 性能優化（目標 90+ 分）— 靜態面向已就緒（build/lint/type 全綠、Turbopack 產物、封面採 CSS 產生無破圖）；**實際分數量測需執行中伺服器 + Lighthouse，暫緩**
- [x] SEO 全站審查 — 補齊 `metadataBase`、`app/sitemap.ts`（靜態 + 作品 + 分類共 31 URL）、`app/robots.ts`（排除私有路由 + 指向 sitemap）、`app/opengraph-image.tsx`（1200×630 品牌 OG 圖）；per-page metadata 原已覆蓋 26 頁
- [ ] 生產環境部署（Vercel 推薦）— **暫不執行**（另註：上線前需將 `DATABASE_URL` 由 SQLite 切換至 PostgreSQL）
- [x] Analytics 埋點（GA4 / Plausible）— 新增 `src/components/Analytics.tsx`（GA4，由 `NEXT_PUBLIC_GA_ID` 啟用，未設定時完全不輸出 script）

> **Phase 8 執行紀錄（2026-07-22）**
> 依指示執行「可在本機完成」的品質項目，**部署／跨瀏覽器／行動實機測試不在此輪範圍**。
> - **SEO**：新增 `src/lib/siteConfig.ts`（集中站點網址，可用 `NEXT_PUBLIC_SITE_URL` 覆寫）、`sitemap.ts`、`robots.ts`、`opengraph-image.tsx`；`layout.tsx` 加入 `metadataBase` 使 OG／canonical 產生絕對連結。
> - **無障礙**：`SiteHeader` 新增鍵盤 Skip Link（focus 時滑入，點擊 focus 首個 `<main>`）；`Input`/`Textarea` 改用 `useId` 產生穩定 id。
> - **Analytics**：`Analytics` 元件掛入 `layout.tsx`，透過 `next/script` `afterInteractive` 載入 GA4，環境變數缺省即靜默。
> - **驗證**：`npm run build`、`npm run lint`、`npx tsc --noEmit` 皆通過；`/sitemap.xml`、`/robots.txt`、`/opengraph-image` 路由於建置產物中確認生成正確。
> - ~~**待辦（需外部條件）**：Lighthouse 實測分數、跨瀏覽器／行動實機測試、Vercel 部署、SQLite→PostgreSQL 切換。~~
>   **此清單已於 2026-08-08（FEAT-4 Phase 13）重新分類，原文四項並非同一類事**：
>   **Lighthouse 實測**（本機無頭瀏覽器即可，分數見 `README.md`）與**跨瀏覽器測試**
>   （Playwright 三引擎跑讀者流）**本機即可完成，已完成**；
>   **SQLite→PostgreSQL 切換**已由 FEAT-1 的雙軌設計解決（`DATABASE_PROVIDER` 切換，
>   兩軌整合測試各跑一輪結果一致）。真正需要外部條件的只剩**行動實機測試**與
>   **正式環境部署**（連同 FEAT-4 新增的**部署平台排程設定**共三項），見 `README.md`
>   「待外部條件」。把可於本機完成的事留在待辦清單裡，會讓真正做不到的那幾項失去份量。

### 🔐 Phase 9 ─ 信任邊界與雙軌基礎建設 ✅ 已完成（2026-07-24）

> 對應 `nextstep.md` 的安全審核與 `specs/001-trust-boundary-dual-track/`（FEAT-1）。詳細規格、任務清單與驗收見該目錄；本節僅記錄與本檔既有里程碑的對應關係。

- [x] **H-1**（身分驗證無伺服器端信任邊界）—— 自建 session（`jose` + HTTP-only Cookie + `Session` 表）+ 攔截層／layout／頁面三層守衛
- [x] **H-2**（密碼明碼儲存）—— `passwordHash` 改 argon2id 雜湊，移除登入頁示範帳密
- [x] **M-1**（註冊不檢查 Email 重複）—— 伺服器端 Zod + 唯一性檢查 + 409
- [x] **M-3**（Prisma 快取遺漏正式環境重用）—— singleton 不分環境掛 `globalThis`
- [x] **M-5**（`openGraph.url` 寫死網址）—— 改用 `SITE_URL`
- [x] **E-4 / E-5**（CSP／安全性標頭缺失）—— nonce + `'strict-dynamic'` 強制模式 CSP（`proxy.ts`）+ 五個標頭（`next.config.ts`）
- [x] **N-7 起步**（無測試框架）—— Vitest 單元／整合／a11y 三套件建立並綠燈；Playwright E2E 仍留待 Phase 13
- [ ] **H-3**（付費章節防護裝飾）—— 平台已定位全免費，本階段標為不適用，實際欄位移除屬 Phase 10（FEAT-2）

雙軌資料庫（SQLite／PostgreSQL 以 `DATABASE_PROVIDER` 切換）、CSP nonce 攔截層、10 案例整合測試（雙軌各一輪）與無障礙自動化檢查亦於本階段一併完成，達成 FEAT-1 的 13 條成功標準。

### 📦 Phase 10–12 ─ 真實內容、創作流與統計 ✅ 已完成

| Phase | 內容 | 規格目錄 | 完成日 |
| --- | --- | --- | --- |
| **Phase 10** | 真實資料模型與章節正文（N-1／N-2） | `specs/002-data-model-real-content/` | 2026-07-29 |
| **Phase 11** | 寫入 API —— 作者流（FEAT-3）與讀者互動（FEAT-4 4-A／4-B） | `specs/003-authoring-flow-search/`、`specs/004-reader-interaction-stats/` | 2026-07-31／2026-08-08 |
| **Phase 12** | 統計與排行（N-5／N-6／N-8） | `specs/004-reader-interaction-stats/` | 2026-08-08 |

逐項的完成定義勾選與執行紀錄見 `arch.md` §9 各該 Phase 與 `features.md` 的 3-A～4-D。

### 🚀 Phase 13 ─ 強化與上線 ✅ 已完成（2026-08-08，FEAT-4 4-D）

> 對應 `specs/004-reader-interaction-stats/`（FEAT-4）的 T147～T162。詳細規格與驗收見該目錄；
> 本節只記錄與本檔既有里程碑的對應關係。

- [x] **新增功能的 CSP 相容性回歸**（政策未放寬）
- [x] **評論／留言速率限制上線**（`INTERACTION_RATE_MAX`，預設每分鐘 10 次／使用者）
- [x] **N-7 完成**（測試框架）—— Playwright 其餘三條主流程（讀者流、越權流、無障礙流）交付，
      四條共 8 案全綠；讀者流另於 **chromium／firefox／webkit 三引擎**通過
- [x] **Lighthouse 本機實測**—— 首頁 58／**96**／81／100、閱讀頁 63／**96**／81／100
      （Performance／Accessibility／Best Practices／SEO），**無障礙兩頁皆 ≥ 95**，四項分數與
      未達滿分的成因已寫入 `README.md`
- [x] **雙軌整合測試各跑一輪且結果完全一致**—— 兩軌**各 64 檔 554 案**全綠
- [x] **三道綠燈閘門**—— `npm run build`／`npm run lint`／`npx tsc --noEmit` 全過
- [ ] ⏸ **待外部條件（MUST NOT 標記為已完成，憲章第 IV 條）共三項**——
      真實行動裝置實機測試、正式環境 PostgreSQL 部署驗證、部署平台的排程設定。
      三項的「為何本機做不到」與「需要什麼」見 `README.md`「待外部條件」

**本階段另交付的兩項防漂移測試**（都是把一次性的 `grep` 換成會持續變紅的檢查）：
`tests/unit/feat4-scan.test.ts`（造假資料來源、已失效的文案主張、假成功提示掃全站；
硬編色碼與亂數元件 id 只掃本階段檔案並比對既有基線）與 `tests/unit/layering.test.ts`
的 T152 擴充（本階段新增的服務／資料存取／Route Handler／頁面全數納入分層稽核）。

**已知基線（看見後刻意留下，非遺漏）**：全站 20 個檔案的硬編色碼、兩處 `Math.random()`
產生的元件 id，以及首頁與閱讀頁尚未達 WCAG AA 的既有對比命中點 —— 成因是設計 token 本身，
清理它屬設計層級決定，應另開需求。清單見 `README.md`「已知基線」。

### ✉️ Phase 14 ─ 郵件基礎設施、密碼救援與聯絡管道 ✅ 已完成（2026-08-11，FEAT-5）

> 對應 `specs/005-email-recovery-contact/`（FEAT-5）與 GitHub issue #5／#6。
> 詳細規格、任務清單（75 個）與驗收見該目錄；逐項完成定義見 `arch.md` §9 Phase 14 與 `features.md` FEAT-5。
> 本節依憲章「開發流程與品質閘門」記錄里程碑狀態，**交付時 MUST 於同一輪回填勾選與執行日期**
> （`tasks.md` `T064a`；本節先前不存在，Phase 進度表停在 Phase 13，
> 為 `/speckit-analyze` 第三輪 2026-08-09 補入）。

- [x] **寄送能力**（`Mailer` 薄介面 + 三種實作，由 `MAIL_MODE` 顯式選用；Resend 以 `fetch` 直呼，不引入 SDK）
- [x] **密碼救援**（`PasswordResetToken` + 申請／重設兩個端點；申請的寄送以 `after()` 排在回應之後）
- [x] **聯絡管道**（`CONTACT_EMAIL` 設定化、隱私權頁直接列出位址、聯絡表單解除停用並接上寄送）
- [x] **誠實標示收尾**（移除兩類已失效主張、README 兩列改寫 + 一列新增、擴充全站掃描）
- [x] **三綠燈與四套測試**、雙軌整合測試各一輪結果一致 ——
      單元 29 檔 440 案、整合 76 檔 602 案、a11y 3 檔 42 案、E2E 8 案全綠；
      **PostgreSQL 軌 76 檔 602 案與 SQLite 軌逐項一致**，且本輪是手寫的
      `20260810064412_5b_password_reset` **第一次被實際套用**（產生它的當下本機無 PostgreSQL 亦無 Docker）
- [ ] ⏸ **待外部條件（MUST NOT 標記為已完成，憲章第 IV 條）共三項**——
      Resend 帳號與 `RESEND_API_KEY`、對外寄件網域，以及該網域的 **SPF／DKIM／DMARC 三筆 DNS 記錄**。
      **第三項最容易被誤判為完成**：缺了它系統照樣回報「已寄出」而使用者收不到信，
      **驗收 MUST NOT 以「系統回報成功」充當送達**。
      連帶**兩項驗收同樣維持未達成**：聯絡表單「訊息確實送達營運信箱」與
      隱私權頁位址「經外部信箱實測寄達」（`tasks.md` T043(b)）—— 兩者的驗收對象都是**送達**

### 🚢 Phase 15 ─ 正式上線就緒：資料防呆、子路徑、容器化與自動部署 ✅ 程式碼與文件側完成（2026-08-15，FEAT-6）

> 對應 `specs/006-production-launch-readiness/`（FEAT-6）與 GitHub issue #7／#8／#9。
> 詳細規格、任務清單（62 個）與驗收見該目錄；逐項完成定義見 `arch.md` §9 Phase 15 與
> `features.md` FEAT-6。本節依憲章「開發流程與品質閘門」記錄里程碑狀態。

- [x] **正式環境資料安全**（`prisma/seedGuard.ts` 的放行守衛在任何 prisma 呼叫之前、
      `npm run db:clear-content` 只清 21 張內容表且**只能互動執行**、空庫四頁整合測試）
- [x] **子路徑相容**（`basePath` 由環境變數驅動、`proxy.ts` 兩處轉址、**26 處** client API
      呼叫點改經 `src/lib/apiUrl.ts`、`SESSION_COOKIE.path`、Caddy 供給合併版 `robots.txt`）
      ＋ **第五套測試** `npm run test:basepath`
- [x] **容器化**（`Dockerfile` 三 stage、`deploy/compose.yml` 四服務、啟動期 `migrate deploy`、
      參考分類改由冪等 migration、每日備份 + 異地上傳、四服務日誌上限）
- [x] **自動部署**（`ci.yml` 十一步閘門 → `workflow_run` 觸發 `deploy.yml` →
      破壞性偵測分流至全自動或人工核准 → 健康檢查 → 清理舊映像；`rollback.yml` 手動回滾）
- [x] **人工清單與文件同步**（`deploy/deployment.md` §6 的 A 區 19 項／B 區 11 項，每項附
      「沒做會怎樣」；失效原文逐處取代而非並存；新增 §10「回滾」章節）
- [x] **三綠燈與五套測試**（2026-08-15）——`build`／`lint`／`tsc --noEmit` 全綠；
      `npm run test:all` 離開碼 0：單元 482／整合 608／a11y 42／E2E 8／子路徑 4。
      **既有三套（整合／a11y／E2E）逐案與本階段開始前相同**（SC-019）
- [ ] ⏸ **待外部條件（MUST NOT 標記為已完成，憲章第 IV 條）共六項**——
      SC-020（乾淨機器一道指令）、SC-021（重開機自行恢復）、SC-022（一次真實合併全自動）、
      SC-023／SC-028（回滾實測）、SC-027（異地備份實際還原）、
      **SC-024（由一位未參與開發的人依清單實際走一次前置作業）**。
      前五項需一台已開通的 Oracle ARM 主機（其中 SC-022／023／028 另需已註冊的
      self-hosted runner），**第六項需要的是另一個人**

---

## 四之一、待開發頁面與功能（死連結盤點後續）

> **背景**：於連結盤點（2026-07-21）中發現數個指向未開發路由的死連結。
> 已完成「B 類」處置：可導向現有頁的改為有效連結、無對應頁且短期不開發的連結一律移除，並重新設計頁尾／導覽版面。
> 以下為「A 類」剩餘項目——這些是**未來仍規劃開發**的獨立頁面／功能，暫以工作項目形式記錄追蹤。

### 🔍 P1 ─ 全站搜尋（Search）✅ 已完成（2026-07-21）
- [X] 導覽列搜尋按鈕（`#search-btn`）改為導向 `/search`
- [X] 搜尋結果頁（`/search?q=`）— server component 依網址 q 預算結果（可分享、可重載），client `SearchView` 負責輸入與導向
- [X] 搜尋範圍：小說標題、作者、分類、標籤（`searchNovels()`，不分大小寫）
- [ ] （後續）接入真實全文搜尋索引（PostgreSQL 全文檢索 或 外部搜尋服務）取代目前的記憶體字串比對

### 📚 P2 ─ 書庫總覽頁（`/novels`）✅ 已完成（2026-07-21）
- [X] 所有小說列表頁（`getAllNovels()` 去重匯總全站作品）
- [X] 分類篩選（CATEGORIES chips）+ 排序（評分／人氣／字數／章節）+ 頁內關鍵字搜尋 + 「載入更多」分頁
- [X] 抽出共用 `NovelCard` 元件（首頁新書區、書庫、搜尋結果共用）
- [X] 恢復導覽列「書庫」與頁尾「所有小說」連結

### 🗂️ P3 ─ 分類篩選頁（`/categories`、`/categories/[id]`）✅ 已完成（2026-07-22）
- [X] 分類總覽頁（`getCategories()` + `getCategoryCounts()`，各分類含作品數量）
- [X] 各分類篩選頁（`/categories/[id]`，`getNovelsByCategory()`，含分類 Hero 與排序）
- [X] 首頁分類快捷區（CategoryNav）恢復導向 `/categories/[id]`
- [X] 導覽列「分類」項已補回

### 🆕 P4 ─ 新書上架頁（`/new-releases`）✅ 已完成（2026-07-22）
- [X] 新書列表頁（`getNewNovels()`，依上架時間 `releasedAt` 排序）
- [X] 首頁「新書推薦」區的「查看全部」按鈕已恢復，導向 `/new-releases`

### ✍️ P5 ─ 作者功能延伸頁 ✅ 已完成（2026-07-22）
- [X] 開始創作（`/author/create`）— 新增作品表單流程（分類取自 DB；寫入 API 待補）
- [X] 創作指南（`/author/guide`）— 靜態說明頁（四步驟 + 寫作技巧）
- [X] 作者收益（`/author/earn`）— 預估收益儀表板（依 `getAuthorSummary()` 換算）
- [X] 作者後台側邊欄與頁尾對應連結已補回

### 📄 P6 ─ 平台資訊與法務頁（靜態內容）✅ 已完成（2026-07-22）
- [X] 關於 NovelSite（`/about`）、幫助中心（`/help`）、聯絡我們（`/contact`，含表單）
- [X] 隱私政策（`/privacy`）、服務條款（`/terms`）— 共用 `StaticPage` 版面
- [X] 頁尾已恢復「平台」「法務」連結區塊
- [ ] （後續）平台動態（`/blog`）、網站地圖（`/sitemap`）待內容就緒後補上
- [ ] （後續）社群連結（GitHub / Twitter / Discord）待有正式帳號後於頁尾補回

---

## 五、技術棧建議

| 層級 | 技術選擇 | 理由 |
|------|----------|------|
| **框架** | Next.js 15（App Router）| SSR/SSG 對 SEO 友善，繁體中文小說需要良好爬蟲支援 |
| **語言** | TypeScript | 型別安全，大型專案必要 |
| **樣式** | Vanilla CSS + CSS Variables | 最大靈活度，設計 Token 系統完整 |
| **動畫** | GSAP 3（ScrollTrigger + Timeline）| 專業級動畫，閱讀體驗關鍵 |
| **字型** | Google Fonts Noto 系列 | 最完整的 CJK 繁體字型支援 |
| **圖示** | Phosphor Icons（SVG）| 一致性高，支援 Tree-shaking |
| **後端** | Next.js API Routes + Prisma | 初期 MVP 可快速迭代 |
| **資料庫** | SQLite（Prisma + better-sqlite3 driver adapter）| MVP 階段零維運成本；**可抽換設計**：切換 PostgreSQL 僅需改 `prisma/schema.prisma` 的 `datasource.provider`、`src/lib/db.ts` 的 driver adapter 與 `.env` 連線字串，上層一律透過 `src/lib/repositories/*` 存取，不受影響 |
| **認證** | NextAuth.js | 社群登入 + Email 整合完善 |
| **部署** | Vercel | Next.js 官方最佳化平台 |

---

> 📝 **下一步行動**：請確認以上規劃是否符合您的期望，批准後我們將從 **Phase 0 環境建置** 開始，逐步執行。
