import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { testFetch, loginAs } from '../helpers/client';
import { resetAuthTables } from '../helpers/resetAuthTables';
import { createAccount, createPublishedNovel } from '../helpers/fixtures';
import { deleteNovelOwned } from '@/lib/repositories';

/**
 * T012：書架的計數、事件與游標分頁（FR-009、FR-038a、SC-019 前半）
 * ==================================================================
 * 「加入書架」是三件事的原子組合：關聯列、`Novel.favoriteCount`、`BookshelfEvent`。
 * 少了第二件使用者的動作不會立即可見，少了第三件每日彙總的「淨增」無從計算。
 */

let author: { id: string };
let reader: { id: string; email: string; password: string };
let cookie: string;
let novels: { novelId: string; chapterIds: string[] }[];

const IP = '10.93.1.1';

async function shelf(novelId: string, method: 'POST' | 'DELETE'): Promise<Response> {
  return testFetch(`/api/bookshelf/${novelId}`, { method, ip: IP, cookie });
}

async function favoriteCountOf(novelId: string): Promise<number> {
  const row = await prisma.novel.findUnique({
    where: { id: novelId },
    select: { favoriteCount: true },
  });
  return row?.favoriteCount ?? -1;
}

beforeAll(async () => {
  await resetAuthTables();
  author = await createAccount('shelf-author', 'author');
  reader = await createAccount('shelf-reader');
  novels = [];
  for (let i = 0; i < 5; i++) {
    novels.push(await createPublishedNovel({ authorId: author.id, chapterCount: 1 }));
  }
  cookie = await loginAs(reader.email, reader.password, IP);
});

beforeEach(async () => {
  await prisma.bookshelfEvent.deleteMany();
  await prisma.bookshelf.deleteMany();
  await prisma.novel.updateMany({
    where: { id: { in: novels.map((n) => n.novelId) } },
    data: { favoriteCount: 0 },
  });
});

afterAll(async () => {
  await prisma.bookshelfEvent.deleteMany();
  await prisma.bookshelf.deleteMany();
  for (const n of novels) await deleteNovelOwned(author.id, n.novelId);
  await resetAuthTables();
});

describe('T012：加入／移出書架的原子三件事', () => {
  it('加入 → 關聯列、favoriteCount +1、BookshelfEvent(+1) 三者齊備，且回應即帶新計數', async () => {
    const target = novels[0].novelId;
    const res = await shelf(target, 'POST');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, favoriteCount: 1 });

    expect(await prisma.bookshelf.count({ where: { userId: reader.id, novelId: target } })).toBe(1);
    expect(await favoriteCountOf(target)).toBe(1);

    const events = await prisma.bookshelfEvent.findMany({ where: { novelId: target } });
    expect(events).toHaveLength(1);
    expect(events[0].delta).toBe(1);
  });

  it('移出 → 關聯列刪除、favoriteCount −1、BookshelfEvent(−1)', async () => {
    const target = novels[0].novelId;
    await shelf(target, 'POST');

    const res = await shelf(target, 'DELETE');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, favoriteCount: 0 });

    expect(await prisma.bookshelf.count({ where: { novelId: target } })).toBe(0);
    expect(await favoriteCountOf(target)).toBe(0);

    const deltas = (await prisma.bookshelfEvent.findMany({ where: { novelId: target } })).map(
      (e) => e.delta
    );
    expect(deltas.sort()).toEqual([-1, 1]);
  });

  it('重複加入 → 409，且計數與事件皆不重複累加', async () => {
    const target = novels[0].novelId;
    await shelf(target, 'POST');

    const res = await shelf(target, 'POST');
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('CONFLICT');

    expect(await favoriteCountOf(target)).toBe(1);
    expect(await prisma.bookshelfEvent.count({ where: { novelId: target } })).toBe(1);
  });

  it('移出不在書架的作品 → 404，且不寫入負向事件', async () => {
    const target = novels[1].novelId;
    const res = await shelf(target, 'DELETE');
    expect(res.status).toBe(404);
    expect(await prisma.bookshelfEvent.count({ where: { novelId: target } })).toBe(0);
    expect(await favoriteCountOf(target)).toBe(0);
  });

  it('加入不存在的作品 → 404', async () => {
    const res = await shelf('no-such-novel', 'POST');
    expect(res.status).toBe(404);
  });
});

describe('T012：書架列表的游標分頁逐頁無重複無遺漏（SC-019 前半）', () => {
  it('以 limit=2 翻完五本，聯集恰為五本且無重複', async () => {
    for (const n of novels) {
      const res = await shelf(n.novelId, 'POST');
      expect(res.status).toBe(200);
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    let guard = 0;

    do {
      const path = `/api/bookshelf?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const res: Response = await testFetch(path, { method: 'GET', ip: IP, cookie });
      expect(res.status).toBe(200);
      const json = (await res.json()) as { items: { id: string }[]; nextCursor: string | null };
      expect(json.items.length).toBeLessThanOrEqual(2);
      seen.push(...json.items.map((i) => i.id));
      cursor = json.nextCursor;
      guard += 1;
    } while (cursor && guard < 10);

    expect(cursor).toBeNull();
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.sort()).toEqual(novels.map((n) => n.novelId).sort());
  });

  it('無效游標 → 400（而非 500 或靜默回空頁）', async () => {
    const res = await testFetch('/api/bookshelf?cursor=!!!not-base64!!!', {
      method: 'GET',
      ip: IP,
      cookie,
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
  });
});
