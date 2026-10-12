import { describe, it, expect, beforeAll } from 'vitest';
import { testFetch, loginAs } from '../helpers/client';
import { createUser } from '../helpers/fixtures';
import { resetAuthTables } from '../helpers/resetAuthTables';
import { getAllNovels, getNovelDetail } from '@/lib/repositories';

beforeAll(async () => {
  await resetAuthTables();
});

function cspOf(res: Response): string {
  return res.headers.get('content-security-policy') ?? '';
}

function nonceOf(res: Response): string | null {
  return cspOf(res).match(/'nonce-([^']+)'/)?.[1] ?? null;
}

/** FR-032 案例 10：公開頁與受保護頁取得同一套 CSP 與各自 nonce；靜態資源與 API 不含 CSP 但仍有其餘五個標頭 */
describe('攔截層 matcher 範圍與職責切分（FR-032 案例 10、FR-053）', () => {
  it('公開頁（首頁／書庫／閱讀頁）與受保護頁取得同一套 CSP 政策，但各自持有不同 nonce', async () => {
    // 取任一有完整詳情（含 firstChapterId）的作品 —— 部分示範作品僅有列表用基本欄位，
    // 沒有完整 NovelDetail，直接取 getAllNovels() 的第一筆可能命中這種作品而拿到空 chapterId。
    const novels = await getAllNovels();
    let readerPath: string | undefined;
    for (const n of novels) {
      const detail = await getNovelDetail(n.id);
      if (detail?.firstChapterId) {
        readerPath = `/reader/${n.id}/${detail.firstChapterId}`;
        break;
      }
    }
    expect(readerPath).toBeTruthy();

    const home = await testFetch('/', { ip: '10.40.8.1' });
    const library = await testFetch('/novels', { ip: '10.40.8.2' });
    const reader = await testFetch(readerPath!, { ip: '10.40.8.3' });

    const email = 'proxy-scope-author@example.com';
    await createUser({ email, role: 'author', password: 'Author1234' });
    const cookie = await loginAs(email, 'Author1234', '10.40.8.4');
    const protectedRes = await testFetch('/author/dashboard', { ip: '10.40.8.5', cookie });

    expect([home.status, library.status, reader.status, protectedRes.status]).toEqual([
      200, 200, 200, 200,
    ]);

    const stripNonce = (csp: string) => csp.replace(/'nonce-[^']+'/, "'nonce-<x>'");
    const policies = [home, library, reader, protectedRes].map((r) => stripNonce(cspOf(r)));
    expect(policies[0]).toBeTruthy();
    expect(new Set(policies).size).toBe(1); // 同一套政策（去除 nonce 後完全相同）

    const nonces = [home, library, reader, protectedRes].map(nonceOf);
    expect(new Set(nonces).size).toBe(4); // 各自持有不同 nonce
  });

  it('靜態資源（_next/static 與 public/ 下檔案）不含 CSP 標頭，但仍具備其餘五個安全性標頭', async () => {
    const home = await testFetch('/', { ip: '10.40.8.6' });
    const body = await home.text();
    const staticChunk = body.match(/\/_next\/static\/[^"'\s)]+\.js/)?.[0];
    expect(staticChunk).toBeTruthy();

    const chunkRes = await testFetch(staticChunk!, { ip: '10.40.8.7' });
    expect(chunkRes.headers.get('content-security-policy')).toBeNull();
    expect(chunkRes.headers.get('x-frame-options')).toBeTruthy();
    expect(chunkRes.headers.get('strict-transport-security')).toBeTruthy();

    const publicAssetRes = await testFetch('/next.svg', { ip: '10.40.8.8' });
    expect(publicAssetRes.headers.get('content-security-policy')).toBeNull();
    expect(publicAssetRes.headers.get('x-frame-options')).toBeTruthy();
    expect(publicAssetRes.headers.get('strict-transport-security')).toBeTruthy();
  });

  it('/api/health 不含 CSP 標頭，但仍具備其餘五個安全性標頭', async () => {
    const res = await testFetch('/api/health', { ip: '10.40.8.9' });
    expect(res.headers.get('content-security-policy')).toBeNull();
    expect(res.headers.get('x-frame-options')).toBeTruthy();
    expect(res.headers.get('x-content-type-options')).toBeTruthy();
    expect(res.headers.get('referrer-policy')).toBeTruthy();
    expect(res.headers.get('permissions-policy')).toBeTruthy();
    expect(res.headers.get('strict-transport-security')).toBeTruthy();
  });
});
