import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { assertCronSecret } from '@/lib/auth/routeHelpers';
import { testFetch } from '../helpers/client';
import { resetAuthTables } from '../helpers/resetAuthTables';
import { createAccount, createPublishedNovel } from '../helpers/fixtures';
import { deleteNovelOwned } from '@/lib/repositories';

/**
 * T091：排程入口的密鑰驗證（FR-055、US3 AC9、contracts/analytics-scheduling-api.md §4）
 * ===================================================================================
 * 排程入口是三個**沒有使用者**的寫入端點：它們改資料、清資料，卻沒有工作階段可以驗。
 * 唯一的門就是 Bearer 密鑰，所以這道門的三種失敗方式都必須是同一個答案 —— 401、且什麼都不做。
 *
 * 第三種情形（`CRON_SECRET` **未設定**）是本檔真正的重點，也是最容易寫錯的一種：
 * 「沒設定就先放行，等設定了再驗」是很自然的寫法，而它的後果是**忘記設定的環境完全不設防**，
 * 任何人都能對它反覆觸發彙總與清理。**設定不足即失敗**（憲章：MUST NOT 靜默降級）——
 * 未設定時 MUST 一律拒絕，且 MUST NOT 因為請求帶的密鑰「等於未設定的值」而通過比對。
 *
 * **未設定那一案在行程內直接呼叫 `assertCronSecret`**：測試伺服器是另一個行程，
 * 其 `CRON_SECRET` 由 `.env.test` 在啟動時決定，測試無法讓它變成未設定
 * （該檔已就此留註）。因此該案改驗守衛函式本身，其餘兩案走完整的 HTTP 路徑。
 * 這也表示 `assertCronSecret` **MUST 於呼叫當下讀取 `env.CRON_SECRET`**，
 * MUST NOT 在模組載入時解構成常數 —— 否則「未設定」這條分支永遠無法被驗證。
 */

const CRON_PATH = '/api/cron/rollup-stats';
const IP = '10.91.4.1';

let author: { id: string };
let novelId: string;
let chapterIds: string[];

function callCron(headers: Record<string, string> = {}): Promise<Response> {
  return testFetch(CRON_PATH, { method: 'POST', ip: IP, headers });
}

function dailyStatCount(): Promise<number> {
  return prisma.novelDailyStat.count();
}

/** 同時容納同步擲出與回傳 rejected promise 兩種實作 */
async function captureError(fn: () => unknown): Promise<unknown> {
  try {
    await fn();
    return null;
  } catch (err) {
    return err;
  }
}

beforeAll(async () => {
  await resetAuthTables();
  await prisma.novelDailyStat.deleteMany();
  await prisma.chapterView.deleteMany();
  await prisma.bookshelfEvent.deleteMany();

  author = await createAccount('cron-author', 'author');
  const novel = await createPublishedNovel({ authorId: author.id, chapterCount: 1 });
  novelId = novel.novelId;
  chapterIds = novel.chapterIds;

  // 一筆昨日的閱讀明細：**有工作可做**，401 之後統計列仍為 0 才有意義。
  // 少了它，「不執行任何工作」會因為本來就沒事可做而假性成立
  const DAY_MS = 24 * 3_600_000;
  const TAIPEI_OFFSET_MS = 8 * 3_600_000;
  const todayStart =
    Math.floor((Date.now() + TAIPEI_OFFSET_MS) / DAY_MS) * DAY_MS - TAIPEI_OFFSET_MS;
  await prisma.chapterView.create({
    data: {
      novelId,
      chapterId: chapterIds[0],
      viewerHash: 'cron-auth-hash'.padEnd(64, '0'),
      viewedAt: new Date(todayStart - 12 * 3_600_000), // 昨日正午
    },
  });
});

afterAll(async () => {
  await prisma.novelDailyStat.deleteMany();
  await prisma.chapterView.deleteMany();
  await deleteNovelOwned(author.id, novelId);
  await resetAuthTables();
});

describe('T091-1：未帶 Bearer → 401 且不執行任何工作', () => {
  it('完全沒有 Authorization 標頭 → 401', async () => {
    const res = await callCron();
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('UNAUTHENTICATED');
  });

  it('有 Authorization 但非 Bearer 方案 → 401', async () => {
    const res = await callCron({ Authorization: `Basic ${env.CRON_SECRET}` });
    expect(res.status).toBe(401);
  });

  it('只給密鑰、沒有 Bearer 前綴 → 401（MUST NOT 寬容地兩種都收）', async () => {
    const res = await callCron({ Authorization: String(env.CRON_SECRET) });
    expect(res.status).toBe(401);
  });

  it('以上嘗試皆未產生任何每日統計列', async () => {
    expect(await dailyStatCount()).toBe(0);
  });
});

describe('T091-2：密鑰錯誤 → 401 且不執行任何工作', () => {
  it('完全不同的密鑰 → 401', async () => {
    const res = await callCron({ Authorization: 'Bearer totally-wrong-secret' });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('UNAUTHENTICATED');
  });

  it('僅差一個字元的密鑰 → 401（比對 MUST 為全等，非前綴或包含）', async () => {
    const res = await callCron({ Authorization: `Bearer ${env.CRON_SECRET}x` });
    expect(res.status).toBe(401);
  });

  it('正確密鑰的前綴 → 401', async () => {
    const prefix = String(env.CRON_SECRET).slice(0, 5);
    const res = await callCron({ Authorization: `Bearer ${prefix}` });
    expect(res.status).toBe(401);
  });

  it('空字串密鑰 → 401', async () => {
    const res = await callCron({ Authorization: 'Bearer ' });
    expect(res.status).toBe(401);
  });

  it('以上嘗試皆未產生任何每日統計列', async () => {
    expect(await dailyStatCount()).toBe(0);
  });
});

describe('T091-3：CRON_SECRET 未設定 → 一律拒絕（設定不足即失敗）', () => {
  /**
   * 覆寫的是**本行程**的設定物件；測試伺服器不受影響（見檔首說明），
   * 故本組只驗守衛函式，不打 HTTP。
   */
  const original = env.CRON_SECRET;

  const unset = (): void => {
    (env as { CRON_SECRET: string | undefined }).CRON_SECRET = undefined;
  };
  const restore = (): void => {
    (env as { CRON_SECRET: string | undefined }).CRON_SECRET = original;
  };

  function request(authorization?: string): Request {
    return new Request('http://localhost/api/cron/rollup-stats', {
      method: 'POST',
      headers: authorization ? { Authorization: authorization } : {},
    });
  }

  it('未設定時，帶著原本正確的密鑰仍被拒絕', async () => {
    unset();
    try {
      const err = await captureError(() => assertCronSecret(request(`Bearer ${original}`)));
      expect(err).not.toBeNull();
      expect((err as { code?: string }).code).toBe('UNAUTHENTICATED');
    } finally {
      restore();
    }
  });

  it('未設定時，未帶標頭同樣被拒絕（MUST NOT 因兩邊皆「無值」而視為相符）', async () => {
    unset();
    try {
      const err = await captureError(() => assertCronSecret(request()));
      expect(err).not.toBeNull();
      expect((err as { code?: string }).code).toBe('UNAUTHENTICATED');
    } finally {
      restore();
    }
  });

  it('未設定時，帶空的 Bearer 亦被拒絕', async () => {
    unset();
    try {
      const err = await captureError(() => assertCronSecret(request('Bearer ')));
      expect(err).not.toBeNull();
      expect((err as { code?: string }).code).toBe('UNAUTHENTICATED');
    } finally {
      restore();
    }
  });

  it('還原設定後，正確密鑰通過（證明上面三案的拒絕來自「未設定」而非別的原因）', async () => {
    restore();
    const err = await captureError(() => assertCronSecret(request(`Bearer ${original}`)));
    expect(err).toBeNull();
  });
});

describe('T091-4：對照組 —— 正確密鑰確實會執行工作', () => {
  it('帶正確 Bearer → 200，且昨日的明細被彙總為統計列', async () => {
    // 前面全部的 401 之後仍是 0 —— 這一行是「不執行任何工作」的最後確認
    expect(await dailyStatCount()).toBe(0);

    const res = await callCron({ Authorization: `Bearer ${env.CRON_SECRET}` });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    expect(await prisma.novelDailyStat.count({ where: { novelId } })).toBeGreaterThan(0);
  }, 60_000);
});
