-- 初始化第二個資料庫，供整合測試使用（與 novelsite_dev 完全隔離，FR-032）
CREATE DATABASE novelsite_test;

-- Shadow database，供 PostgreSQL 軌產生 migration（`prisma migrate dev`）使用。
-- Prisma 7 已移除 `--shadow-database-url` 旗標，連線字串只能由 prisma.config.ts 提供，
-- 其預設值即指向本資料庫。缺這一行時 postgres 軌無法產生 migration，
-- 而錯誤訊息不會指向這裡（見 prisma.config.ts 的同段註解、README「環境變數」）。
CREATE DATABASE novelsite_shadow;
