/**
 * client 端呼叫自家 API 的唯一入口（FR-074、contracts/internal-modules.md §1）。
 *
 * `basePath` 是**建置期常數**——值在 `next build` 時被 inline 進 client bundle，
 * 故 MUST 用 `NEXT_PUBLIC_` 前綴，且改動它 MUST 重新建置映像（見 README「建置期常數 vs 執行期變數」）。
 *
 * 為什麼要有這一支：`next/link` 與 `next/router` 的 `basePath` 由框架自動補上，
 * 但 `fetch('/api/…')` 框架管不到——它會打到網域根目錄而非本站前綴之下。
 * MUST NOT 於各處各自拼接：新增一個拼接點就會壞，**而且只在正式環境壞**。
 *
 * MUST NOT 加 `'server-only'`（它就是給 client 元件用的）。
 * MUST NOT import `@/lib/env`（該檔帶 `server-only` 與啟動期驗證，client 端 import 會直接爆）。
 */
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * 參數型別為 template literal type，讓「傳一個不是 `/api/` 開頭的東西」在**編譯期**紅，
 * 而不是在正式環境 404。
 *
 * 未設定 `NEXT_PUBLIC_BASE_PATH` 時回落空字串——本機開發與四套既有測試的行為
 * MUST 完全不變（FR-072、SC-019）。
 */
export function apiUrl(path: `/api/${string}`): string {
  return `${BASE}${path}`;
}
