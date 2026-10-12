#!/bin/sh
# runtime 映像的進入點（FR-083、contracts/compose-services.md §1.5）
#
# 結構異動**在啟動期套用、不在建置期**：建置機連不到正式資料庫。
set -e

echo "[entrypoint] 套用資料庫結構異動（prisma migrate deploy）…"

# **MUST NOT 加 `|| true`**：migration 失敗時容器 MUST 起不來。
# 起得來的話，站台會在**舊結構**上跑新程式碼，而症狀是零散、看不出共同原因的執行期錯誤，
# 且健康檢查可能還是綠的 —— `set -e` 與這裡的不容錯是同一個決定。
#
# **MUST 指向 `/opt/prisma`，MUST NOT 用 `npx prisma` 或 `/app/node_modules`**
# （*裁示（2026-08-15，T041 實測）*）：CLI 連同其完整相依樹裝在 `/opt/prisma`，
# 與 standalone 產物自帶的 `/app/node_modules` 分開（理由見 Dockerfile 該處註解）。
#
# **MUST 以 `/opt/prisma` 為工作目錄執行**：Prisma 由 cwd 自動探索 `prisma.config.js`，
# 而連線字串、schema 與 migrations 路徑全部來自那一份設定（Prisma 7.9 起 schema 內
# 不再能寫 `url`）。設定裡三個路徑皆為絕對路徑，故換 cwd 不影響它們。
# 以子 shell 包住，`cd` 不會影響後面 `node server.js` 的工作目錄（MUST 維持 /app）。
(cd /opt/prisma && node node_modules/prisma/build/index.js migrate deploy)

echo "[entrypoint] 結構異動完成，啟動網站服務"

# **MUST 用 `exec`**：讓 node 取代 shell 成為 PID 1，`docker stop` 送出的 SIGTERM
# 才收得到。少了它，停止容器會走到 10 秒逾時後的 SIGKILL，正在處理的請求被硬斷。
exec node server.js
