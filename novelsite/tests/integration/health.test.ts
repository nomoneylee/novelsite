import { describe, it, expect } from 'vitest';
import { testFetch } from '../helpers/client';

/**
 * /api/health 密鑰分流（FR-022、User Story 3 情境 4）。此端點不清空認證域也不受限流影響，
 * 不需 resetAuthTables()。
 */
describe('GET /api/health（密鑰分流）', () => {
  it('未帶密鑰只得 { ok }，不含 provider／延遲／trustedProxyHops／rateLimitMode', async () => {
    const res = await testFetch('/api/health', { ip: '10.40.6.1' });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true });
  });

  it('帶錯誤密鑰同樣只得 { ok }', async () => {
    const res = await testFetch('/api/health', {
      ip: '10.40.6.2',
      headers: { 'x-health-secret': 'wrong-secret' },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true });
  });

  it('帶正確密鑰時回傳 provider／dbLatencyMs／trustedProxyHops／rateLimitMode 四項', async () => {
    const secret = process.env.HEALTH_CHECK_SECRET;
    expect(secret).toBeTruthy();

    const res = await testFetch('/api/health', {
      ip: '10.40.6.3',
      headers: { 'x-health-secret': secret! },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(['sqlite', 'postgresql']).toContain(json.provider);
    expect(typeof json.dbLatencyMs).toBe('number');
    expect(json.trustedProxyHops).toBe(1); // .env.test 設定
    expect(json.rateLimitMode).toBe('single-instance');
  });
});
