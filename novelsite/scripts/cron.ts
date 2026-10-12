/**
 * 排程作業的版控觸發指令（FEAT-4 4-D / T144，FR-056）
 * =====================================================
 * 以第一個參數選作業，對 `CRON_BASE_URL` 的對應入口送出帶密鑰的 `POST`。
 *
 * ```bash
 * npm run cron:rollup     # → POST $CRON_BASE_URL/api/cron/rollup-stats
 * npm run cron:rankings   # → POST $CRON_BASE_URL/api/cron/rankings
 * npm run cron:publish    # → POST $CRON_BASE_URL/api/cron/publish-scheduled
 * ```
 *
 * **三個作業共用一支腳本**：它們的差別只有路徑一格，各寫一支的話，
 * 密鑰讀法、錯誤處理與離開碼會有三份，而修正只會發生在被踩到的那一份。
 *
 * **不在應用程式行程內跑常駐排程器**：本腳本是給外部排程器（cron／CI 排程／
 * 部署平台排程）呼叫的一次性指令，接法見 `README.md`，**不繫結任何雲端廠商**。
 *
 * 失敗即以非 0 離開碼結束 —— 排程器要靠這個判斷「這次跑成功了沒有」，
 * 一律回 0 的話，作業默默壞掉時不會有任何人收到通知。
 */
import { config as loadDotenv } from 'dotenv';

loadDotenv();

const JOBS = {
  rollup: '/api/cron/rollup-stats',
  rankings: '/api/cron/rankings',
  publish: '/api/cron/publish-scheduled',
} as const;

type JobName = keyof typeof JOBS;

function isJobName(value: string | undefined): value is JobName {
  return value !== undefined && value in JOBS;
}

async function main(): Promise<void> {
  const job = process.argv[2];
  if (!isJobName(job)) {
    console.error(
      `[cron] 未知的作業：${job ?? '(未指定)'}；可用值：${Object.keys(JOBS).join('／')}`
    );
    process.exitCode = 1;
    return;
  }

  // 預設值與 `lib/env.ts` 的 `CRON_BASE_URL` 一致（本機開發埠 3100）。
  // 本檔**刻意不 import `@/lib/env`**：那一支帶 `server-only` 與啟動期驗證，
  // 而觸發腳本只需要兩個字串，不該因為某個與它無關的變數沒設定就跑不起來
  const baseUrl = process.env.CRON_BASE_URL ?? 'http://localhost:3100';
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    // 設定不足即失敗，MUST NOT 靜默送出一個必定被拒的請求（憲章）
    console.error('[cron] CRON_SECRET 未設定：排程入口一律回 401，請先設定後再執行');
    process.exitCode = 1;
    return;
  }

  const url = `${baseUrl}${JOBS[job]}`;
  const startedAt = Date.now();

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}` },
    });
    const body = await res.text();

    if (!res.ok) {
      console.error(`[cron] ${job} 失敗：${res.status} ${body}`);
      process.exitCode = 1;
      return;
    }

    console.log(`[cron] ${job} 完成（${Date.now() - startedAt}ms）：${body}`);
  } catch (err) {
    console.error(`[cron] ${job} 無法連線至 ${url}：${String(err)}`);
    process.exitCode = 1;
  }
}

void main();
