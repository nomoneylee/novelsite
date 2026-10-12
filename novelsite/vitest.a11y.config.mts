import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import react from '@vitejs/plugin-react';
import { loadTestEnv } from './tests/testEnv';

export default defineConfig({
  // MUST NOT 加 resolve.conditions 的 react-server —— 會讓 react 解析到不含用戶端 Hook
  // 的伺服器版本，React Testing Library 無法渲染（見 research.md R-7）
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: 'jsdom',
    // MUST NOT 用 'tests/a11y/**'（過寬）—— 會連 axeHelper.ts（非測試檔）都當成測試套件收錄，
    // 因其不含任何 test/describe 而以「No test suite found」判為失敗。
    include: ['tests/a11y/**/*.test.{ts,tsx}'],
    globalSetup: ['tests/globalSetup.ts'],
    env: loadTestEnv(),
    testTimeout: 20000,
    hookTimeout: 60000,
  },
});
