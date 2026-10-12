/**
 * 第五套測試（子路徑相容）的 globalSetup —— 見 vitest.basepath.config.mts。
 *
 * 本檔是 `tests/globalSetup.ts` 的**複製骨架**，與其只有下列三處差異。
 * **MUST NOT 改用 import 共用 `globalSetup.ts` 的內部函式來「消除重複」**：
 * 那會讓既有四套的行為與本套綁在一起，而 FR-078a／SC-019 要的正是
 * 「既有四套的通過數與行為**完全不變**」——共用之後，本套的任何調整都可能
 * 動到那四套，而症狀會出現在別的套件裡（`globalSetup.ts` 本身 MUST NOT 被修改）。
 *
 * | # | 差異 | 理由 |
 * |---|---|---|
 * | 1 | 四個子行程皆注入 `NEXT_PUBLIC_BASE_PATH=/novelsite` | 它是**建置期常數**（值被 inline 進 client bundle 並決定 `basePath`），只設在 `next start` 上無效 |
 * | 2 | 就緒探針改打 `${baseUrl}/novelsite/api/health` | 帶前綴啟動後不帶前綴是 404，會一路輪詢到逾時 |
 * | 3 | `provide('baseUrl')` 的值**不含**前綴 | 測試自行拼前綴，才驗得出前綴到底有沒有生效；`baseUrl` 就含前綴的話，四個案例即使前綴完全失效也全綠 |
 */
import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { loadTestEnv } from './testEnv';

declare module 'vitest' {
  export interface ProvidedContext {
    baseUrl: string;
  }
}

const ROOT = path.resolve(__dirname, '..');
const isWin = process.platform === 'win32';

/** 差異 1／2／3 共同依據的前綴。與 `basepath.test.ts` 的期望值 MUST 一致 */
const BASE_PATH = '/novelsite';

function run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env,
      stdio: 'inherit',
      shell: isWin,
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`[basepathSetup] "${command} ${args.join(' ')}" 結束代碼 ${code}`));
    });
  });
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        const { port } = address;
        server.close(() => resolve(port));
      } else {
        reject(new Error('[basepathSetup] 無法取得空閒埠'));
      }
    });
  });
}

/** 差異 2：探針 MUST 帶前綴 —— 不帶前綴時是 404，會一路輪詢到逾時 */
async function waitForHealth(baseUrl: string, timeoutMs = 90_000): Promise<void> {
  const start = Date.now();
  let lastError: unknown;
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}${BASE_PATH}/api/health`);
      if (res.status === 200) return;
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(
    `[basepathSetup] 測試伺服器在 ${timeoutMs}ms 內未就緒（${BASE_PATH}/api/health 未回 200）：${String(lastError)}`
  );
}

function killTree(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.pid == null) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, 5000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    if (isWin) {
      spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', shell: true });
    } else {
      child.kill('SIGTERM');
    }
  });
}

export default async function setup({
  provide,
}: {
  provide: <T extends string>(key: T, value: unknown) => void;
}) {
  const testEnv = loadTestEnv();
  // 差異 1：前綴 MUST 進入**全部四個**子行程的環境。
  // 只設在 `next start` 上時，建置產物裡的 `basePath` 仍是空字串 —— 站台會在根目錄起來，
  // 而就緒探針打帶前綴的路徑會 404，症狀是「逾時」而非「前綴沒生效」。
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...testEnv,
    NEXT_PUBLIC_BASE_PATH: BASE_PATH,
  };

  console.log(
    `[basepathSetup] NEXT_PUBLIC_BASE_PATH=${BASE_PATH} DATABASE_PROVIDER=${testEnv.DATABASE_PROVIDER}`
  );

  await run('npm', ['run', 'db:generate'], childEnv);
  await run('npx', ['prisma', 'migrate', 'deploy'], childEnv);
  await run('npm', ['run', 'db:seed'], childEnv);
  await run('npm', ['run', 'build'], childEnv);

  const port = process.env.TEST_PORT ? Number(process.env.TEST_PORT) : await getFreePort();
  const baseUrl = `http://localhost:${port}`;

  const server = spawn('npx', ['next', 'start', '-p', String(port)], {
    cwd: ROOT,
    env: { ...childEnv, PORT: String(port) },
    stdio: 'inherit',
    shell: isWin,
  });

  const earlyExit = new Promise<never>((_, reject) => {
    server.once('error', reject);
    server.once('exit', (code) => {
      if (code !== 0) reject(new Error(`[basepathSetup] next start 提前結束，代碼 ${code}`));
    });
  });

  await Promise.race([waitForHealth(baseUrl), earlyExit]);

  // 差異 3：提供的 baseUrl **不含**前綴，由各案例自行拼接。
  // 含前綴的話，即使前綴完全失效，四個案例仍會全綠 —— 那正是本套要驗的東西。
  provide('baseUrl', baseUrl);

  return async () => {
    await killTree(server);
  };
}
