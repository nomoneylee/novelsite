import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { testFetch, loginAs } from '../helpers/client';
import { resetAuthTables } from '../helpers/resetAuthTables';
import { createAccount } from '../helpers/fixtures';

/**
 * T015a：閱讀偏好的跨裝置一致（SC-001 的偏好項）
 * ================================================
 * 兩個**獨立工作階段**（不同 cookie jar、不同來源位址）模擬兩台裝置。
 *
 * **為何不能靠 T147 的 E2E 涵蓋**：那條流程是同一個瀏覽器重新登入，`localStorage`
 * 仍在 —— 即使伺服器同步完全沒接上，畫面照樣顯示正確的字級與主題，測試照樣綠。
 * 偏好項的跨裝置保證只有這裡驗得出來。
 */

const IP_A = '10.95.1.1';
const IP_B = '10.95.1.2';

let reader: { id: string; email: string; password: string };
let deviceA: string;
let deviceB: string;

beforeAll(async () => {
  await resetAuthTables();
  reader = await createAccount('pref-reader');
  deviceA = await loginAs(reader.email, reader.password, IP_A);
  deviceB = await loginAs(reader.email, reader.password, IP_B);
  expect(deviceA).not.toBe(deviceB);
});

afterAll(async () => {
  await prisma.readerPreference.deleteMany();
  await resetAuthTables();
});

describe('T015a：偏好於兩個獨立工作階段之間一致', () => {
  it('裝置 A 寫入 → 裝置 B 讀到相同的 fontSize 與 theme', async () => {
    const put = await testFetch('/api/reader-preference', {
      method: 'PUT',
      ip: IP_A,
      cookie: deviceA,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fontSize: 'lg', theme: 'eyecare' }),
    });
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ preference: { fontSize: 'lg', theme: 'eyecare' } });

    const get = await testFetch('/api/reader-preference', {
      method: 'GET',
      ip: IP_B,
      cookie: deviceB,
    });
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual({ preference: { fontSize: 'lg', theme: 'eyecare' } });
  });

  it('部分更新只動被指定的那一項（另一項保持原值）', async () => {
    await testFetch('/api/reader-preference', {
      method: 'PUT',
      ip: IP_B,
      cookie: deviceB,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: 'dark' }),
    });

    const get = await testFetch('/api/reader-preference', {
      method: 'GET',
      ip: IP_A,
      cookie: deviceA,
    });
    expect(await get.json()).toEqual({ preference: { fontSize: 'lg', theme: 'dark' } });
  });

  it('尚未設定過偏好的帳號 GET 回 null（供客戶端沿用本機值）', async () => {
    const fresh = await createAccount('pref-fresh');
    const cookie = await loginAs(fresh.email, fresh.password, '10.95.1.3');

    const res = await testFetch('/api/reader-preference', {
      method: 'GET',
      ip: '10.95.1.3',
      cookie,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ preference: null });
  });

  it('值域外的輸入 → 400，且既有偏好未被破壞', async () => {
    const before = await prisma.readerPreference.findUniqueOrThrow({
      where: { userId: reader.id },
    });

    const res = await testFetch('/api/reader-preference', {
      method: 'PUT',
      ip: IP_A,
      cookie: deviceA,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fontSize: 'xl' }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR');

    const after = await prisma.readerPreference.findUniqueOrThrow({
      where: { userId: reader.id },
    });
    expect(after.fontSize).toBe(before.fontSize);
    expect(after.theme).toBe(before.theme);
  });
});
