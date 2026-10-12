import { describe, it, expect, beforeAll } from 'vitest';
import { testFetch } from '../helpers/client';
import { resetAuthTables } from '../helpers/resetAuthTables';

beforeAll(async () => {
  await resetAuthTables();
});

describe('跨站 Origin 對寫入 Route Handler 的請求（FR-032 案例 7）', () => {
  it('POST /api/auth/register 帶跨站 Origin → 403 FORBIDDEN（research.md R-4 要求打 Route Handler）', async () => {
    const res = await testFetch('/api/auth/register', {
      method: 'POST',
      ip: '10.40.2.1',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example.com' },
      body: JSON.stringify({
        name: '攻擊者',
        email: 'csrf-register@example.com',
        password: 'Abcd1234',
        acceptTerms: true,
      }),
    });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error.code).toBe('FORBIDDEN');
  });

  it('POST /api/auth/login 帶跨站 Origin → 403 FORBIDDEN', async () => {
    const res = await testFetch('/api/auth/login', {
      method: 'POST',
      ip: '10.40.2.2',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example.com' },
      body: JSON.stringify({ email: 'whoever@example.com', password: 'Whatever1234' }),
    });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error.code).toBe('FORBIDDEN');
  });

  /**
   * FEAT-4 4-A（T033）：讀者狀態的六個寫入端點。
   *
   * 這一組**未登入**且帶跨站 Origin，斷言回 **403 而非 401** ——
   * 順序是刻意的：來源比對 MUST 在身分判定之前。反過來的話，
   * 已登入使用者的瀏覽器從惡意站台送出的請求會通過來源這一關，
   * 而那正是 CSRF 的樣子（FR-006）。
   */
  const readerWriteEndpoints: { path: string; method: string; body?: string }[] = [
    { path: '/api/bookshelf/any-novel', method: 'POST' },
    { path: '/api/bookshelf/any-novel', method: 'DELETE' },
    {
      path: '/api/reading-progress',
      method: 'PUT',
      body: JSON.stringify({ novelId: 'n', chapterId: 'c', percent: 1 }),
    },
    { path: '/api/history', method: 'DELETE' },
    { path: '/api/reader-preference', method: 'PUT', body: JSON.stringify({ fontSize: 'lg' }) },
    {
      path: '/api/reader-state/merge',
      method: 'POST',
      body: JSON.stringify({ bookshelf: [], history: [] }),
    },
  ];

  it.each(readerWriteEndpoints)(
    '$method $path 帶跨站 Origin → 403 FORBIDDEN（先擋來源，再談身分）',
    async ({ path, method, body }) => {
      const res = await testFetch(path, {
        method,
        ip: '10.40.2.4',
        headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example.com' },
        ...(body ? { body } : {}),
      });
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe('FORBIDDEN');
    }
  );

  /**
   * FEAT-4 4-B（T073）：互動域**七個端點檔的全部寫入方法**（T066～T072）。
   *
   * 憲章第 II 條要求「首開寫入路徑的 PR 內落地全部條款」，而本刀一次新增七條寫入路徑；
   * 跨站來源比對漏掉其中一條**不會有任何症狀**，直到有人從別的網站借使用者的 Cookie 改資料。
   *
   * 與上一組同樣**未登入**送出，斷言 403 而非 401 —— 來源比對 MUST 在身分判定之前。
   */
  const interactionWriteEndpoints: { path: string; method: string; body?: string }[] = [
    {
      path: '/api/novels/any-novel/reviews',
      method: 'POST',
      body: JSON.stringify({ rating: 5, content: '跨站送出的評論' }),
    },
    {
      path: '/api/reviews/any-review',
      method: 'PATCH',
      body: JSON.stringify({ content: '跨站改掉的評論' }),
    },
    { path: '/api/reviews/any-review', method: 'DELETE' },
    { path: '/api/reviews/any-review/like', method: 'POST' },
    { path: '/api/reviews/any-review/like', method: 'DELETE' },
    {
      path: '/api/chapters/any-chapter/comments',
      method: 'POST',
      body: JSON.stringify({ content: '跨站送出的留言' }),
    },
    { path: '/api/comments/any-comment', method: 'DELETE' },
    {
      path: '/api/author/comments/any-comment',
      method: 'PATCH',
      body: JSON.stringify({ hidden: true }),
    },
  ];

  it.each(interactionWriteEndpoints)(
    '$method $path 帶跨站 Origin → 403 FORBIDDEN（先擋來源，再談身分）',
    async ({ path, method, body }) => {
      const res = await testFetch(path, {
        method,
        ip: '10.40.2.5',
        headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example.com' },
        ...(body ? { body } : {}),
      });
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe('FORBIDDEN');
    }
  );

  /**
   * FEAT-4 4-C（T103）：閱讀上報端點。
   *
   * 這一條與上面兩組不同 —— 它**對匿名開放**，於是「不需要登入」很容易被讀成
   * 「誰都可以呼叫」。兩者是不同的門：它寫入 `ChapterView`，即屬 FR-006 所稱的
   * 新增寫入入口，缺了來源比對，任何外部網站都能對本站刷曝光與排行分數。
   *
   * 也是本檔唯一一條「拒絕方式與同一端點的另一種拒絕相反」的路徑：
   * 跨站來源明確回 403，而限流超額是靜默回 200（見 view-rate-silent.test.ts）。
   */
  it('POST /api/chapters/{id}/view 帶跨站 Origin → 403 FORBIDDEN（匿名開放 ≠ 任何站台皆可呼叫）', async () => {
    const res = await testFetch('/api/chapters/any-chapter/view', {
      method: 'POST',
      ip: '10.40.2.6',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example.com' },
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('FORBIDDEN');
  });

  /**
   * FEAT-4 4-D（T133）：通知的兩個寫入入口。
   *
   * 兩者都是「把別人的未讀數清成 0」的路徑 —— 被跨站觸發時，使用者只會覺得
   * 「通知怎麼不見了」，沒有任何可見的失敗。與前面幾組同樣**未登入**送出，
   * 斷言 403 而非 401：來源比對 MUST 在身分判定之前。
   *
   * **三個 cron 入口不在本清單**：它們由外部排程器呼叫，沒有瀏覽器來源可比對，
   * 其防護是 `CRON_SECRET`（見 cron-auth.test.ts）。
   */
  const notificationWriteEndpoints: { path: string; method: string; body: string }[] = [
    { path: '/api/notifications', method: 'PATCH', body: JSON.stringify({}) },
    {
      path: '/api/notifications/any-notification',
      method: 'PATCH',
      body: JSON.stringify({ read: true }),
    },
  ];

  it.each(notificationWriteEndpoints)(
    '$method $path 帶跨站 Origin → 403 FORBIDDEN（先擋來源，再談身分）',
    async ({ path, method, body }) => {
      const res = await testFetch(path, {
        method,
        ip: '10.40.2.7',
        headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example.com' },
        body,
      });
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe('FORBIDDEN');
    }
  );

  it('同源 Origin 的請求不受 CSRF 檢查阻擋（僅驗證前置檢查未誤擋，非本案例重點）', async () => {
    const res = await testFetch('/api/auth/login', {
      method: 'POST',
      ip: '10.40.2.3',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nonexistent-csrf@example.com', password: 'Whatever1234' }),
    });
    // 同源請求應通過 CSRF 檢查，走到正常的認證錯誤（401），而非 403
    expect(res.status).toBe(401);
  });
});
