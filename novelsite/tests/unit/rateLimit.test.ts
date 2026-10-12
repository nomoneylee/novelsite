import { describe, expect, it, beforeEach } from 'vitest';
import { rateLimitStore, clientIpFrom, accountKey } from '@/lib/auth/rateLimit';

describe('rateLimitStore.hit', () => {
  it('位址鍵達上限即拒', async () => {
    const key = `ip-${Math.random()}`;
    for (let i = 0; i < 5; i++) {
      const r = await rateLimitStore.hit(key, 60_000, 5);
      expect(r.allowed).toBe(true);
    }
    const blocked = await rateLimitStore.hit(key, 60_000, 5);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('帳號鍵達上限即拒', async () => {
    const key = accountKey(`user-${Math.random()}@example.com`);
    for (let i = 0; i < 5; i++) {
      await rateLimitStore.hit(key, 900_000, 5);
    }
    const blocked = await rateLimitStore.hit(key, 900_000, 5);
    expect(blocked.allowed).toBe(false);
  });

  it('換位址不能繞過帳號鍵限流（帳號鍵與位址鍵各自獨立累計）', async () => {
    const email = `shared-${Math.random()}@example.com`;
    const acctKey = accountKey(email);
    // 模擬 5 次失敗嘗試，每次換一個不同位址鍵，但帳號鍵相同
    for (let i = 0; i < 5; i++) {
      const ipKey = `ip-${i}-${Math.random()}`;
      await rateLimitStore.hit(ipKey, 60_000, 100); // 位址鍵門檻寬鬆，確保不是它擋下
      await rateLimitStore.hit(acctKey, 900_000, 5);
    }
    const blocked = await rateLimitStore.hit(acctKey, 900_000, 5);
    expect(blocked.allowed).toBe(false);
  });

  it('時間窗過後重置（模擬窗口極短，等待後應重新允許）', async () => {
    const key = `ip-window-${Math.random()}`;
    await rateLimitStore.hit(key, 10, 1); // max 1 次／10ms
    const second = await rateLimitStore.hit(key, 10, 1);
    expect(second.allowed).toBe(false);

    await new Promise((r) => setTimeout(r, 30));
    const third = await rateLimitStore.hit(key, 10, 1);
    expect(third.allowed).toBe(true);
  });

  it('成功登入後帳號鍵計數可被 reset 清除', async () => {
    const key = accountKey(`reset-${Math.random()}@example.com`);
    for (let i = 0; i < 5; i++) {
      await rateLimitStore.hit(key, 900_000, 5);
    }
    await expect(rateLimitStore.hit(key, 900_000, 5)).resolves.toMatchObject({ allowed: false });

    await rateLimitStore.reset(key);

    await expect(rateLimitStore.hit(key, 900_000, 5)).resolves.toMatchObject({ allowed: true });
  });

  it('不存在的帳號同樣被計數並限流（accountKey 對任意 Email 字串一視同仁）', async () => {
    const key = accountKey(`does-not-exist-${Math.random()}@example.com`);
    for (let i = 0; i < 5; i++) {
      const r = await rateLimitStore.hit(key, 900_000, 5);
      expect(r.allowed).toBe(true);
    }
    const blocked = await rateLimitStore.hit(key, 900_000, 5);
    expect(blocked.allowed).toBe(false);
  });

  it('計數不因後續驗證結果而扣回（呼叫端每次送達的請求皆計入）', async () => {
    const key = `register-ip-${Math.random()}`;
    // 模擬 3 次請求皆計入，不論後續是否驗證失敗或衝突
    await rateLimitStore.hit(key, 60 * 60_000, 3);
    await rateLimitStore.hit(key, 60 * 60_000, 3);
    await rateLimitStore.hit(key, 60 * 60_000, 3);
    const fourth = await rateLimitStore.hit(key, 60 * 60_000, 3);
    expect(fourth.allowed).toBe(false);
  });
});

describe('clientIpFrom', () => {
  // .env.test 設定 TRUSTED_PROXY_HOPS=1：自 X-Forwarded-For 右側往左數第 1 個位址
  it('依 TRUSTED_PROXY_HOPS 自右側取位址，不受左側偽造值影響', () => {
    const headers = new Headers({ 'x-forwarded-for': '9.9.9.9, 1.1.1.1, 2.2.2.2, 3.3.3.3' });
    expect(clientIpFrom(headers, '127.0.0.1')).toBe('3.3.3.3');
  });

  it('缺少 X-Forwarded-For 標頭時回退直連位址', () => {
    const headers = new Headers();
    expect(clientIpFrom(headers, '127.0.0.1')).toBe('127.0.0.1');
  });
});

describe('accountKey', () => {
  beforeEach(() => {
    // no-op：確保每個測試案例獨立
  });

  it('對大小寫與前後空白不同但正規化後相同的 Email 產生相同 key', () => {
    expect(accountKey('User@Example.com')).toBe(accountKey('  user@example.com  '));
  });

  it('不同 Email 產生不同 key', () => {
    expect(accountKey('a@example.com')).not.toBe(accountKey('b@example.com'));
  });
});
