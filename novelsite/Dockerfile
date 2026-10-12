# syntax=docker/dockerfile:1
#
# novelsite 的三個 stage（contracts/compose-services.md §1）
# ==========================================================
# | stage     | 產出                  | 用途           |
# |-----------|-----------------------|----------------|
# | `build`   | .next/standalone 等   | 建置；cron 的基底 |
# | `runtime` | `novelsite:<sha>`     | 網站服務        |
# | `cron`    | `novelsite-cron:<sha>`| 排程與備份      |
#
# 建置脈絡是 `novelsite/`（**`deploy/` 是它的兄弟目錄、不在脈絡內**，
# 故 cron 用得到的那些腳本 MUST 由 compose 以 bind mount 掛入，見 compose.yml）。

# ─────────────────────────────────────────────────────────────
# build
# ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS build

WORKDIR /app

# 建置期參數 MUST 只有這三個 `NEXT_PUBLIC_*`（research R-15）。
# 它們是**建置期常數**：值被 inline 進 client bundle，改動 MUST 重建映像。
# **MUST NOT 把任何密鑰放進 ARG／ENV** —— 那會留在映像層裡，`docker history` 讀得到。
# 執行期變數一律由 compose 的 `env_file` 注入。
ARG NEXT_PUBLIC_BASE_PATH=/novelsite
# **預設值 MUST 與 `src/lib/siteConfig.ts` 的回落值相同**：該檔寫的是
# `process.env.NEXT_PUBLIC_SITE_URL ?? 'https://novelsite.tw'`，而 `??` **接不住空字串**。
# `ARG` 沒有預設值時 `ENV` 會把它設成空字串——比「沒設定」更糟，
# 因為回落失效，`SITE_URL` 成為 `''`，建置在收集 `/_not-found` 的 metadata 時
# 以 `TypeError: Invalid URL` 失敗，而訊息完全不會提到這個變數（實測，2026-08-15）。
ARG NEXT_PUBLIC_SITE_URL=https://novelsite.tw
# GA 為選用：空字串即「不輸出分析腳本」（`Analytics.tsx` 以 `if (!gaId)` 判定），
# 故此處不給預設值是安全的
ARG NEXT_PUBLIC_GA_ID
ENV NEXT_PUBLIC_BASE_PATH=$NEXT_PUBLIC_BASE_PATH
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_GA_ID=$NEXT_PUBLIC_GA_ID

# 正式軌固定為 PostgreSQL。**MUST 於本 stage 設定**，否則 `db:generate`
# 產生的是 SQLite 軌的 client，而症狀要到執行期查詢時才出現。
ENV DATABASE_PROVIDER=postgresql

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# 順序不可換：npm ci → db:generate → build（contracts §1.2）
#
# `db:generate` **MUST NOT 省略**：`src/generated/prisma` 未版控（.gitignore:45），
# `npm ci` 不會產生它（`prepare` 只有 husky），`prisma migrate deploy` 也不會順帶產生，
# 而 `build` 就是 `next build` 一句話 —— 少了這一步，建置會在
# 「Prisma client 還不存在」的狀態下跑，且錯誤訊息不會指向這裡。
RUN npm run db:generate

# `next build` 會收集頁面資料，因而載入 `src/lib/env.ts` —— 該檔在模組載入時就驗證環境變數
# 並在缺漏時**拒絕啟動**（FR-049）。故建置期 MUST 給滿它的四項必要值：
#   SESSION_SECRET（≥32 bytes 且非範例值）、VIEW_HASH_SECRET（≥32 bytes）、
#   DATABASE_URL（形式 MUST 與 DATABASE_PROVIDER 相符，否則 env.ts 直接擲錯）。
# `MAIL_MODE=memory` 是為了避開 production 模式對 RESEND_API_KEY／MAIL_FROM 的要求。
#
# **這些全是拋棄式佔位值**：建置期不連資料庫也不寄信（migrate deploy 在 entrypoint 才跑），
# 且它們只存在於 build stage 的這一層、不進入 runtime 映像。
# 真正的值由 compose 的 `env_file` 在執行期注入。
# 以 `RUN` 的行內變數傳入而非 `ENV`，正是為了不讓它們留在映像層裡被 `docker history` 讀到。
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    SESSION_SECRET="build-time-placeholder-not-a-real-secret-value" \
    VIEW_HASH_SECRET="build-time-placeholder-not-a-real-view-salt" \
    MAIL_MODE=memory \
    npm run build

# 記下**實際解析到**的 prisma 版本，供 runtime stage 裝同一版的 CLI。
# 寫成檔案而不是寫死版號：寫死的那一天起，它就會與 package-lock.json 漂移，
# 而漂移的症狀是 migration 在正式環境以難解的方式失敗。
RUN node -p "require('./node_modules/prisma/package.json').version" > /prisma-version.txt

# ─────────────────────────────────────────────────────────────
# runtime
# ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV TZ=Asia/Taipei
ENV PORT=3000

# **`tzdata` MUST 安裝，`TZ` 才真的生效**（*裁示（2026-08-15，T041 實測）*）：
# alpine 預設不含時區資料庫，缺了它 **libc 解不出 `Asia/Taipei` 而靜默回落 UTC**。
# Node 自帶 ICU 時區資料，故 `new Date().toString()` 顯示 +0800 **看起來一切正常**，
# 但 `date`、檔案時間戳與（在 cron stage）**crond 的排程判定**全部走 UTC。
# 這是設了 `TZ` 卻沒有生效、且沒有任何錯誤訊息的典型案例（FR-082）。
RUN apk add --no-cache tzdata

# 五列 COPY（contracts §1.3）。**少一列就會壞，而畫面不像少複製了目錄**：
#   standalone 少了 → 沒有 server.js，起不來
#   .next/static 少了 → **全站無樣式**，看起來像 CSS 壞了（standalone 不自動帶）
#   public 少了 → 靜態檔 404
#   prisma 少了 → entrypoint 的 migrate deploy 找不到 migrations
#   prisma CLI 少了 → entrypoint 的 `npx prisma` 不存在
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
# prisma CLI **獨立安裝於 `/opt/prisma`，MUST NOT 用 COPY 搬**（*裁示（2026-08-15，T041 實測）*）
#
# 契約 §1.3 原列「COPY `node_modules/prisma`、`@prisma/*`、`.bin/prisma`」三行，**三行都行不通**：
#
#  1. `.bin/prisma` 是指向 `../prisma/build/index.js` 的**符號連結**，`COPY` 會**解參考**它；
#     複製過去的 JS 檔其 `require('./cli.js')` 於是在 `.bin/` 之下找 `cli.js`（該檔在 `prisma/build/`）
#     → 每次啟動 `Cannot find module './cli.js'` 後 restart loop。
#  2. 改指真實路徑後，下一個錯是 `Cannot find module 'effect'` ——
#     `@prisma/config` 有**自己的相依樹**，而 `prisma` + `@prisma` 兩個目錄不含它們。
#     逐一補相依是**沒有盡頭的路**：少一個就是一次「容器起不來」，而清單沒有任何東西維護它。
#
# 故改由 npm 自己解析完整相依closure，裝在與應用程式分離的 `/opt/prisma`
# （分離是為了不覆蓋 standalone 產物自帶的 `/app/package.json` 與 `/app/node_modules`）。
# 版本取自 build stage **實際解析到**的那一版，與 package-lock.json 不會漂移。
COPY --from=build /prisma-version.txt /prisma-version.txt
RUN mkdir -p /opt/prisma \
    && cd /opt/prisma \
    && npm install --no-save --no-audit --no-fund "prisma@$(cat /prisma-version.txt)" \
    && npm cache clean --force

# `migrate deploy` 專用的 prisma 設定（Prisma 7.9 起，**連線字串只能來自設定檔**——
# 產生的 schema 內 `datasource db` 沒有 `url`，見 `prisma/headers/postgres.prisma`）。
#
# 為什麼不直接沿用專案根的 `prisma.config.ts`：它是 TypeScript、且 `import "dotenv/config"`，
# 在 runtime 映像裡兩者都不存在（standalone 產物不含 tsx 也不含 dotenv）。
# 這一份是**同一份設定的執行期最小等價物**：CommonJS、零額外相依、
# 且三個路徑一律**絕對路徑**——CLI 以 `/opt/prisma` 為工作目錄執行（才找得到本檔），
# 相對路徑會從那裡算起而全部落空。
#
# `provider` 固定為 postgres 軌：正式環境唯一的軌（build stage 的 `DATABASE_PROVIDER` 亦同）。
RUN printf '%s\n' \
    'const { defineConfig } = require("prisma/config");' \
    'module.exports = defineConfig({' \
    '  schema: "/app/prisma/generated/schema.postgres.prisma",' \
    '  migrations: { path: "/app/prisma/migrations/postgres" },' \
    '  datasource: { url: process.env.DATABASE_URL },' \
    '});' \
    > /opt/prisma/prisma.config.js

COPY docker-entrypoint.sh ./docker-entrypoint.sh

# **MUST，且 MUST 緊接在該檔的 COPY 之後**：本 repo `core.fileMode=false`（Windows 開發機），
# 該檔進版控時是 `100644`，而 ENTRYPOINT 需要執行位元 ——
# 少了這一行就是**每次啟動 `permission denied`**。
# 此處與 `deploy/` 那些腳本不同：這個檔案是 COPY 進映像的、映像層可寫，位元補得回來；
# `deploy/` 那些是 `:ro` bind mount，補不回來，故那邊只能改呼叫方式（一律 `sh <路徑>`）。
RUN chmod +x ./docker-entrypoint.sh

# 「現在跑的是哪一版」的**唯一可靠來源**（FR-088）——容器標記可以被 `latest` 蓋掉，
# label 不會。US4 的破壞性偵測以它為 `<base>` 基準。
ARG GIT_SHA
LABEL org.opencontainers.image.revision=$GIT_SHA

EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]

# ─────────────────────────────────────────────────────────────
# cron
# ─────────────────────────────────────────────────────────────
# `FROM build`：排程作業跑的是 `npm run cron:*`（tsx + 完整 node_modules），
# 不是 standalone 產物 —— runtime stage 沒有 tsx 也沒有原始碼。
FROM build AS cron

WORKDIR /app

ENV NODE_ENV=production
ENV TZ=Asia/Taipei

# `postgresql17-client` 的**主版本 MUST 與 `postgres:17-alpine` 相同**：`pg_dump` 對**較新**的
# 伺服器會直接拒絕執行（"server version mismatch"），而那是每天凌晨兩點才會發現的事。
#
# `tzdata` 在本 stage **比 runtime 更關鍵**：**crond 依系統時間判定何時觸發**。
# 缺了它，`TZ=Asia/Taipei` 對 libc 無效而回落 UTC，於是 crontab 的
# `0 2`（備份）實際在台北時間 10:00 執行、`30 0`（每日彙總）在 08:30 執行——
# 排程「有在跑」，只是全部晚了 8 小時，而**沒有任何錯誤訊息**（實測，2026-08-15）。
RUN apk add --no-cache postgresql17-client tzdata

# crontab 由 compose 以 bind mount 掛入 `/app/deploy-cron/cron/crontab` 後，
# 於容器啟動時載入 —— 見 compose.yml 的 `command`。
ARG GIT_SHA
LABEL org.opencontainers.image.revision=$GIT_SHA

CMD ["crond", "-f", "-l", "8"]
