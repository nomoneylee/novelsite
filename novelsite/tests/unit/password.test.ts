import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword, DUMMY_HASH, ARGON2_PARAMS } from '@/lib/auth/password';

describe('password', () => {
  it('雜湊結果不等於明碼', async () => {
    const hashed = await hashPassword('correct-horse-battery-staple');
    expect(hashed).not.toBe('correct-horse-battery-staple');
  });

  it('verify 正確密碼回傳 true', async () => {
    const hashed = await hashPassword('correct-horse-battery-staple');
    await expect(verifyPassword(hashed, 'correct-horse-battery-staple')).resolves.toBe(true);
  });

  it('verify 錯誤密碼回傳 false', async () => {
    const hashed = await hashPassword('correct-horse-battery-staple');
    await expect(verifyPassword(hashed, 'wrong-password')).resolves.toBe(false);
  });

  it('同密碼兩次雜湊結果不同（salt 隨機）', async () => {
    const a = await hashPassword('same-password-123');
    const b = await hashPassword('same-password-123');
    expect(a).not.toBe(b);
  });

  it('DUMMY_HASH 使用與正式雜湊相同的參數', () => {
    const paramsFragment = `m=${ARGON2_PARAMS.memoryCost},t=${ARGON2_PARAMS.timeCost},p=${ARGON2_PARAMS.parallelism}`;
    expect(DUMMY_HASH).toContain(paramsFragment);
    expect(DUMMY_HASH).toMatch(/^\$argon2id\$/);
  });
});
