<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan:

`specs/010-volume-chapter-scroll/plan.md`

相關產出：`research.md`（技術決策依據）、`data-model.md`、`contracts/`、`quickstart.md`
（同目錄）。前九階段規劃見 `specs/009-admin-dashboard/plan.md`、
`specs/008-batch-publish-delete/plan.md`、`specs/007-batch-chapter-upload/plan.md`、
`specs/006-production-launch-readiness/plan.md`、`specs/005-email-recovery-contact/plan.md`、
`specs/004-reader-interaction-stats/plan.md`、`specs/003-authoring-flow-search/plan.md`、
`specs/002-data-model-real-content/plan.md` 與 `specs/001-trust-boundary-dual-track/plan.md`。
應用程式碼位於 `novelsite/`；部署資產位於 repo 根的 `deploy/` 與 `.github/`（FEAT-6 產出）。
本階段（FEAT-10）是**純前端改動**：作者作品管理頁的卷可摺疊、展開後章節清單限高捲動；
並一併清掉全站 28 處失效或不當的 CSS 變數引用（24 處無 fallback、3 處 fallback 是寫死顏色、
1 處 fallback 合法但算出的顏色讓鍵盤高亮看不見），
把「無 fallback 的未定義變數為 0」立為可執行閘門；以及修正作品資訊表單儲存後不同步。
零 migration、零 Server Action、零新套件。
<!-- SPECKIT END -->

## 文件同步鐵律（`novelsite/arch.md` 與 `novelsite/features.md`）

這兩份是本專案的上游真相來源：`arch.md` 是架構真相（schema、API 規格、里程碑、測試計畫），
`features.md` 是 Feature 拆解（範圍、完成定義、風險）。

**只要任何階段產生的決策與這兩份文件有差異，MUST 在同一輪內把差異回寫進去，MUST NOT 延後。**

- **觸發時機**：`/speckit-specify`、`/speckit-clarify`、`/speckit-plan`、`/speckit-analyze`、
  `/speckit-implement` 任一階段一旦裁示了與上游不同的內容——包含 schema 欄位增刪與型別、
  API 入參與回傳形狀、錯誤碼語意、範圍增減、驗收方式、預設值與門檻——即刻回寫。
- **回寫內容 MUST 三者齊備**：(a) 改成什麼、(b) **為什麼原文行不通或不適用**、
  (c) 日期與出處（例如 `FEAT-4 裁示（2026-07-31）`）。**只寫結論不寫理由，下一個人會把它改回去**。
- **回寫位置 MUST 是「會被照著實作的那一處」**：schema 的該欄位註解、API 表格的該一列、
  該 Phase 的完成定義。只在文件開頭補一段總述**不算完成**——實作者讀的是表格那一列，不是前言。
- **失效的原文 MUST 被取代而非並存**：兩種說法同時存在等於沒有真相來源。
- **憲章（`.specify/memory/constitution.md`）位階高於這兩份文件**；差異若源自憲章要求，回寫時 MUST 註明。
- 已完成項目的勾選狀態與執行紀錄（含日期）同樣寫回這兩份文件（沿用憲章「開發流程與品質閘門」的既有規定）。
