import { describe, it, expect, beforeAll } from 'vitest';
import { testFetch } from '../helpers/client';
import { createUser } from '../helpers/fixtures';
import { resetAuthTables } from '../helpers/resetAuthTables';

beforeAll(async () => {
  await resetAuthTables();
});

async function postLogin(body: unknown, ip: string) {
  return testFetch('/api/auth/login', {
    method: 'POST',
    ip,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/login 速率限制（FR-032 案例 4）', () => {
  it('既有帳號：5 次錯誤密碼各用不同位址後，第 6 次（另一位址）回 429 + Retry-After', async () => {
    const email = 'rate-limit-existing@example.com';
    await createUser({ email, role: 'reader', password: 'CorrectPass1' });

    for (let i = 0; i < 5; i++) {
      const res = await postLogin({ email, password: 'WrongPass1' }, `10.30.1.${i + 1}`);
      expect(res.status).toBe(401);
    }

    const blocked = await postLogin({ email, password: 'WrongPass1' }, '10.30.1.99');
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).not.toBeNull();
    const json = await blocked.json();
    expect(json.error.code).toBe('RATE_LIMITED');
  });

  it('不存在的帳號：得到與既有帳號完全相同的 429 回應（FR-046、SC-005）', async () => {
    const email = 'rate-limit-nonexistent@example.com';

    for (let i = 0; i < 5; i++) {
      const res = await postLogin({ email, password: 'WhateverPass1' }, `10.30.2.${i + 1}`);
      expect(res.status).toBe(401);
    }

    const blocked = await postLogin({ email, password: 'WhateverPass1' }, '10.30.2.99');
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).not.toBeNull();
    const json = await blocked.json();
    expect(json.error.code).toBe('RATE_LIMITED');
    expect(typeof json.error.message).toBe('string');
  });

  it('既有帳號與不存在帳號的 429 回應內容（code／message）完全一致，不構成枚舉管道', async () => {
    const existingEmail = 'rate-limit-compare-existing@example.com';
    await createUser({ email: existingEmail, role: 'reader', password: 'CorrectPass1' });
    const missingEmail = 'rate-limit-compare-missing@example.com';

    for (let i = 0; i < 5; i++) {
      await postLogin({ email: existingEmail, password: 'WrongPass1' }, `10.30.3.${i + 1}`);
    }
    const blockedExisting = await postLogin(
      { email: existingEmail, password: 'WrongPass1' },
      '10.30.3.90'
    );

    for (let i = 0; i < 5; i++) {
      await postLogin({ email: missingEmail, password: 'WrongPass1' }, `10.30.4.${i + 1}`);
    }
    const blockedMissing = await postLogin(
      { email: missingEmail, password: 'WrongPass1' },
      '10.30.4.90'
    );

    expect(blockedExisting.status).toBe(blockedMissing.status);
    const [jsonExisting, jsonMissing] = await Promise.all([
      blockedExisting.json(),
      blockedMissing.json(),
    ]);
    expect(jsonExisting.error.code).toBe(jsonMissing.error.code);
    expect(jsonExisting.error.message).toBe(jsonMissing.error.message);
  });
});
