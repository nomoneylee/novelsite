import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { loginAs } from '../helpers/client';
import { createAccount } from '../helpers/fixtures';

/**
 * T117：導覽列未讀數的查詢預算（SC-020、FR-053a、research R-6）
 * ==============================================================
 * `SiteHeader` 出現在全部 26 個頁面。未讀數若各自去查一次，等於在**每一頁**上
 * 為一個多數時候是 0 的數字多付一次往返；而未登入訪客連這個數字都不需要。
 * 契約因而把成本寫成兩個明確的數（analytics-scheduling-api.md §3）：
 *
 * | 情境 | 額外查詢成本 |
 * | --- | --- |
 * | 未登入訪客 | **0**（`getSession()` 回 null 即返回） |
 * | 已登入者 | **每頁至多一次計數，且與既有查詢同一次往返** |
 *
 * **量測機制**：以 Prisma Client 的 `$extends({ query: { $allOperations } })` 包一層
 * 計數器，把 `getSessionUser()` 期間發生的每一次資料庫操作記下來。
 * 這一層**測試專用，MUST NOT 進正式路徑** —— 正式路徑上它會為每一次查詢加一層閉包，
 * 而它換來的東西（可觀測性）在正式環境有別的做法。
 *
 * 「同一次往返」的可驗證形式是：已登入時 `User` 模型的操作**恰為 1 次**，
 * 且 `Notification` 模型的操作**為 0 次** —— 未讀數若是另外 `count()` 出來的，
 * 後者必然大於 0。只數總次數驗不出這件事：`findById` + `notification.count()`
 * 與 `findByIdWithUnread` 的總次數只差 1，看起來像是可接受的誤差。
 *
 * **MUST NOT 斷言「公開頁的總查詢次數不變」**：T076 的評論首屏與 T141 的真實排行
 * 本來就會改變公開頁的總次數，那是 FR-023a 與 FR-047 的明文要求。
 * 本檔的量測對象**只有導覽列未讀數**。
 */

interface RecordedOp {
  model: string | undefined;
  operation: string;
  args: unknown;
}

const state = vi.hoisted(() => ({
  ops: [] as RecordedOp[],
  /** 供 mock 的 `cookies()` 回傳的工作階段憑證；null 代表未登入訪客 */
  token: null as string | null,
}));

// 計數器包在 `@/lib/db` 的出口上 —— 資料存取層一律由此取得 client，
// 故這裡看得到的就是「上層真正付出的」全部操作
vi.mock('@/lib/db', async () => {
  const actual = await vi.importActual<typeof import('@/lib/db')>('@/lib/db');
  const counted = actual.prisma.$extends({
    query: {
      $allOperations({ model, operation, args, query }) {
        state.ops.push({ model, operation, args });
        return query(args);
      },
    },
  });
  return { prisma: counted as unknown as typeof actual.prisma };
});

// `guard.ts` 匯入 `next/navigation` 的 `redirect()`，而該模組在測試行程內載入時
// 會以 `React.createContext is not a function` 失敗（App Router 的 React context 相依，
// 與 `features.md` 記載的 `origin.ts` 拆分是同一個成因）。本檔量測的是查詢預算、
// 不經過任何轉址路徑，故把它換成一顆會擲錯的替身 —— 若哪天真的被呼叫到，
// 測試會紅在「不該轉址卻轉址了」，而不是靜默通過
vi.mock('next/navigation', () => ({
  redirect: () => {
    throw new Error('[guest-query-budget] 未預期的 redirect()：本檔不應走到轉址路徑');
  },
}));

// `getSessionUser()` 由請求範圍取 Cookie；整合測試沒有 Next 的請求範圍，
// 故把來源換成本檔可控的變數 —— 受測的是查詢預算，不是 Cookie 的讀法
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (state.token ? { name, value: state.token } : undefined),
  }),
  headers: async () => new Headers(),
}));

const { prisma } = await import('@/lib/db');
const { getSession, getSessionUser } = await import('@/lib/auth/guard');
const { resetAuthTables } = await import('../helpers/resetAuthTables');

const IP = '10.92.1.1';

let reader: { id: string; email: string; password: string };
let sessionToken: string;

/** 清空記錄後執行 fn，回傳期間發生的全部資料庫操作 */
async function record<T>(fn: () => Promise<T>): Promise<{ result: T; ops: RecordedOp[] }> {
  state.ops.length = 0;
  const result = await fn();
  return { result, ops: [...state.ops] };
}

const modelOps = (ops: RecordedOp[], model: string) => ops.filter((o) => o.model === model);

beforeAll(async () => {
  await resetAuthTables();
  await prisma.notification.deleteMany();

  reader = await createAccount('budget-reader');
  const cookie = await loginAs(reader.email, reader.password, IP);
  sessionToken = cookie.split('=').slice(1).join('=');

  // 兩則未讀、一則已讀：未讀數若取錯（例如數了全部）會得到 3 而非 2
  await prisma.notification.createMany({
    data: [
      { userId: reader.id, type: 'chapter_published', payload: '{}' },
      { userId: reader.id, type: 'chapter_published', payload: '{}' },
      { userId: reader.id, type: 'chapter_published', payload: '{}', readAt: new Date() },
    ],
  });
}, 120_000);

afterAll(async () => {
  state.token = null;
  await prisma.notification.deleteMany();
  await resetAuthTables();
});

describe('T117-1：未登入訪客的相對成本為 0（SC-020）', () => {
  it('getSessionUser() 回 null，且期間不產生任何資料庫操作', async () => {
    state.token = null;
    const { result, ops } = await record(() => getSessionUser());

    expect(result).toBeNull();
    // 「0 次額外操作」在此是字面意義的 0：未登入路徑於 getSession() 即提前返回
    expect(ops).toEqual([]);
  });

  it('未讀數不曾被查詢（訪客沒有未讀數這個概念）', async () => {
    state.token = null;
    const { ops } = await record(() => getSessionUser());
    expect(modelOps(ops, 'Notification')).toHaveLength(0);
    expect(modelOps(ops, 'User')).toHaveLength(0);
  });
});

describe('T117-2：已登入者每頁至多一次計數，且與既有查詢同一次往返（FR-053a）', () => {
  let baseline: RecordedOp[];
  let full: RecordedOp[];
  let user: { id: string; unreadCount?: number } | null;

  beforeAll(async () => {
    state.token = sessionToken;
    // 基準：只讀工作階段（`getSessionUser()` 的前半段）
    baseline = (await record(() => getSession())).ops;
    const measured = await record(() => getSessionUser());
    full = measured.ops;
    user = measured.result as typeof user;
  }, 60_000);

  it('工作階段確實被讀到（基準若為空，下一則的差值就沒有意義）', () => {
    expect(user).not.toBeNull();
    expect(baseline.length).toBeGreaterThan(0);
  });

  it('相較於只讀工作階段，恰多出 1 次操作', () => {
    expect(full.length - baseline.length).toBe(1);
  });

  it('多出的那一次是 User 的單一查詢，且 Notification 未被另外查詢（同一次往返）', () => {
    expect(modelOps(full, 'User')).toHaveLength(1);
    // 另外 count() 一次也會讓總次數只差 1，故 MUST 一併斷言 Notification 為 0
    expect(modelOps(full, 'Notification')).toHaveLength(0);
  });

  it('該次查詢即以過濾式關聯計數取回未讀數（research R-6）', () => {
    const args = modelOps(full, 'User')[0].args as {
      select?: { _count?: { select?: { notifications?: { where?: { readAt?: unknown } } } } };
      include?: { _count?: { select?: { notifications?: { where?: { readAt?: unknown } } } } };
    };
    const countSelect =
      args.select?._count?.select?.notifications ?? args.include?._count?.select?.notifications;

    expect(countSelect).toBeDefined();
    expect(countSelect?.where).toEqual({ readAt: null });
  });

  it('取回的未讀數為 2（三則中兩則未讀 —— 數成 3 代表沒有套上 readAt 條件）', () => {
    expect(user?.unreadCount).toBe(2);
  });

  it('連續兩次呼叫的成本相同（每頁至多一次，MUST NOT 隨頁數累加）', async () => {
    state.token = sessionToken;
    const first = (await record(() => getSessionUser())).ops;
    const second = (await record(() => getSessionUser())).ops;
    expect(modelOps(second, 'User')).toHaveLength(modelOps(first, 'User').length);
    expect(modelOps(second, 'User')).toHaveLength(1);
  });
});
