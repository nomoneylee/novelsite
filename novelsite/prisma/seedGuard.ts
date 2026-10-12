/**
 * `npm run db:seed` 的放行守衛（FEAT-6 T007／FR-066，research R-1）
 * ==================================================================
 * `prisma/seed.ts` 的第一件事就是 `clearAll()`——它會清空全部資料表。
 * 接上正式資料庫之後，這一道指令誤跑一次就是真實資料全滅，**而且沒有復原路徑**。
 *
 * 判定採 **allowlist（只在可證明為非正式時放行）而非 blocklist**：
 * 最危險的情境不是「NODE_ENV 被設成 production」，而是**有人在正式主機上開一個殼層跑
 * `npm run db:seed`**——那個殼層裡 `NODE_ENV` 通常是空的，只看 `NODE_ENV` 會把它判成開發環境。
 *
 * **為什麼獨立成一個檔案，而不是寫在 `seed.ts` 開頭**（實作裁示，2026-08-14）：
 * `seed.ts` 的模組尾端就會執行 `main()`，任何 `import` 它的行為都等於**開始 seed**。
 * 判定寫在該檔內時，`tests/unit/seed-guard.test.ts` 一 import 就會清空並重建測試資料庫——
 * 守衛的單元測試自己變成一次破壞性操作。本檔零副作用（不 import prisma、不讀 `.env`），
 * 判定得以被單獨驗證，而 `seed.ts` 仍在**任何 prisma 呼叫之前**呼叫 `assertSeedAllowed()`，
 * 契約 cli-commands.md §1.2「MUST 在任何 deleteMany() 之前」不變。
 */

/** 未設定連線字串時的顯示值——輸出裡出現空白會讓人以為是訊息被截斷 */
const UNSET_URL_LABEL = '(未設定)';

/**
 * 守衛讀取的四個變數。**刻意不用 `NodeJS.ProcessEnv`**：本專案的 `ProcessEnv`
 * 被 Next 型別擴充為 `NODE_ENV` 必填，真值表測試就得為每一格補一個不相干的欄位。
 * 列出實際讀到的四項，也讓「這支守衛看什麼」在型別上一目了然。
 */
export interface SeedEnv {
  DATABASE_PROVIDER?: string;
  DATABASE_URL?: string;
  NODE_ENV?: string;
  SEED_ALLOW_DESTRUCTIVE?: string;
}

/**
 * 放行判定（契約 cli-commands.md §1.2）：
 *
 * ```
 * allow = ( DATABASE_PROVIDER === 'sqlite' && NODE_ENV !== 'production' )
 *         || SEED_ALLOW_DESTRUCTIVE === '1'
 * ```
 *
 * `DATABASE_PROVIDER` 未設定時**視同 `sqlite`**：`src/lib/env.ts:137` 的回落值就是它，
 * 而本專案的 `.env` 依慣例不寫這一項。改判為「證明不了 → 拒絕」會讓每一位 clone
 * 下來直接跑 `npm run db:seed` 的開發者被擋下（契約 §1.4 明列此情形行為 MUST 完全不變）。
 * 這個回落**不構成漏洞**：連線字串若指向 PostgreSQL，`src/lib/env.ts` 的
 * 「provider 與 DATABASE_URL 不相符」驗證會在更早的模組載入期就拒絕啟動。
 *
 * 旗標**只認字面上的 `'1'`**：接受「有設就算」會讓 `SEED_ALLOW_DESTRUCTIVE=0` 這種
 * 看起來是關閉的寫法變成放行。
 */
export function isSeedAllowed(env: SeedEnv): boolean {
  if (env.SEED_ALLOW_DESTRUCTIVE === '1') return true;
  const provider = env.DATABASE_PROVIDER ?? 'sqlite';
  return provider === 'sqlite' && env.NODE_ENV !== 'production';
}

/**
 * 去除連線字串中的密碼（契約 cli-commands.md §1.3、§2.3）。
 * 密碼 MUST NOT 出現在任何輸出——這段訊息會被貼進 issue、貼進聊天室。
 */
export function redactDatabaseUrl(url: string | undefined): string {
  if (!url) return UNSET_URL_LABEL;
  // 只替換 `scheme://user:password@` 的密碼段；`file:./dev.db` 這類沒有 authority 的字串原樣返回
  return url.replace(/^([a-zA-Z][\w+.-]*:\/\/[^:/?#@]+):[^@]*@/, '$1:***@');
}

/**
 * 不放行時輸出的繁體中文原因（契約 cli-commands.md §1.3）。
 *
 * **MUST NOT 提示放行旗標的用法**：錯誤訊息會被複製貼上，而那正是誤操作的成因。
 * 用法只寫在 `README.md` 與 `deploy/deployment.md`。
 */
export function seedBlockedMessage(env: SeedEnv): string {
  return [
    '❌ 已阻止 db:seed：本指令會先清空全部資料表，再寫入示範資料。',
    '   目前的環境無法被證明是開發環境，故拒絕執行（資料庫未變動）。',
    '',
    `   DATABASE_PROVIDER：${env.DATABASE_PROVIDER ?? '(未設定，視同 sqlite)'}`,
    `   DATABASE_URL：${redactDatabaseUrl(env.DATABASE_URL)}`,
    `   NODE_ENV：${env.NODE_ENV ?? '(未設定)'}`,
  ].join('\n');
}

/** 不放行即輸出原因並以非 0 離開碼結束；放行則靜默返回 */
export function assertSeedAllowed(env: SeedEnv): void {
  if (isSeedAllowed(env)) return;
  console.error(seedBlockedMessage(env));
  process.exit(1);
}
