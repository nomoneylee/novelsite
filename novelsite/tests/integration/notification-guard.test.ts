import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { testFetch, loginAs } from '../helpers/client';
import { resetAuthTables } from '../helpers/resetAuthTables';
import { createAccount } from '../helpers/fixtures';

/**
 * T117b：通知寫入入口的未登入與跨帳號防線（FR-002、T132）
 * =========================================================
 * FR-002 的對象是「本階段新增的**所有**寫入入口」，而既有的 401 斷言各自只涵蓋一段：
 * T009 是 US1 的六個端點、T053a 是 US2 的七條互動路徑、T091 是三個 cron 入口。
 * US4 的兩個通知寫入路徑先前**沒有任何** 401 斷言 ——
 * 漏掉守衛的端點不會有症狀，直到有人不帶 Cookie 就把別人的通知全標成已讀。
 *
 * 「回 401」與「沒有寫入」是**兩件事**：只驗狀態碼時，一個先寫入再回 401 的實作也會綠燈。
 * 故每一則案例都在請求前後比對 `readAt` —— 未讀數是導覽列上唯一會變的數字，
 * 被人遠端清成 0 時使用者只會覺得「通知怎麼不見了」。
 *
 * **他人的通知回 404 而非 403**（T132）：403 等於告訴呼叫者「這個識別碼是有效的，
 * 只是不是你的」——通知識別碼可枚舉，那就成了一條確認「某人有幾則通知」的旁通道。
 * 故本檔把「他人的」與「不存在的」放在同一組斷言裡，兩者 MUST 回同一個狀態碼。
 *
 * 反方向的控制組同樣必要：**擁有者本人 MUST 成功**。
 * 沒有它時，一個對所有請求都回 401 的實作會讓上面每一則案例都變綠。
 */

const ANON_IP = '10.93.1.1';
const OWNER_IP = '10.93.2.1';
const OTHER_IP = '10.93.3.1';

interface Actor {
  id: string;
  cookie: string;
}

let owner: Actor;
let other: Actor;
/** owner 名下的兩則未讀通知 */
let ownedIds: string[];

async function makeActor(label: string, ip: string): Promise<Actor> {
  const account = await createAccount(label);
  return { id: account.id, cookie: await loginAs(account.email, account.password, ip) };
}

/** 目前資料庫中已被標記已讀的通知數（守衛失守的唯一可觀測後果） */
function readCount(): Promise<number> {
  return prisma.notification.count({ where: { readAt: { not: null } } });
}

async function errorCodeOf(res: Response): Promise<string | undefined> {
  const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
  return body?.error?.code;
}

beforeAll(async () => {
  await resetAuthTables();
  await prisma.notification.deleteMany();

  owner = await makeActor('notif-guard-owner', OWNER_IP);
  other = await makeActor('notif-guard-other', OTHER_IP);

  await prisma.notification.createMany({
    data: [
      { userId: owner.id, type: 'chapter_published', payload: '{}' },
      { userId: owner.id, type: 'chapter_published', payload: '{}' },
      { userId: other.id, type: 'chapter_published', payload: '{}' },
    ],
  });
  ownedIds = (
    await prisma.notification.findMany({ where: { userId: owner.id }, select: { id: true } })
  ).map((n) => n.id);
}, 120_000);

afterAll(async () => {
  await prisma.notification.deleteMany();
  await resetAuthTables();
});

describe('T117b-1：未登入者對兩個寫入入口皆回 401，且無任何 readAt 被寫入（FR-002）', () => {
  it('PATCH /api/notifications（全部已讀）回 401 UNAUTHENTICATED', async () => {
    const before = await readCount();

    const res = await testFetch('/api/notifications', {
      method: 'PATCH',
      ip: ANON_IP,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(401);
    expect(await errorCodeOf(res)).toBe('UNAUTHENTICATED');
    expect(await readCount()).toBe(before);
  });

  it('PATCH /api/notifications/{id}（單筆已讀）回 401 UNAUTHENTICATED', async () => {
    const before = await readCount();

    const res = await testFetch(`/api/notifications/${ownedIds[0]}`, {
      method: 'PATCH',
      ip: ANON_IP,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ read: true }),
    });

    expect(res.status).toBe(401);
    expect(await errorCodeOf(res)).toBe('UNAUTHENTICATED');
    expect(await readCount()).toBe(before);
  });

  it('被指名的那一則 readAt 仍為 null（逐列核對，非只看總數）', async () => {
    const row = await prisma.notification.findUniqueOrThrow({ where: { id: ownedIds[0] } });
    expect(row.readAt).toBeNull();
  });

  it('全部三則皆仍未讀（未登入請求 MUST NOT 對任何一列造成副作用）', async () => {
    expect(await readCount()).toBe(0);
  });
});

describe('T117b-2：他人的與不存在的通知回同一個 404（T132）', () => {
  const MISSING_ID = 'notification-that-does-not-exist';

  async function patchAs(actor: Actor, id: string, ip: string): Promise<Response> {
    return testFetch(`/api/notifications/${id}`, {
      method: 'PATCH',
      ip,
      cookie: actor.cookie,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ read: true }),
    });
  }

  it('以他人的通知識別碼請求回 404（MUST NOT 回 403）', async () => {
    const res = await patchAs(other, ownedIds[0], OTHER_IP);
    expect(res.status).toBe(404);
    expect(res.status).not.toBe(403);
  });

  it('不存在的識別碼同樣回 404 —— 兩者不以狀態碼區分', async () => {
    const res = await patchAs(other, MISSING_ID, OTHER_IP);
    expect(res.status).toBe(404);
  });

  it('兩種 404 的錯誤碼亦相同（訊息差異同樣是一條旁通道）', async () => {
    const others = await errorCodeOf(await patchAs(other, ownedIds[0], OTHER_IP));
    const missing = await errorCodeOf(await patchAs(other, MISSING_ID, OTHER_IP));
    expect(others).toBe(missing);
  });

  it('被指向的那一則 readAt 仍為 null（越權請求無寫入）', async () => {
    const row = await prisma.notification.findUniqueOrThrow({ where: { id: ownedIds[0] } });
    expect(row.readAt).toBeNull();
  });
});

describe('T117b-3：控制組 —— 擁有者本人可標記已讀', () => {
  it('單筆標記已讀成功，且只動到自己的那一則', async () => {
    const res = await testFetch(`/api/notifications/${ownedIds[0]}`, {
      method: 'PATCH',
      ip: OWNER_IP,
      cookie: owner.cookie,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ read: true }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, unreadCount: 1 });

    expect(
      (await prisma.notification.findUniqueOrThrow({ where: { id: ownedIds[0] } })).readAt
    ).not.toBeNull();
    expect(
      (await prisma.notification.findUniqueOrThrow({ where: { id: ownedIds[1] } })).readAt
    ).toBeNull();
  });

  it('全部標記已讀只影響自己名下的通知', async () => {
    const res = await testFetch('/api/notifications', {
      method: 'PATCH',
      ip: OWNER_IP,
      cookie: owner.cookie,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, unreadCount: 0 });

    expect(await prisma.notification.count({ where: { userId: owner.id, readAt: null } })).toBe(0);
    // 他人的通知 MUST 不受影響 —— 「全部」的範圍是自己名下，不是整張表
    expect(await prisma.notification.count({ where: { userId: other.id, readAt: null } })).toBe(1);
  });
});
