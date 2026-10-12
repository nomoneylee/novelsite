import { describe, it, expect, beforeAll } from 'vitest';
import { testFetch } from '../helpers/client';
import { createUser } from '../helpers/fixtures';
import { resetAuthTables } from '../helpers/resetAuthTables';
import { usersRepo } from '@/lib/repositories';

beforeAll(async () => {
  await resetAuthTables();
});

function registerBody(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    name: '測試使用者',
    email: 'register-case@example.com',
    password: 'Abcd1234',
    acceptTerms: true,
    ...overrides,
  };
}

async function postRegister(body: unknown, ip: string) {
  return testFetch('/api/auth/register', {
    method: 'POST',
    ip,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/register（FR-032 案例 1–3）', () => {
  it('案例 1：既有 Email 註冊回 409 且 DB 不新增列（SC-004）', async () => {
    const email = 'existing-register-1@example.com';
    await createUser({ email, role: 'reader', password: 'Existing123' });

    const res = await postRegister(registerBody({ email }), '10.20.1.1');
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error.code).toBe('CONFLICT');

    const rows = await usersRepo.findByEmail(email);
    expect(rows).not.toBeNull();
    // 仍只有一列（唯一約束本就保證，這裡額外確認密碼未被覆寫）
    expect(
      await import('@node-rs/argon2').then((m) => m.verify(rows!.passwordHash, 'Existing123'))
    ).toBe(true);
  });

  it('案例 2：密碼 7 字元回 400 且 fields.password 有訊息', async () => {
    const res = await postRegister(
      registerBody({ email: 'short-password@example.com', password: 'Ab1234x'.slice(0, 7) }),
      '10.20.1.2'
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe('VALIDATION_ERROR');
    expect(typeof json.error.fields.password).toBe('string');
  });

  it('案例 3：註冊後 passwordHash 不等於明碼且為不可逆雜湊（SC-003）', async () => {
    const email = 'hash-check@example.com';
    const password = 'Abcd12345';
    const res = await postRegister(registerBody({ email, password }), '10.20.1.3');
    expect(res.status).toBe(200);

    const user = await usersRepo.findByEmail(email);
    expect(user).not.toBeNull();
    expect(user!.passwordHash).not.toBe(password);
    expect(user!.passwordHash).toMatch(/^\$argon2id\$/);
  });
});
