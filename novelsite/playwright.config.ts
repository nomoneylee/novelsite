/**
 * 端對端測試設定（FEAT-3 FR-038 起；FEAT-4 T150 擴為四條流程與三種引擎，FR-059）
 * ==============================================================================
 *   - **四條流程**：作者流（FEAT-3）、讀者流、越權流、無障礙流（FEAT-4）
 *   - **只有讀者流跑三引擎**，其餘維持 chromium（理由見下方 `projects` 註解）——
 *     FEAT-3 時期「只 chromium」的敘述已由 FR-059 取代
 *   - **只 sqlite 一軌**：SC-006／SC-014 的「兩軌各跑一輪」是對**整合測試**的要求，
 *     資料庫種類差異已由整合測試覆蓋，雙軌跑 E2E 只是把建置成本乘二
 *   - **獨立 e2e.db 與專屬埠**：與整合測試的 test.db／動態埠完全不共用，
 *     兩者同時執行不會互相清表
 *   - **正式建置產物**：沿用整合測試「不得用 dev server」的既定立場
 *     （dev server 的錯誤處理、快取與正式產物不同，測不到真正要上線的東西）
 *
 * **四個 spec 共用同一台伺服器與同一份 e2e.db**，且依檔名順序執行
 * （a11y-flow → author-flow → privilege-flow → reader-flow）：任何一條流程
 * 修改到的共用資料，後面的流程都看得到。這是 `privilege-flow` 不使用示範讀者帳號的原因
 * —— `author-flow` 會把它升級成作者。
 */
import { defineConfig, devices } from '@playwright/test';
import { loadTestEnv } from './tests/testEnv';

/** 專屬連接埠 —— 與 next dev（3000）及整合測試的動態空閒埠皆不重疊 */
const E2E_PORT = Number(process.env.E2E_PORT ?? 3210);
const BASE_URL = `http://localhost:${E2E_PORT}`;

/**
 * 沿用 .env.test 的測試專用設定（SESSION_SECRET、SEED_USER_PASSWORD 等），
 * 但把資料庫換成獨立的 e2e.db —— loadTestEnv() 回的是整合測試用的 test.db。
 */
const e2eEnv: Record<string, string> = {
  ...loadTestEnv(),
  DATABASE_PROVIDER: 'sqlite',
  DATABASE_URL: 'file:./e2e.db',
  /**
   * `next start` 一律以 `NODE_ENV=production` 執行，工作階段 Cookie 因此帶 `Secure`；
   * 而 **WebKit 不把 `http://localhost` 視為安全內容**，會把該 Cookie 直接丟棄 ——
   * 讀者流在 webkit 上連登入都過不了，症狀是被轉回登入頁而不是任何斷言失敗。
   * Chromium 與 Firefox 允許 `http://localhost` 帶 `Secure`，故這個差異
   * 只在 FR-059 的跨引擎驗收時才會現形（FEAT-4 T150）。
   *
   * 這裡關掉的是**測試伺服器**的 Cookie 屬性，MUST NOT 出現在任何對外部署的設定中。
   */
  SESSION_COOKIE_SECURE: 'false',
};

export default defineConfig({
  testDir: './tests/e2e',
  // 作者流會寫入共用的示範資料，平行執行會互相污染
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    locale: 'zh-TW',
  },

  /**
   * 引擎矩陣（FEAT-4 T150、FR-059）
   * ================================
   * **只有讀者流跑三引擎**，其餘維持 chromium。FR-059 要求的是「讀者流 MUST 於
   * chromium／firefox／webkit 三種引擎執行並通過」—— 四條流程各跑三次會把建置與
   * 執行時間乘三，換來的是同一段守衛邏輯（越權、Server Action）被不同引擎重跑，
   * 而那些跟渲染引擎無關。跨引擎要驗的是排版、鍵盤與儲存行為的基礎相容性。
   *
   * `X-Forwarded-For` 逐 project 給不同值（`.env.test` 的 `TRUSTED_PROXY_HOPS=1`
   * 使伺服器採信最右側那一個）：三個 project 共用同一台伺服器與同一份記憶體限流表，
   * 不分流的話讀者流的註冊會在第三個引擎撞上 `REGISTER_RATE_IP_MAX`（預設 3），
   * 失敗訊息會指向註冊表單而不是限流。
   *
   * 執行前置：`npx playwright install firefox webkit`（一次性的二進位下載，
   * 見 README「測試前置步驟」；它 MUST NOT 被列為待外部條件——本機即可完成）。
   */
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        extraHTTPHeaders: { 'X-Forwarded-For': '10.60.0.1' },
      },
    },
    {
      name: 'firefox',
      testMatch: /reader-flow\.spec\.ts/,
      use: {
        ...devices['Desktop Firefox'],
        extraHTTPHeaders: { 'X-Forwarded-For': '10.60.0.2' },
      },
    },
    {
      name: 'webkit',
      testMatch: /reader-flow\.spec\.ts/,
      use: {
        ...devices['Desktop Safari'],
        extraHTTPHeaders: { 'X-Forwarded-For': '10.60.0.3' },
      },
    },
  ],

  webServer: {
    // 與 tests/globalSetup.ts 同一組前置指令，但資料庫檔案與埠皆獨立
    command: [
      'npm run db:generate',
      'npx prisma migrate deploy',
      'npm run db:seed',
      'npm run build',
      `npx next start -p ${E2E_PORT}`,
    ].join(' && '),
    url: `${BASE_URL}/api/health`,
    env: e2eEnv,
    // 建置 + seed 需時，放寬到與整合測試 hookTimeout 同級
    timeout: 180_000,
    // 永遠自己起一份 —— 重用外部伺服器會連到 test.db，資料前提不成立
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
