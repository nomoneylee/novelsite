-- 站方參考分類（FR-086、SC-026）—— SQLite 軌，與 postgres 軌**逐欄對稱**
--
-- 說明與對應規則見 postgres 軌的同名檔案（兩軌的值 MUST 完全相同，
-- 由 `tests/unit/category-seed-parity.test.ts` 逐欄比對固定下來）。
--
-- **冪等**（FR-086）：SQLite 無 `ON CONFLICT … DO NOTHING` 的等價寫法可直接套用於
-- 具名唯一鍵，改用 `INSERT OR IGNORE` —— 語意相同：`slug` 衝突時略過該列。

INSERT OR IGNORE INTO "Category" ("id", "slug", "label", "emoji", "description", "color", "bgColor", "sortOrder") VALUES
  ('fantasy', 'fantasy', '玄幻', '⚡', '修仙、升級、逆天改命', '#9d4edd', 'rgba(157, 78, 221, 0.1)', 0),
  ('urban', 'urban', '都市', '🏙️', '現代都市，職場江湖', '#3a86ff', 'rgba(58, 134, 255, 0.1)', 1),
  ('romance', 'romance', '言情', '🌸', '纏綿悱惻，情深義重', '#e63b8b', 'rgba(230, 59, 139, 0.1)', 2),
  ('scifi', 'scifi', '科幻', '🚀', '星際遠征，未來世界', '#06b6d4', 'rgba(6, 182, 212, 0.1)', 3),
  ('history', 'history', '歷史', '⚔️', '家國情懷，史詩鉅著', '#d97706', 'rgba(217, 119, 6, 0.1)', 4),
  ('mystery', 'mystery', '懸疑', '🔍', '燒腦推理，真相追尋', '#10b981', 'rgba(16, 185, 129, 0.1)', 5);
