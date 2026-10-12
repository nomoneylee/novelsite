import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import { loadTestEnv } from './tests/testEnv';

// 只加 react-server 這一個自訂條件。Node 的 --conditions 是「附加」而非「取代」內建條件
// （node/import/require/default 由 Node 依當次載入方式自動判斷）—— 若額外硬加 import/node/
// default，會使 'import' 條件對「同一個行程內的所有 require() 呼叫」永遠成立，
// 導致 pg / pg-pool 這類同時提供 exports.import 與 exports.require 的套件被強制解析到
// 其 ESM 包裝檔，即使呼叫端用的是 require()，造成
// 「Class extends value [object Module] is not a constructor」（第七輪除錯確認）。
const RESOLVE_CONDITIONS = ['react-server'];

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    conditions: RESOLVE_CONDITIONS,
  },
  // Vite ≥ 6 對 Node 執行的測試行程實際套用的是 ssr.resolve.conditions，
  // 而非上方的 resolve.conditions（vitest 原始碼 resolveConditions() 已確認此行為）。
  ssr: {
    resolve: {
      conditions: RESOLVE_CONDITIONS,
    },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**'],
    env: loadTestEnv(),
  },
});
