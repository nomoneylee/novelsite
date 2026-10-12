import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import { loadTestEnv } from './tests/testEnv';

/**
 * 第五套測試：子路徑（`basePath`）相容（FEAT-6 T026／T028、FR-078）。
 *
 * 只加 react-server 這一個自訂條件，理由同 vitest.integration.config.mts。
 *
 * **本套 MUST 排在 `test:all` 的最後**（FR-078b）：它的建置產物帶前綴且會覆蓋 `.next`，
 * 排在中間會讓後面那套跑在帶前綴的產物上，症狀是那一套「莫名其妙開始失敗」。
 */
const RESOLVE_CONDITIONS = ['react-server'];

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    conditions: RESOLVE_CONDITIONS,
  },
  ssr: {
    resolve: {
      conditions: RESOLVE_CONDITIONS,
    },
  },
  test: {
    environment: 'node',
    include: ['tests/basepath/**/*.test.ts'],
    // MUST NOT 指向 tests/globalSetup.ts —— 那支是既有四套的，且 MUST NOT 被修改（FR-078a／SC-019）
    globalSetup: ['tests/basepathSetup.ts'],
    env: loadTestEnv(),
    testTimeout: 20000,
    hookTimeout: 60000,
    fileParallelism: false,
  },
});
