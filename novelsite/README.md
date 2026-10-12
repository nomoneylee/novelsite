# NovelSite

繁體中文原創文學閱讀平台。Next.js 16（App Router）+ Prisma 7（雙軌 SQLite／PostgreSQL）。

## 快速開始（開發軌，預設 SQLite）

```bash
npm install
cp .env.example .env   # 若無範例檔，見下方「環境變數」自行建立
npm run db:schema      # 產生兩軌 Prisma schema
npm run db:migrate     # 套用 migrations/sqlite/
npm run db:seed        # ⚠️ 僅開發環境：會先清空全部資料表，再寫入示範資料與三個示範帳號
npm run dev
```

開啟 [http://localhost:3100](http://localhost:3100)。

> **為何不是慣例的 3000**：Windows 上啟動 Docker Desktop 後，Hyper-V／WinNAT 會動態保留
> 一段涵蓋 3000 的連接埠（`netsh int ipv4 show excludedportrange protocol=tcp` 可查），
> 此時 `next dev` 會以 `EACCES: permission denied 0.0.0.0:3000` 失敗 —— 是**保留**而非佔用，
> 故錯誤碼不是 `EADDRINUSE`，用 `netstat` 也看不到任何佔用者。3100 落在保留範圍外。
> E2E 使用的 3210 埠同樣在範圍外，不受影響。

## 雙軌資料庫（開發／正式）

單一設定值 `DATABASE_PROVIDER`（`sqlite` 或 `postgresql`）切換資料庫種類；資料模型定義只有一份
（`prisma/base.prisma`），兩軌各自的 datasource／generator 與 migration 歷史完全獨立。

```bash
# 開發軌（SQLite，預設）
npm run db:migrate
npm run db:seed
npm run dev

# 正式軌（PostgreSQL）—— 需先 docker compose up -d 啟動本機 PostgreSQL
docker compose up -d
DATABASE_PROVIDER=postgresql DATABASE_URL="postgresql://novelsite:novelsite@localhost:5432/novelsite_dev" npm run db:migrate
DATABASE_PROVIDER=postgresql DATABASE_URL="postgresql://novelsite:novelsite@localhost:5432/novelsite_dev" npm run db:seed
DATABASE_PROVIDER=postgresql DATABASE_URL="postgresql://novelsite:novelsite@localhost:5432/novelsite_dev" npm run build
```

切換軌別前 **MUST** 重新執行 `npm run db:generate` ——
兩軌共用同一個產生物輸出目錄（`src/generated/prisma`），沿用前一軌的產生物會連到錯誤的資料庫種類，
症狀是 `The Driver Adapter @prisma/adapter-better-sqlite3, based on sqlite, is not compatible with
the provider postgres specified in the Prisma schema`。

**哪些指令已內建這一步**（2026-08-11 更正，原文的「`db:migrate`／`db:seed`／`build` 已內建」
三項中有兩項不成立 —— 照著它做的人會在切軌後撞上上面那個錯誤，而錯誤訊息不會提到是誰該負責產生）：

| 指令 | 內建 `db:generate`？ | 說明 |
| --- | --- | --- |
| `npm run db:migrate` | **是** | 自身鏈 `db:schema`，且 `prisma migrate dev` 會順帶產生 |
| `npm run db:reset` | **是** | 同上 |
| `npm run test` | **是**（2026-08-11 補上） | 先前是裸 `vitest run`。四個測試指令中**唯一沒有的那一個**，而它正是切軌後最常被跑的 |
| `npm run test:integration`／`test:a11y` | **是** | `tests/globalSetup.ts` 第一步即 `db:generate` |
| `npm run test:e2e` | **是** | `playwright.config.ts` 的 `webServer.command` 第一步即 `db:generate` |
| `npm run db:seed` | **否** | 只跑 `tsx prisma/seed.ts`；切軌後 MUST 自行先 `db:generate` |
| `npm run build` | **否** | 只跑 `next build`。**部署時 MUST 自行先跑**，見 `deploy/deployment.md` §3 |

### PostgreSQL 軌產生 migration 需要 shadow database

`prisma migrate dev`（以及 `migrate diff --from-migrations`）需要一個 shadow database 才能
產生 migration。Prisma 7 **已移除 `--shadow-database-url` 旗標**，只能由 `prisma.config.ts` 的
`datasource.shadowDatabaseUrl` 提供 —— 本專案已設定，預設指向 `docker-compose.yml` 內建的
`novelsite_shadow`（由 `scripts/init-test-db.sql` 於容器**首次**初始化時連同 `novelsite_test` 一併建立），
可由 `SHADOW_DATABASE_URL` 覆寫。未設定時的錯誤訊息不會指向這裡，新進開發者會直接撞上。

> 若你的 `novelsite_postgres_data` volume 建立於 2026-08-08 之前，其中可能缺 `novelsite_shadow`
> （該行當時未寫進 init 腳本）。補建方式：
> `docker compose exec postgres psql -U novelsite -d postgres -c "CREATE DATABASE novelsite_shadow;"`

**警告：postgres 軌執行 `migrate dev` 會產生一支「DROP INDEX `Novel_searchText_trgm_idx`」的 migration。**
該 GIN 索引是 FEAT-3 手寫於 `3a_search` 的 `migration.sql`、**刻意不寫進 model 定義**（Prisma schema 表達不了 `gin_trgm_ops`），
於是 `migrate dev` 每次都把它視為「資料庫多出來的東西」而要求刪除。
**處置**：postgres 軌若需產生 migration，MUST 於事後檢查產物是否含這一行 DropIndex；
若有，MUST 刪除該行（或改回 `migrate diff --from-schema ... --to-schema ...`，該作法不比對實體資料庫故不會誤判），
並確認 `Novel_searchText_trgm_idx` 仍存在。2026-08-08 實測時已誤產生一次並已還原。

## 正式環境的資料操作（FEAT-6）

**這一節的每一項都沒有復原路徑。** 正式環境是 PostgreSQL + 真實使用者資料，
以下三件事誤做一次即資料全滅或帳號外洩，而症狀出現時已經來不及。

### `npm run db:seed` **MUST NOT** 於正式環境執行（FR-066、FR-070）

`db:seed` 的第一個動作是 `clearAll()`：**先清空全部 23 張資料表，再寫入 13 部示範小說
與 reader／author／admin 三個示範帳號**。接上正式資料庫誤跑一次，全站作品、章節、
使用者、評論與統計一起消失，且**本專案沒有任何自動還原機制**。

自 FEAT-6 起有程式層守衛（`prisma/seedGuard.ts`，在任何資料庫呼叫之前）：

| 情形 | 結果 |
| --- | --- |
| `DATABASE_PROVIDER=sqlite`（開發預設）且 `NODE_ENV` 非 `production` | 放行，行為與 FEAT-6 之前完全相同 |
| `DATABASE_PROVIDER=postgresql`（不論 `NODE_ENV`） | **拒絕**，非 0 離開碼，零列變動 |
| `NODE_ENV=production` | **拒絕**，同上 |
| `SEED_ALLOW_DESTRUCTIVE=1` | 放行——**僅供 `arch.md` §10.5 的 PostgreSQL 軌測試使用** |

`SEED_ALLOW_DESTRUCTIVE` **MUST NOT 出現在正式環境的 `.env`**：它出現在那裡等於守衛失效。
測試軌由 `tests/testEnv.ts` 以程式注入，**刻意不寫進版控的 `.env.test`**——
把放行旗標寫在版控檔裡，等於在 repo 裡留一行「複製貼上就能繞過守衛」的示範。

守衛擋下時的錯誤訊息**刻意不提示旗標用法**：那段訊息會被複製貼上，而那正是誤操作的成因。

### `SEED_USER_PASSWORD` **MUST NOT** 設定於正式環境（FR-070）

設了它，三個示範帳號就有一組**可登入**的已知密碼。若正式站上曾以示範帳號
（`reader@novelsite.tw`／`author@novelsite.tw`／`admin@novelsite.tw`）登入過，
**MUST 立即刪除該等帳號**——它們的存在本身就是一組公開在原始碼裡的登入憑證。

### `npm run db:clear-content`：清除內容資料，保留站方參考資料（FR-067、FR-068）

```bash
npm run db:clear-content   # ⚠️ 只能互動執行，無任何旗標可略過確認
```

用途是「把示範資料清乾淨、留下站台本來就該有的東西」：清空 **21 張內容資料表**
（作品、章節、使用者、互動、統計…），**保留 `Category` 與 `Tag`**——
分類是 migration 建立的站方參考資料，標籤是站方詞彙表，作品沒了它們仍然成立。

執行序列：印出 23 張表的**前置列數報表**（清除類與保留類分區顯示，密碼以 `***` 遮蔽）
→ 要求輸入**目標資料庫名稱**且完全相符才繼續 → 單一交易內刪除 → 印出後置報表。

**非互動環境（`process.stdin.isTTY !== true`）一律拒絕，且 MUST NOT 提供任何略過確認的旗標**：
本指令不應有任何自動化用途。列數報表存在的理由是讓操作者有機會發現
「這台不是我以為的那台」——只有確認字串而沒有列數，等於在對一個看不見的東西打字。

## 測試

```bash
npm run test              # 單元測試（node 環境，不需伺服器）
npm run test:integration  # 整合測試（套用測試 DB → next build → next start → 打真實 HTTP）
npm run test:a11y         # 無障礙測試（axe-core，本階段新增／修改頁面 + FR-043b 八個空狀態）
npm run test:e2e          # 端對端（Playwright，四條流程；獨立 e2e.db 與 3210 埠）
npm run build && npm run lint && npx tsc --noEmit
```

`test:e2e` 涵蓋四條流程：**作者流**（FEAT-3）、**讀者流**、**越權流**、**無障礙流**（FEAT-4）。
其中**只有讀者流跑三種引擎**（chromium／firefox／webkit，FR-059），其餘維持 chromium ——
跨引擎要驗的是排版、鍵盤與儲存行為的基礎相容性，四條各跑三次只會把時間乘三。

### 測試前置步驟：安裝瀏覽器執行檔

`test:e2e` **需先安裝瀏覽器執行檔**（CI 上尤其容易漏）：

```bash
npx playwright install --with-deps chromium firefox webkit
```

這是一次性的二進位下載，**本機即可完成**，故它是前置安裝步驟而**不是**「待外部條件」——
把它列為待外部條件會與 FR-059／SC-013「讀者流 MUST 於三種引擎執行**並通過**」直接衝突：
同一件事不可能既是必須通過的驗收、又是不必完成的外部條件。

`npm run build` **需要環境變數**（`SESSION_SECRET`、`DATABASE_URL` 等）：建置階段會收集頁面資料，
而 `src/lib/env.ts` 在設定不足時**明確失敗、不靜默降級**（FR-049）。沒有 `.env` 時直接跑會看到
「環境變數驗證失敗」而非建置錯誤 —— 那是設計如此。三個測試指令各自以
`tests/testEnv.ts` 帶入測試專用設定，不受此影響。

`test:integration` 可分別對兩個資料庫種類各跑一輪，兩輪結果須完全一致：

```bash
DATABASE_PROVIDER=sqlite     npm run test:integration
DATABASE_PROVIDER=postgresql npm run test:integration
```

測試環境設定來自隨 repo 版控的 `novelsite/.env.test`（只含測試專用值），開發者 clone 後不需
額外手動設定即可執行 `test:integration`。詳見 `specs/001-trust-boundary-dual-track/quickstart.md`。

## 環境變數

正式／開發環境設定放在 `novelsite/.env`（已被 `.gitignore` 忽略，需自行建立）。
正式環境的範例檔為 `deploy/.env.production.example`（只有變數名與用途，零實際值）。

### 建置期常數 vs 執行期變數（FEAT-6）

**改了哪些變數要重新建置映像、改了哪些重啟就好，是兩件不同的事。**
分錯的症狀不是錯誤訊息，而是**改了設定卻沒生效，而系統一切正常**。

| 類別 | 變數 | 改動方式 |
| --- | --- | --- |
| **建置期常數** | `NEXT_PUBLIC_BASE_PATH`、`NEXT_PUBLIC_SITE_URL`、`NEXT_PUBLIC_GA_ID` | **MUST 重新建置映像**。寫進 `.env` 再重啟**不會生效，且不會有任何錯誤訊息** |
| **執行期變數** | 下表其餘全部（`DATABASE_URL`、`SESSION_SECRET`、`CRON_SECRET`、`RESEND_API_KEY`…） | 改 `.env` + `docker compose up -d` 即生效 |

三個 `NEXT_PUBLIC_*` 會在 `next build` 時被 **inline 進 client bundle**（Next 官方文件明載），
所以它們的值在映像建出來的那一刻就固定了。最常見的誤認是把 `NEXT_PUBLIC_SITE_URL`
當成執行期變數去改——症狀是**密碼重設信裡的連結還是舊網域**，而站台本身完全正常，
沒有任何一處會告訴你「這個值沒有被讀到」。

故三者 MUST 由 `novelsite/Dockerfile` 的 `ARG`／`ENV` 於建置期注入，
MUST NOT 只寫在 `env_file`。反過來，執行期密鑰 MUST NOT 寫進 `ARG`——
那會讓它留在映像層裡（`docker history` 看得到）。

### 變數一覽

| 變數 | 必填 | 預設 | 說明 |
| --- | --- | --- | --- |
| `DATABASE_PROVIDER` | 否 | `sqlite` | `sqlite` \| `postgresql` |
| `DATABASE_URL` | **是** | — | 連線字串，須與 `DATABASE_PROVIDER` 的協定相符 |
| `SESSION_SECRET` | **是** | — | jose 簽章密鑰，**≥ 32 bytes**，不得為範例值 |
| `SESSION_TTL_DAYS` | 否 | `30` | 閒置期限（滑動延展的目標天數） |
| `SESSION_ABSOLUTE_TTL_DAYS` | 否 | `90` | 絕對上限，Cookie `Max-Age` 取此值換算的秒數 |
| `SESSION_SLIDING_THROTTLE_HOURS` | 否 | `24` | 滑動延展的節流門檻 |
| `SESSION_COOKIE_SECURE` | 否 | `NODE_ENV === 'production'` | 工作階段 Cookie 是否加上 `Secure`。**唯一的正當關閉理由是以正式建置產物在 `http://localhost` 上跑跨引擎 E2E**（WebKit 不把 `http://localhost` 當成安全內容，會直接丟棄 `Secure` 的 Cookie）。只認字面上的 `false`，其餘值一律回退到預設；於正式環境關閉時啟動記錄會明確警示。**MUST NOT 用於任何對外部署** |
| `TRUSTED_PROXY_HOPS` | 否 | `0` | 可信任的代理層數；部署於代理／CDN 後方**必須**設定，否則所有請求會被視為同一來源位址 |
| `HEALTH_CHECK_SECRET` | 否 | — | `/api/health` 詳細資訊（provider／延遲等）的存取密鑰；未設定時該端點一律只回 `{ ok }` |
| `SEED_USER_PASSWORD` | 否 | — | 示範帳號密碼；未設定則三個帳號**各自**隨機產生並印於 `db:seed` 執行紀錄。**正式環境 MUST NOT 設定**（FR-070，見「正式環境的資料操作」） |
| `SEED_ALLOW_DESTRUCTIVE` | 否 | — | `db:seed` 的放行旗標，只認字面上的 `1`。**MUST NOT 出現在正式環境的 `.env`**——僅供 PostgreSQL 軌測試（由 `tests/testEnv.ts` 注入，不寫進 `.env.test`） |
| `LOGIN_RATE_IP_MAX` | 否 | `5` | 登入位址鍵上限（每分鐘） |
| `LOGIN_RATE_ACCOUNT_MAX` | 否 | `5` | 登入帳號鍵上限（每 15 分鐘） |
| `REGISTER_RATE_IP_MAX` | 否 | `3` | 註冊位址鍵上限（每小時） |
| `VIEW_HASH_SECRET` | **是** | — | FEAT-4：閱讀去重雜湊 `ChapterView.viewerHash` 的**固定**鹽值，**≥ 32 bytes**。缺漏或過短即拒絕啟動 |
| `CRON_SECRET` | 否 | — | FEAT-4：三個 `/api/cron/*` 入口的 Bearer 密鑰。**未設定不阻擋啟動，但那三個入口一律回 401** |
| `VIEW_DEDUPE_WINDOW_MINUTES` | 否 | `30` | 閱讀去重窗口（分鐘） |
| `VIEW_RETENTION_DAYS` | 否 | `7` | 閱讀明細與收藏事件的保留期；同時是成效總覽期間的上界 |
| `CHAPTER_VIEW_RATE_MAX` | 否 | `60` | 閱讀上報上限（每分鐘／來源位址）；超額為靜默捨棄，非 429 |
| `INTERACTION_RATE_MAX` | 否 | `10` | 評論與留言上限（每分鐘／使用者） |
| `READING_HISTORY_MAX` | 否 | `500` | 每人閱讀歷史上限（部作品） |
| `MERGE_BATCH_MAX` | 否 | `200` | 本機狀態合併時每類的筆數上限 |
| `NOTIFICATION_RETENTION_DAYS` | 否 | `90` | 通知保留期（天） |
| `PROGRESS_REPORT_INTERVAL_SECONDS` | 否 | `30` | 閱讀進度的節流上報間隔（秒） |
| `CRON_BASE_URL` | 否 | `http://localhost:3100` | `scripts/cron.ts` 觸發排程時的目標站台 |
| `NEXT_PUBLIC_SITE_URL` | `MAIL_MODE=production` 時**是** | `https://novelsite.tw` | 站台網址單一來源，供 metadata／sitemap／robots 共用。**FEAT-5 起它同時是密碼重設連結的絕對網址來源（FR-016a）**，故 `MAIL_MODE=production` 下未明示即拒絕啟動——沿用回落值會把使用者的重設連結指向一個未必是本站的網域 |
| `NEXT_PUBLIC_GA_ID` | 否 | — | Google Analytics 4 埋碼；未設定則完全不輸出分析腳本 |
| `MAIL_MODE` | 否 | 依 `NODE_ENV` 推導（`production` → `production`，其餘 → `console`） | FEAT-5：寄送實作的**唯一**選用依據。`production` 真寄、`memory` 寫入 outbox 檔（測試用）、`console` 印到主控台（本機用）。**三值以外一律拒絕啟動**——拼成 `prod` 若靜默退到 `console`，正式站會毫無徵兆地一封信也不寄 |
| `RESEND_API_KEY` | `MAIL_MODE=production` 時**是** | — | FEAT-5：Resend 的 API 金鑰。缺漏時錯誤訊息**指名這一項**（不是籠統的「郵件設定不完整」） |
| `MAIL_FROM` | `MAIL_MODE=production` 時**是** | — | FEAT-5：寄件位址，**MUST NOT 寫死於原始碼**。該網域需備妥 SPF／DKIM／DMARC，見「待外部條件」 |
| `CONTACT_EMAIL` | 否 | `contact@example.com` | FEAT-5：對外聯絡信箱，同時是隱私權頁「你的權利」列出的位址與聯絡表單的收件人。未設定時採用過渡預設值**並於啟動記錄標示**。**變更只需改設定並重啟，不需重新建置**（`/privacy` 與 `/contact` 已標 `force-dynamic`） |
| `PASSWORD_RESET_TOKEN_TTL_MINUTES` | 否 | `30` | FEAT-5：重設憑證有效期（分鐘）。信件文案的分鐘數取自此值，**未寫死於文案** |
| `PASSWORD_RESET_RATE_ACCOUNT_MAX` | 否 | `3` | FEAT-5：重設申請的**帳號鍵**額度（每小時）。**位址鍵沿用 `LOGIN_RATE_IP_MAX`**，刻意不另立變數——多一個就多一個會與登入漂移的值 |
| `CONTACT_RATE_IP_MAX` | 否 | `3` | FEAT-5：聯絡表單的位址鍵額度（每小時） |
| `MAIL_OUTBOX_PATH` | 否 | `novelsite/.mail-outbox.jsonl`（基準是 `process.cwd()`，即應用根**而非 repo 根**） | FEAT-5：僅 `memory` 模式使用的寄件落地檔。基準寫錯會使 `novelsite/.gitignore` 的 `/.mail-outbox.jsonl` 錨定管不到該檔而被版控追蹤 |
| `MAIL_MEMORY_DELAY_MS` | 否 | `0` | FEAT-5：僅 `memory` 模式使用，寫入 outbox 前先等這麼久。`.env.test` 設 `300`——那是「寄送確實在回應之後」那道測試的**解析度**，設 0 會使該測試失去鑑別力 |

**部署與維運側的三個變數（FEAT-6 新增）**——它們**不進應用程式行程**，
`src/lib/env.ts` 不讀也不驗它們，故缺漏時**不會有任何啟動錯誤**：

| 變數 | 落點 | 說明 |
| --- | --- | --- |
| `NOVELSITE_TAG` | 主機 `/srv/sites/.env`（compose 的變數展開，非容器環境） | 目前要跑哪一個映像標記（`image: novelsite:${NOVELSITE_TAG:-latest}`）。部署與回滾改的就是它。**缺漏時回落到 `:latest`——症狀是「回滾成功但站台完全沒變」** |
| `BACKUP_PAR_URL` | `cron` 容器（`novelsite/.env`） | 備份上傳的 OCI PAR 網址（權限型別 `AnyObjectWrite`，**列不到也刪不掉**）。遠端保留 7 份由 bucket 生命週期規則承擔，不由腳本刪除 |
| `DEPLOY_ALERT_TO` | GitHub repo variable（另需 repo secret `RESEND_API_KEY` 與 variable `MAIL_FROM`） | 部署／備份失敗通知的收件位址（`deploy/notify.sh`）。三者缺任一即通知寄不出去，而**它失效的時刻正是你需要它的時刻** |

**`RESEND_API_KEY` 有兩份且屬不同信任邊界**（站台 `.env` 一份、GitHub repo secret 一份），
輪替時 MUST 同時更新兩處——只換一份會讓其中一條路徑靜默失效。

**`SESSION_SECRET` 與 `VIEW_HASH_SECRET` 缺漏或長度不足 32 bytes（`SESSION_SECRET` 另含等於範例值）
時應用程式會拒絕啟動並明確報錯**——這是預期行為，MUST NOT 自動產生臨時密鑰：
前者重啟會無聲登出全站使用者，後者重啟會讓全部匿名讀者被當成新讀者、成效數字隨部署跳動。

```bash
# 兩個密鑰各產一組
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

完整規則與啟動期驗證邏輯見 `specs/001-trust-boundary-dual-track/contracts/env.md`。

## 排程作業接法（FEAT-4）

三個排程入口是 `POST` 的 Route Handler，授權為 `Authorization: Bearer $CRON_SECRET`
（`timingSafeEqual` 比對；**密鑰未設定時一律回 401**，不因未設定而放行）。
版控內附觸發指令，**應用程式行程內不跑常駐排程器**：

```bash
npm run cron:rollup     # → POST $CRON_BASE_URL/api/cron/rollup-stats     每日統計彙總 + 三張表的保留期清理
npm run cron:rankings   # → POST $CRON_BASE_URL/api/cron/rankings         排行重算（三週期 ×（全站 + 各分類））
npm run cron:publish    # → POST $CRON_BASE_URL/api/cron/publish-scheduled 到期章節發佈 + 追更通知
```

三者皆讀 `CRON_BASE_URL`（預設 `http://localhost:3100`）與 `CRON_SECRET`，
失敗以非 0 離開碼結束 —— 排程器靠它判斷「這次跑成功了沒有」。

### 建議頻率

| 作業 | 頻率 | 理由 |
| --- | --- | --- |
| `cron:publish` | 每 5～15 分鐘 | 排程發佈的**延遲上限就是這個間隔**；作者排在 20:00 而每小時才跑一次，最晚 20:59 才會上線 |
| `cron:rollup` | 每日一次，台北 00:30 之後 | 只處理**已結束**的日期（當日不建列）；日界前跑等於整天沒有新統計 |
| `cron:rankings` | 每日一次，**排在 `cron:rollup` 之後** | 計分讀的是 `NovelDailyStat`；先重算後彙總會讓排行永遠落後一天 |

`cron:rollup` 與 `cron:rankings` 皆為**冪等**：同一日期重跑產生完全相同的結果，
重試不會造成重複計數。`cron:publish` 重跑時到期集合為空，不會產生第二則通知。

### 接上外部排程器

**不繫結任何雲端廠商** —— 下列任一種都可以，選你的部署環境已經有的那一種：

```cron
# 1) 傳統 crontab（機器上已 clone 本 repo 並安裝相依）
*/10 * * * *  cd /srv/novelsite && npm run cron:publish  >> /var/log/novelsite-cron.log 2>&1
30 0 * * *    cd /srv/novelsite && npm run cron:rollup   >> /var/log/novelsite-cron.log 2>&1
45 0 * * *    cd /srv/novelsite && npm run cron:rankings >> /var/log/novelsite-cron.log 2>&1
```

```yaml
# 2) CI 排程（GitHub Actions 等）—— 機器上不需要有原始碼，直接打 HTTP 即可
on:
  schedule:
    - cron: '30 16 * * *' # UTC 16:30 = 台北 00:30
jobs:
  rollup:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -fsS -X POST "$CRON_BASE_URL/api/cron/rollup-stats"             -H "Authorization: Bearer $CRON_SECRET"
        env:
          CRON_BASE_URL: ${{ vars.CRON_BASE_URL }}
          CRON_SECRET: ${{ secrets.CRON_SECRET }}
```

**3) 部署平台內建排程**（Vercel Cron、Cloud Scheduler、Kubernetes CronJob…）：
一律設定為對上表三個路徑送出 `POST` 並帶上 `Authorization` 標頭即可，
`npm run cron:*` 只是同一件事的本機包裝。

> 排程器**必須能送出自訂標頭**。做不到的話（例如只能發裸 GET 的探活服務），
> MUST NOT 為此改成免驗證或改用查詢字串帶密鑰 —— 密鑰會被寫進存取紀錄與轉址鏈。

## 密碼雜湊

演算法採 **argon2id**（`@node-rs/argon2`），成本參數集中定義於
`src/lib/auth/password.ts` 的 `ARGON2_PARAMS`：

| 參數 | 值 |
| --- | --- |
| `memoryCost` | 19456（19 MiB） |
| `timeCost` | 2 |
| `parallelism` | 1 |
| `outputLen` | 32 |

此組合依 OWASP Password Storage Cheat Sheet 建議選定。若原生模組在目標平台不可用，退回
`bcrypt`（`cost = 12`）。

**效能量測（SC-009，正式建置產物，30 次請求，`TRUSTED_PROXY_HOPS=1` + 專屬來源位址）：**

| 操作 | p50 | p95 | max |
| --- | --- | --- | --- |
| 註冊 | 183.3ms | 216.2ms | 291.4ms |
| 登入 | 107.9ms | 125.9ms | 126.8ms |

皆遠低於 SC-009 的 1 秒預算。若未來調整雜湊參數導致 p95 逼近上限，須下調 `memoryCost` 並重新量測。

## Lighthouse 實測（FEAT-4 T155、SC-015）

以 `npx lighthouse` 對**正式建置產物**（`npm run build` → `npx next start`）實測，
資料庫為當次 `npm run db:seed` 的示範資料，日期 2026-08-08：

| 頁面 | Performance | Accessibility | Best Practices | SEO |
| --- | --- | --- | --- | --- |
| 首頁 `/` | 58 | **96** | 81 | 100 |
| 閱讀頁 `/reader/{novelId}/{chapterId}` | 63 | **96** | 81 | 100 |

**無障礙分數 MUST ≥ 95（SC-015）—— 兩頁皆為 96，通過。**

重現方式：

```bash
npm run build
npx next start -p 3300                      # 需備妥 .env（見「環境變數」）
npx lighthouse http://localhost:3300/ --only-categories=performance,accessibility,best-practices,seo
```

三項未達滿分的分數各有其成因，**記錄於此而非四捨五入掉**：

- **Best Practices 81**：唯一失分項是 `is-on-https`。量測對象是 `http://localhost`，
  這一項在正式環境（HTTPS）不會失分，屬量測條件而非缺陷。
- **Performance 58／63**：Lighthouse 預設以行動裝置設定檔搭配網路與 CPU 節流量測，
  而量測對象是本機的單一 Node 行程、無 CDN 亦無邊緣快取。失分集中在
  FCP／LCP／Speed Index。**本階段未訂效能目標**（見「已知限制」的搜尋效能一列），
  故此處只記錄事實，MUST NOT 被讀成「效能已驗收」。
- **Accessibility 96**：剩下的 4 分全部來自 `color-contrast`，命中點見下方「已知基線」。

## 正式環境部署

部署方案已於 2026-08-08 定案，作法見 **[`deploy/deployment.md`](../deploy/deployment.md)**：
Oracle Cloud Always Free ARM 單一執行個體 + Caddy（Let's Encrypt 自動續期）
+ 同機 PostgreSQL + Cloudflare DNS（灰雲）+ 系統 crontab。

該文件同時記錄了**被否決的三個選項與理由**（前後端分離、Cloudflare Workers、Vercel Hobby），
以及正式環境專用的環境變數取值 —— 其中 `TRUSTED_PROXY_HOPS` 最容易漏，
它只警示不擋啟動，漏了會讓登入限流變成全站共用一個額度。

**2026-08-11 架構修訂：單一主機、多網站、路徑前綴**（使用者裁示）。該主機與網域不是本站專用，
本站將部署於 `https://網域/novelsite`，每站一個 Docker 容器、由 Caddy 依路徑分流。

✅ **子路徑已支援（FEAT-6，2026-08-15）**：原文的「⛔ 程式碼目前還不支援子路徑……
在那之前本站只能部署於網域根目錄」**已失效並取代**。實測出的五項阻斷
（`next.config.ts` 的 `basePath`、`src/proxy.ts` 的兩處轉址、19 處 client `fetch('/api/...')`、
`SESSION_COOKIE.path`、根目錄 `robots.txt`）已全數修畢，
並由**第五套測試**固定——它帶前綴實際建置並啟動後逐項驗證：

```bash
npm run test:basepath   # test:all 的最後一套；亦已納入 CI 品質閘門
```

逐項的修法與現況見 `deploy/deployment.md` §9 與
[issue #9](https://github.com/nomoneylee/novels/issues/9)。

**定案不等於完成**：下方「待外部條件（FEAT-4）」的**第二項**（正式環境 PostgreSQL 部署驗證）
MUST 維持未勾銷，待實際部署並驗證後才能勾銷。
（第三項「部署平台的排程設定」已於 2026-08-15 由 FEAT-6 的 `cron` 容器承接並結案。）

## 待外部條件（FEAT-4）

以下三項**無法於本機完成**，MUST NOT 被標記為已完成（憲章第 IV 條、SC-016）：

| 項目 | 為何本機做不到 | 需要什麼 |
| --- | --- | --- |
| **真實行動裝置實機測試** | 觸控命中區、慣性捲動與行動瀏覽器的 `pagehide` 時機，模擬器與桌機引擎的行為和實機不同 —— 而 `useProgressReporter` 正是靠 `pagehide` 才能在使用者闔上手機時保住進度 | 至少一台實體 iOS 與一台實體 Android 裝置 |
| **正式環境 PostgreSQL 部署驗證** | 本機的 PostgreSQL 由 `docker compose` 起，與正式環境的連線池、延遲與備援設定皆不同；`pg_trgm` 索引的實際效果也只有在正式資料量下才算數 | 一個實際部署的 PostgreSQL 執行個體 |
| ~~**部署平台的排程設定**~~ **（已結案，2026-08-15）** | ~~三個 `/api/cron/*` 入口已就緒且有整合測試，但「每天真的有人按下它們」是部署平台的設定，不在原始碼內~~ | **已由 FEAT-6 的 `cron` 容器承接**：它是 `deploy/compose.yml` 的第四個服務，隨其他服務一起拉起，容器內以 crond 觸發三個作業（`deploy/deployment.md` §3.6、FR-084）。**原文「不在原始碼內」自本日起失效**——排程設定現在就在版控裡（`deploy/cron/crontab`），不再是一項要有人記得做的部署平台設定 |

> `npx playwright install firefox webkit` **不在本清單內**（2026-08-07 修正）：
> 它是可於本機自動完成的一次性下載，已改列為上方的「測試前置步驟」。

## 待外部條件（FEAT-5）

以下三項同樣**無法於本機完成**，MUST NOT 被標記為已完成（憲章第 IV 條）。
**「已知限制」的密碼救援與聯絡表單兩列已標為已解除，指的是程式碼已完成**——
在這三項齊備之前，`MAIL_MODE=production` 的站台會把信交給 Resend 並回報「已寄出」，
而信到不到得了收件匣是另一回事：

| 項目 | 為何本機做不到 | 需要什麼 |
| --- | --- | --- |
| **可用的郵件服務帳號** | `RESEND_API_KEY` 是外部服務簽發的憑證，`MAIL_MODE=production` 下缺它即拒絕啟動 | 一個 Resend 帳號與其 API 金鑰 |
| **對外寄件網域** | `MAIL_FROM` 的網域必須是自己控制得了 DNS 的網域，本機沒有任何網域 | 一個已註冊、DNS 可自行編輯的網域 |
| **該網域的 SPF／DKIM／DMARC 三筆 DNS 記錄** | **本項最容易被誤判為完成**：缺了它，寄送 API 照樣回 2xx、站上照樣記錄「已寄出」、聯絡表單照樣顯示成功，而信進垃圾匣 —— 三筆記錄的效果只有在**真的收信**時才看得出來 | 於網域 DNS 加上三筆記錄，並**以外部信箱實際收信確認** |

> **驗收 MUST NOT 以「系統回報成功」充當送達。** 連帶兩項驗收在此之前維持未達成：
> 聯絡表單「訊息確實送達營運信箱」、隱私權頁位址「經外部信箱實測寄達」
> （`specs/005-email-recovery-contact/tasks.md` T043(b)）。

## 待外部條件（FEAT-6）

以下六項**無法於本機完成**，MUST NOT 被標記為已完成（憲章第 IV 條）。
前五項皆需**一台已開通的 Oracle ARM 主機**（其中 SC-022／023／028 另需
**該主機上已註冊並開機自啟的 self-hosted runner**）；最後一項需要的是**另一個人**。

**「容器化的資產都寫好了」與「這六項已完成」是兩回事**——
`novelsite/Dockerfile`、`deploy/compose.yml`、`deploy/cron/` 已就位且可在本機驗證語法與設定，
但那證明的是「檔案寫對了」，不是「在一台乾淨的機器上真的跑起來了」。
**MUST NOT 以「腳本寫好了」充當完成。**

| 項目 | 為何本機做不到 | 需要什麼 |
| --- | --- | --- |
| **SC-020：一台乾淨的機器，一道指令把全部服務拉起來** | 「乾淨」是本項的全部意義——開發機上裝過的東西會讓缺漏的前置條件看不出來 | 一台全新開通的主機，僅安裝容器執行環境，執行單一 `docker compose up -d` 後驗收首頁、登入與健康檢查 |
| **SC-021：重開機後容器自行恢復** | **「容器有起來」與「重開機後容器會自己起來」是兩件事**：`restart: unless-stopped` 只在 Docker 服務本身開機自啟時才有意義，而那是主機層設定 | 實際 `reboot` 一次，確認四個服務皆自行恢復（含 `systemctl enable docker`） |
| **SC-027：異地備份的實際還原** | **上傳成功 MUST NOT 被視為可還原**（FR-085a）：`curl` 回 2xx 只證明位元組送出去了，證明不了那份 dump 還得回來 | 自物件儲存取回一份備份，以 `pg_restore` 實際還原至一個獨立資料庫並確認資料完整 |
| **SC-022：一次真實合併全程自動完成部署** | 三個工作流程檔（`ci.yml`／`deploy.yml`／`rollback.yml`）在本機只能驗語法，**驗不到 `workflow_run` 到底有沒有接上**——接錯時它不會報錯，只會**永遠不觸發**，而流程紀錄上什麼都不會出現 | self-hosted runner 已註冊，發動一次真實合併，**全程無人登入主機**，觀察 `CI` → `Deploy` → 健康檢查通過 |
| **SC-024：由未參與開發的人依清單完成上線前置作業** | 條文驗的是**清單夠不夠用**，不是清單存不存在。清單寫得完整、但漏了一個開發者視為理所當然的隱含前提時，**兩者在文件上長得一模一樣**——只有真的有人照著走一次才會現形。**MUST NOT 以「A／B 兩份清單已就位」勾掉它**：文件側的交付對應的是 FR-095～FR-097，不是 SC-024 | 一位未參與開發的人依 `deploy/deployment.md` §6 的 A 區清單從零操作，全程**不詢問開發者**即完成上線前置作業 |
| **SC-023／SC-028：回滾實測** | 回滾要換的是**主機上既存的舊映像標記**，而本機沒有那些標記；且 SC-028 的後半句是「流程平台不可用時仍能回滾」，那條路徑只有在主機上手動走一次才算數 | 至少完成兩次真實部署（才有前一版可回），以前一個 SHA 執行 `rollback.yml` 且**未修改任何一行程式碼**；另以 `deploy/deployment.md`「回滾」章節的手動備援指令在主機上實測一次 |

> **本階段可在本機驗證、且已驗證的部分**（不屬待外部條件）：
> 兩軌 migration 與 `mockData` 的分類定義一致（`npm run test -- category-seed-parity`）、
> `deploy/compose.yml` 四服務的日誌上限／時區／重啟策略／無對外埠／無 `build:` 區塊、
> `cron` 的唯讀掛載路徑確實指到 `cron/crontab`、`cron/backup.sh` 與 `notify.sh`。

**這兩節（FEAT-4 與 FEAT-5 的待外部條件）的實際操作順序與逐步作法，見
[`manual-steps.md`](./manual-steps.md)** —— 該檔只整理「先做哪一件、怎麼做、做完怎麼確認」，
判準與理由仍以本檔與 `arch.md`／`features.md`／`deploy/deployment.md` 為準。

### 已知基線（非本階段範圍）

以下是 FEAT-4 **之前**即存在、且本階段**刻意未修改**的項目。誠實記錄與標記為已完成是兩回事；
列在這裡是為了讓下一個人知道它們是被看見後留下的，不是被漏掉的。
清理它們會動到與本需求無關的既有檔案，違反憲章「變更範圍：MUST NOT 順手重構未壞的相鄰程式碼」，
應另開需求處理。

| 基線 | 範圍 | 為何本階段不動 |
| --- | --- | --- |
| **硬編色碼** | `src/` 下 **20 個檔案**（`app/design-system/page.tsx`、`app/globals.css`、`app/opengraph-image.tsx`、`components/home/HeroSection.module.css`、`components/home/RankingWidget.module.css` 等） | FR-064 的稽核對象明訂為**本階段新增或修改的樣式**。掃全站只有兩個結局：恆紅的測試，或為了轉綠去改一票無關檔案 |
| **`Math.random()` 產生的元件 id** | `components/ui/Toast.tsx:47`（toast key）、`lib/validation/novel.ts:34`（封面色隨機選取） | 同上；兩處皆早於 FEAT-4 |
| **Lighthouse `color-contrast` 未達 AA** | 首頁：`HeroSection` 的主要按鈕、`NovelCard` 的新書徽章／標籤／更新時間、`RankingWidget` 的「更多」連結；閱讀頁：章末的強調按鈕 | 成因是設計 token 本身（`--color-accent` 疊在白底為 3.18:1、`--color-subtle` 疊在 `--color-muted` 為 4.22:1）。修它等於改動全站品牌配色，是設計層級的決定，不該在交付前的硬化階段順手做掉。本階段只修了**自己新增的**兩處（章末留言區的空狀態與登入連結）與輪播圓點的命中區，兩頁的無障礙分數因此自 93／91 升至 96／96 |

上述三項掃描的可執行版本見 `novelsite/tests/unit/feat4-scan.test.ts`（甲：全站；乙：本階段檔案）。

## 已知限制

| 限制 | 說明 | 解除時機 |
| --- | --- | --- |
| ~~**無密碼救援途徑**~~ | **已於 FEAT-5 解除（2026-08-11）**。登入頁與註冊流程的告知文案已移除，改為前往 `/auth/forgot-password` 的入口；忘記密碼者可自行完成「申請 → 收信 → 設新密碼 → 以新密碼登入」全程（FR-025）。**原文另有一處失實**：「改密碼函式不對外開放」自 FEAT-3 起即不成立（`/profile/settings` 已可改密碼），正確表述是「**登入前**無救援途徑；登入後可自行更改密碼」—— 該缺口正是本階段補上的那一個 | 已解除 |
| **多執行個體／serverless 部署未支援** | 速率限制為單一執行個體記憶體實作，多執行個體下輪流命中即可繞過。啟動記錄與帶密鑰的健康檢查皆標示 `rateLimitMode=single-instance`。**FEAT-4 未改為共享儲存**：`RateLimitStore` 介面已預留（FR-050），但換上共享儲存需要一個外部快取服務，屬部署層決定 | 引入共享快取服務後 |
| **全站動態產生** | CSP nonce 逐請求產生，靜態化與 ISR 停用 | — |
| ~~**書架／閱讀歷史／閱讀偏好僅存瀏覽器**~~ | **已於 FEAT-4 解除（2026-08-08）**。三者改存伺服器：登入者跨裝置同步，未登入者先存本機、登入後由 `useReaderStateMerge` 自動合併帶上（FR-014／FR-015b／FR-017）。各接觸點原本那句「僅保存在此瀏覽器，換裝置不會同步」的**主張已不成立**，MUST NOT 留在畫面或註解上，並由 `tests/unit/feat4-scan.test.ts` 甲-2 持續掃描 | 已解除 |
| ~~**作者後台的統計仍為示範值**~~ | **已於 FEAT-4 解除（2026-08-08）**。儀表板的 14 天趨勢與曝光／收藏／留言三個計數改由 `ChapterView`／`BookshelfEvent`／`Comment` 的真實紀錄經每日彙總產生（FR-019／FR-040）；成效總覽的四項指標則直接由近 7 日明細計算（FR-042a）。三組手寫排行常數與 `SAMPLE_REVIEWS` 一併刪除（FR-043a），「部分示範」的標示隨之移除。**沒有資料時顯示空狀態，MUST NOT 以假資料填充**（FR-043b 的八個空狀態，見 `tests/a11y/pages.test.ts`） | 已解除 |
| **章節正文中的原始 HTML 會整段消失** | `<SafeMarkdown>` 未啟用 `rehype-raw`，`react-markdown` 在此設定下**直接丟棄**原始 HTML 節點（不是逸出成純文字）。安全性上無虞，但作者寫的 `<div>`／`<br>` 儲存後不會顯示；Markdown 語法不受影響 | 若日後需支援，MUST 同時檢視淨化設定 |
| **搜尋無效能目標** | 本階段只保證「空查詢不載入任何作品列、關鍵字搜尋不隨作品總數線性載入全庫」（結構判準），不訂回應時間；`pg_trgm` 索引對長度 < 3 的樣式無法使用，2 字元的建議查詢會退化為順序掃描 | FEAT-4 效能量測 |
| ~~**聯絡表單未接通**~~ | **已於 FEAT-5 解除（2026-08-11）**。送出控制項已啟用並接上 `POST /api/contact`：訊息**同步**寄至 `CONTACT_EMAIL`，寄送失敗回 502 並於畫面顯示失敗與 `mailto:` 替代管道（FR-020／FR-021）。**MUST NOT 於失敗時顯示已送出** —— 那正是本限制原本要避免的事 | 已解除 |
| **註冊 Email 未經驗證** | 註冊時不寄驗證信，也不檢查填入的位址是否屬於註冊者。**(a) 可利用路徑**：把註冊 Email 填成他人真實位址者，其帳號可被該位址的擁有者透過重設流程接管——重設信寄到的是那個位址，而重設成功即改密碼並撤銷全部工作階段。**(b) 這是本階段引入的**，MUST NOT 以「既有問題」帶過：在密碼重設就位之前，填錯或冒填位址不構成接管管道，是重設流程把「能收到那個信箱的信」變成了帳號的等價憑證。**(c) 為何本階段不納入驗證**：驗證信是另一組獨立的狀態機（未驗證帳號的權限、重寄與逾期、既有帳號的補驗證），與本階段「救回帳號」的目標正交，硬塞進來會讓 MVP 無法獨立驗收 | 註冊流程加入 Email 驗證信與「未驗證帳號不得作為重設目標」之後 |
| **遷移歷史重置僅此一次** | 前提為尚無正式環境資料，日後不得再用同一手法 | — |
| **a11y 檢查範圍** | 僅各階段新增／修改頁面（FEAT-4 追加通知中心、作者留言管理與 FR-043b 的八個空狀態）；jsdom 無版面計算，`color-contrast` 規則停用 —— 該規則改由上方的 Lighthouse 實測涵蓋，未達 AA 的既有命中點見「已知基線」 | 全站稽核另開需求 |
| **同網域其他站的憑證仍會送達本站**（FEAT-6 新增） | 多站共存於單一網域時，瀏覽器**不以路徑隔離 Cookie 的送出範圍**：其他站若把自己的 Cookie 範圍設為根目錄（`path: '/'`），那份 Cookie 一樣會跟著每一個發往 `/novelsite` 的請求送過來。**本站無法單方面阻止**——本站能做的只有把自己的工作階段 Cookie 收在 `path: BASE_PATH`（已於 FEAT-6 完成，`sessionToken.ts:29`），那擋的是「本站的憑證外送」，不是「別站的憑證進來」 | 需由網域擁有者統一規範，或改採子網域佈局 |
| **HSTS 一旦送出即綁定整個網域**（FEAT-6 新增） | `next.config.ts` 的 `Strict-Transport-Security` 帶 `includeSubDomains; preload`，這個標頭**綁的是網域不是路徑**：由本站送出之後，同網域其他尚未上 HTTPS 的站會在瀏覽器層直接無法存取。多站共存時 **MUST 由網域擁有者統一決定**，MUST NOT 由先上線的那一站自己決定 | 由網域擁有者統一決定後 |
| **`novelsite/.env.test` 隨 repo 版控** | 該檔含測試資料庫連線與**測試專用**的 `SESSION_SECRET`／`SEED_USER_PASSWORD`／`HEALTH_CHECK_SECRET`。**MUST NOT 放入任何正式環境憑證** —— 「原始碼無寫死憑證」的稽核範圍不涵蓋本檔，此豁免唯有在此界定被明文記錄、且每次新增變數都據以檢視時才成立 | — |

更多細節見 `specs/001-trust-boundary-dual-track/`（`spec.md`、`plan.md`、`research.md`、
`data-model.md`、`contracts/`、`quickstart.md`）；FEAT-3（創作流與搜尋）見
`specs/003-authoring-flow-search/`，其 `tasks.md` 開頭的「交接事項」一節列出每一項
**刻意留下、指名承接任務**的待處理項。

### Next 16 的隨版查證結論（FEAT-3）

| 主題 | 結論 |
| --- | --- |
| 快取失效 API | 用 **`revalidateTag(tag, 'max')`**。單引數形式已 deprecated；`updateTag()` 只能在 Server Action 內呼叫，不適用於由服務層發起的失效。**目前站上尚無已標記的快取項目，三個失效呼叫實為 no-op** |
| Server Action 的 CSRF | 框架內建比對 `Origin`／`Host`，不符即**中止請求**；文件**未載明狀態碼**，故整合測試斷言「非 2xx + 資料未變更」，MUST NOT 寫死 403 |
| `sitemap.ts` 的快取 | 預設**被快取**的 Route Handler。只加 `status` 條件不足以讓下架即時反映，需一併 `export const dynamic = 'force-dynamic'`（`/api/search` 同理） |
