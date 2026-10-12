-- AlterTable
ALTER TABLE "Novel" ADD COLUMN     "searchText" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "Novel_searchText_idx" ON "Novel"("searchText");

-- CreateIndex
CREATE INDEX "Novel_status_updatedAt_idx" ON "Novel"("status", "updatedAt");

-- ─────────────────────────────────────────────────────────────────────────────
-- 以下為手寫段落（data-model.md §2.3、research R-1），不由 model 定義產生。
--
-- 上方的 btree 索引出自單一 model 定義，兩軌都會建立，但 PostgreSQL 的 `ILIKE '%x%'`
-- 用不到它 —— 能加速前後皆有萬用字元的比對的只有 trigram GIN。
-- 兩者並存的代價是少量儲存空間，換取「資料模型定義只有一份」不被破壞（憲章技術約束）。
--
-- 已知限制（spec 已接受）：trigram 索引對長度 < 3 的模式無法使用，
-- 2 字元的建議查詢會退化為順序掃描。本階段不訂搜尋效能目標（SC-004 只驗結構）。
-- ─────────────────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "Novel_searchText_trgm_idx"
  ON "Novel" USING GIN ("searchText" gin_trgm_ops);
