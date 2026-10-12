import { describe, it, expect, beforeAll } from 'vitest';
import { testFetch, loginAs } from '../helpers/client';
import { createUser } from '../helpers/fixtures';
import { resetAuthTables } from '../helpers/resetAuthTables';
import { prisma } from '@/lib/db';

beforeAll(async () => {
  await resetAuthTables();
});

describe('版面層以資料庫覆核角色（User Story 2 情境 9、FR-045）', () => {
  it('登入後角色於資料庫被改為 reader，原 JWT 快照仍為 author 時，版面層仍擋下 /author/*', async () => {
    const email = 'guard-fallback@example.com';
    await createUser({ email, role: 'author', password: 'Author1234' });
    const cookie = await loginAs(email, 'Author1234', '10.40.3.1');

    // 直接於資料庫將角色改為 reader，模擬「JWT 快照過期」情境 —— 不經任何應用層 API，
    // 刻意繞過應用層以構造 proxy.ts 的角色快照（author）與資料庫真相（reader）不一致的狀態。
    await prisma.user.update({ where: { email }, data: { role: 'reader' } });

    const res = await testFetch('/author/dashboard', { ip: '10.40.3.2', cookie });

    // proxy.ts 僅讀 JWT 快照（仍是 author）故會放行至版面層；版面層 requireAuthor() 以資料庫
    // 覆核後角色已是 reader，MUST 轉址。Next.js 的 redirect() 在 Server Component 中固定回應
    // 307（見 node_modules/next/dist/docs 的 redirect() 參考），與 Route Handler／proxy 可自訂
    // 狀態碼的 NextResponse.redirect() 不同 —— 故本案例只斷言「非 200 且不含後台內容」。
    expect(res.status).not.toBe(200);
    expect([301, 302, 303, 307, 308]).toContain(res.status);

    const body = await res.text();
    expect(body).not.toContain('數據儀表板');
  });
});
