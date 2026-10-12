-- 站方參考分類（FR-086、SC-026）
--
-- 這六筆是**站方參考資料**，不是使用者資料：空資料庫首次啟動後即須存在，
-- 否則作者建立作品時選不到分類，而人工建立它們正是 FEAT-6 要消滅的人工步驟
-- （`deployment.md` 的 A 區清單已據此移除該項）。
--
-- 值的唯一來源是 `src/lib/mockData.ts` 的 `CATEGORIES`，對應規則見
-- `specs/006-production-launch-readiness/data-model.md` §2：
--   id = slug = mockData 的 id；label/emoji/description/color/bgColor 直接取用；
--   sortOrder = 陣列索引（0 起算）。
-- 兩軌與 mockData 的一致性由 `tests/unit/category-seed-parity.test.ts` 固定
-- —— color/bgColor 謄錯不會有任何錯誤訊息，只會讓正式環境的配色與開發環境不同。
--
-- **冪等**（FR-086）：`ON CONFLICT ("slug") DO NOTHING` —— `slug` 有 @unique。
-- migrate deploy 對同一個資料庫只會跑一次，但「重跑仍是 6 筆」是 SC-026 的明文要求，
-- 且救援還原後重放 migration 時要靠它。
--
-- `id` 寫死為 slug，MUST NOT 另生隨機值：`Category.id` 在 schema 上是 `String @id`
-- 無預設值，純 SQL 拿不到 Prisma 的產生器；寫死成與 seed.ts 相同的值，
-- 兩軌與開發／正式環境的資料才會完全一致（arch.md §10.5 的雙軌比對才有意義）。

INSERT INTO "Category" ("id", "slug", "label", "emoji", "description", "color", "bgColor", "sortOrder") VALUES
  ('fantasy', 'fantasy', '玄幻', '⚡', '修仙、升級、逆天改命', '#9d4edd', 'rgba(157, 78, 221, 0.1)', 0),
  ('urban', 'urban', '都市', '🏙️', '現代都市，職場江湖', '#3a86ff', 'rgba(58, 134, 255, 0.1)', 1),
  ('romance', 'romance', '言情', '🌸', '纏綿悱惻，情深義重', '#e63b8b', 'rgba(230, 59, 139, 0.1)', 2),
  ('scifi', 'scifi', '科幻', '🚀', '星際遠征，未來世界', '#06b6d4', 'rgba(6, 182, 212, 0.1)', 3),
  ('history', 'history', '歷史', '⚔️', '家國情懷，史詩鉅著', '#d97706', 'rgba(217, 119, 6, 0.1)', 4),
  ('mystery', 'mystery', '懸疑', '🔍', '燒腦推理，真相追尋', '#10b981', 'rgba(16, 185, 129, 0.1)', 5)
ON CONFLICT ("slug") DO NOTHING;
