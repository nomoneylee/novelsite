/**
 * 整合測試與 a11y 測試共用的 globalSetup（見 vitest.integration.config.mts、vitest.a11y.config.mts）。
 * 唯一擁有者：db:generate → 對測試資料庫 migrate deploy → 對測試資料庫 db:seed
 *            → next build → next start（動態空閒埠）→ 輪詢 /api/health 就緒。
 * 三個測試 script（package.json）MUST NOT 重複這一串步驟（見 tasks.md T008 第六輪修正）。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { loadTestEnv } from './testEnv';

declare module 'vitest' {
  export interface ProvidedContext {
    baseUrl: string;
    serverLogPath: string;
  }
}

const ROOT = path.resolve(__dirname, '..');
const isWin = process.platform === 'win32';

/**
 * 測試伺服器 stdout／stderr 的落地檔（FEAT-7 T031a）。
 *
 * **為何需要它**：匯入紀錄（`chapterImport/log.ts`）以 `console.log` 寫到**伺服器行程**的
 * stdout，而伺服器是本檔另起的子行程 —— 測試行程沒有任何辦法攔截它。
 * 契約 §1.4 第 8 步要求「所有出口都要執行」記錄，包含身分驗證前的提前返回；
 * 那件事只有打真實端點才證明得了（單元測試只驗得到函式被正確呼叫時的形狀）。
 *
 * **MUST NOT 改成讓 `log.ts` 自己寫檔**：FR-016b 指定的出口就是標準輸出，
 * 為了測試改掉產品程式的出口，等於測到的不是要交付的那條路徑。
 *
 * 基準與 `.mail-outbox.jsonl` 相同（`novelsite/`），並比照它列入 `.gitignore`。
 */
const SERVER_LOG_PATH = path.join(ROOT, '.server-stdout.log');

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
      else reject(new Error(`[globalSetup] "${command} ${args.join(' ')}" 結束代碼 ${code}`));
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
        reject(new Error('[globalSetup] 無法取得空閒埠'));
      }
    });
  });
}

async function waitForHealth(baseUrl: string, timeoutMs = 90_000): Promise<void> {
  const start = Date.now();
  let lastError: unknown;
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.status === 200) return;
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(
    `[globalSetup] 測試伺服器在 ${timeoutMs}ms 內未就緒（/api/health 未回 200）：${String(lastError)}`
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
  const childEnv: NodeJS.ProcessEnv = { ...process.env, ...testEnv };

  console.log(
    `[globalSetup] DATABASE_PROVIDER=${testEnv.DATABASE_PROVIDER} DATABASE_URL=${testEnv.DATABASE_URL}`
  );

  await run('npm', ['run', 'db:generate'], childEnv);
  await run('npx', ['prisma', 'migrate', 'deploy'], childEnv);
  await run('npm', ['run', 'db:seed'], childEnv);
  await run('npm', ['run', 'build'], childEnv);

  const port = process.env.TEST_PORT ? Number(process.env.TEST_PORT) : await getFreePort();
  const baseUrl = `http://localhost:${port}`;

  // 每次執行從空檔開始 —— 殘留的前一輪紀錄會讓「恰一行」這種斷言變成擲骰子
  fs.writeFileSync(SERVER_LOG_PATH, '');

  const server = spawn('npx', ['next', 'start', '-p', String(port)], {
    cwd: ROOT,
    env: { ...childEnv, PORT: String(port) },
    // **MUST NOT 是 'inherit'**（FEAT-7 T031a）：'inherit' 讓子行程直接寫父行程的 fd，
    // 中間沒有任何一段是本行程碰得到的，於是伺服器的匯入紀錄無從驗證。
    // 改 'pipe' 後仍照原樣轉寫到本行程的 stdout／stderr，主控台輸出與先前一致
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: isWin,
  });

  // **MUST 持續消費這兩個管線**：'pipe' 而不讀，管線緩衝滿了子行程就會卡在寫入上
  const tee = (chunk: Buffer, out: NodeJS.WriteStream) => {
    out.write(chunk);
    // 同步寫入 —— 測試讀檔的當下就要看得到，非同步排程會讓輪詢誤判成「沒記錄」
    fs.appendFileSync(SERVER_LOG_PATH, chunk);
  };
  server.stdout?.on('data', (chunk: Buffer) => tee(chunk, process.stdout));
  server.stderr?.on('data', (chunk: Buffer) => tee(chunk, process.stderr));

  const earlyExit = new Promise<never>((_, reject) => {
    server.once('error', reject);
    server.once('exit', (code) => {
      if (code !== 0) reject(new Error(`[globalSetup] next start 提前結束，代碼 ${code}`));
    });
  });

  await Promise.race([waitForHealth(baseUrl), earlyExit]);

  provide('baseUrl', baseUrl);
  provide('serverLogPath', SERVER_LOG_PATH);

  return async () => {
    await killTree(server);
  };
}
