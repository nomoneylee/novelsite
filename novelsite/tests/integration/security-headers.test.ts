import { describe, it, expect } from 'vitest';
import { testFetch } from '../helpers/client';

const SIX_HEADERS = [
  'content-security-policy',
  'strict-transport-security',
  'x-frame-options',
  'x-content-type-options',
  'referrer-policy',
  'permissions-policy',
];

function extractHeaderNonce(csp: string): string | null {
  const match = csp.match(/'nonce-([^']+)'/);
  return match?.[1] ?? null;
}

/** FR-032 案例 9：安全性標頭齊備、nonce 逐請求不同、標頭與 HTML 內 nonce 一致、正式模式無 unsafe-* */
describe('安全性標頭與 CSP nonce（FR-032 案例 9）', () => {
  it('任一頁面回應具備 FR-025 所列六個安全標頭', async () => {
    const res = await testFetch('/', { ip: '10.40.7.1' });
    expect(res.status).toBe(200);
    for (const header of SIX_HEADERS) {
      expect(res.headers.get(header)).toBeTruthy();
    }
  });

  it('同頁連續兩次請求的 nonce 不相同', async () => {
    const res1 = await testFetch('/', { ip: '10.40.7.2' });
    const res2 = await testFetch('/', { ip: '10.40.7.3' });
    const nonce1 = extractHeaderNonce(res1.headers.get('content-security-policy')!);
    const nonce2 = extractHeaderNonce(res2.headers.get('content-security-policy')!);
    expect(nonce1).toBeTruthy();
    expect(nonce2).toBeTruthy();
    expect(nonce1).not.toBe(nonce2);
  });

  it('回應標頭中的 nonce 與 HTML 內防閃爍 <script nonce> 一致', async () => {
    const res = await testFetch('/', { ip: '10.40.7.4' });
    const headerNonce = extractHeaderNonce(res.headers.get('content-security-policy')!);
    const body = await res.text();
    expect(body).toContain(`nonce="${headerNonce}"`);
  });

  it('正式建置產物的 script-src 不含 unsafe-inline／unsafe-eval，且含 strict-dynamic', async () => {
    const res = await testFetch('/', { ip: '10.40.7.5' });
    const csp = res.headers.get('content-security-policy')!;
    const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src'))!;
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
    expect(scriptSrc).toContain("'strict-dynamic'");
  });

  it("style-src 仍含 'unsafe-inline'（唯一既有例外）", async () => {
    const res = await testFetch('/', { ip: '10.40.7.6' });
    const csp = res.headers.get('content-security-policy')!;
    const styleSrc = csp.split(';').find((d) => d.trim().startsWith('style-src'))!;
    expect(styleSrc).toContain("'unsafe-inline'");
  });
});
