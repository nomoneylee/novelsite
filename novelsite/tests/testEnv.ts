/**
 * 測試環境的唯一組態來源。
 * 三個 vitest 設定檔（測試執行器）與 tests/globalSetup.ts（四個子行程）皆 MUST 呼叫本函式，
 * MUST NOT 各自拼裝 —— 拼裝的必然結果是漂移（見 contracts/env.md §5）。
 */
import { config as loadDotenv } from 'dotenv';
import path from 'node:path';

export function loadTestEnv(): Record<string, string> {
  const parsed =
    loadDotenv({
      path: path.resolve(__dirname, '../.env.test'),
      processEnv: {},
    }).parsed ?? {};

  // DATABASE_PROVIDER 是唯一由殼層傳入的變數，.env.test 不得收錄（FR-034）
  const provider = process.env.DATABASE_PROVIDER ?? 'sqlite';

  const databaseUrl =
    provider === 'postgresql' ? parsed.TEST_DATABASE_URL_POSTGRES : parsed.TEST_DATABASE_URL_SQLITE;

  if (!databaseUrl) {
    throw new Error(
      `loadTestEnv: 缺少 provider="${provider}" 對應的測試資料庫連線字串（檢查 .env.test）`
    );
  }

  return {
    ...parsed,
    DATABASE_PROVIDER: provider,
    DATABASE_URL: databaseUrl,
    // FEAT-6 FR-066：`db:seed` 的放行守衛對 PostgreSQL 一律拒絕，而 arch.md §10.5 的
    // 雙軌驗證（DATABASE_PROVIDER=postgresql npm run test:integration）必須跑得起 seed。
    // MUST NOT 寫進 `.env.test` —— 那是版控檔，把放行旗標寫在裡面等於在 repo 裡留一行
    // 「複製貼上就能繞過守衛」的示範（research R-1）。
    SEED_ALLOW_DESTRUCTIVE: '1',
  };
}
