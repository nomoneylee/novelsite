import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import { loadTestEnv } from './tests/testEnv';

// 只加 react-server 這一個自訂條件，理由見 vitest.config.mts 的詳細註解 ——
// 硬加 import/node/default 會使 pg / pg-pool 的 require() 被錯誤導向其 ESM 包裝檔。
const RESOLVE_CONDITIONS = ['react-server'];

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    conditions: RESOLVE_CONDITIONS,
  },
  // 見 vitest.config.mts 的說明：Vite ≥ 6 對 Node 測試行程實際套用 ssr.resolve.conditions。
  ssr: {
    resolve: {
      conditions: RESOLVE_CONDITIONS,
    },
  },
  test: {
    environment: 'node',
    // 限定 *.test.ts —— 同目錄的 *.test-d.ts 是純編譯期斷言（見 author-ownership.test-d.ts），
    // 無 runtime 案例，被 vitest 收集會以「No test suite found」失敗。
    include: ['tests/integration/**/*.test.ts'],
    globalSetup: ['tests/globalSetup.ts'],
    env: loadTestEnv(),
    // 整合測試打真實 HTTP，單一案例可能含多次限流相關請求，放寬預設逾時
    testTimeout: 20000,
    hookTimeout: 60000,
    // 每個測試檔的 beforeAll 皆會清空共用的 Session/User 表（resetAuthTables）。
    // 檔案間若平行執行，一個檔案的清空會抹掉另一個檔案正在使用的列 —— MUST 依檔案循序執行。
    fileParallelism: false,
  },
});
