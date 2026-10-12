import { describe, expect, it, vi, afterEach } from 'vitest';
import { logSecurityEvent } from '@/lib/auth/audit';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('logSecurityEvent', () => {
  it('輸出單行 JSON 且具備四個固定欄位', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logSecurityEvent({
      event: 'auth.login.failed',
      ip: '203.0.113.7',
      result: 'invalid_credentials',
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const output = spy.mock.calls[0][0] as string;
    expect(output.split('\n')).toHaveLength(1);

    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty('event', 'auth.login.failed');
    expect(parsed).toHaveProperty('at');
    expect(parsed).toHaveProperty('ip', '203.0.113.7');
    expect(parsed).toHaveProperty('result', 'invalid_credentials');
    expect(Object.keys(parsed).sort()).toEqual(['at', 'event', 'ip', 'result']);
  });

  it('傳入含密碼與憑證欄位的物件時，輸出字串不含該兩者的值', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const withExtraFields = {
      event: 'auth.login.failed',
      ip: '203.0.113.7',
      result: 'invalid_credentials',
      password: 'super-secret-password',
      credential: 'novelsite_session=abc.def.ghi',
    };

    logSecurityEvent(withExtraFields);

    const output = spy.mock.calls[0][0] as string;
    expect(output).not.toContain('super-secret-password');
    expect(output).not.toContain('novelsite_session=abc.def.ghi');
  });
});
