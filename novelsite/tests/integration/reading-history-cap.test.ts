import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { testFetch, loginAs } from '../helpers/client';
import { resetAuthTables } from '../helpers/resetAuthTables';
import { createAccount, createPublishedNovel } from '../helpers/fixtures';
import { deleteNovelOwned } from '@/lib/repositories';

/**
 * T013：閱讀歷史的上限淘汰與清除（FR-013）
 * ==========================================
 * `.env.test` 把 `READING_HISTORY_MAX` 設為 3（預設 500）—— 用預設值驗證這條規則
 * 需要 501 部作品，那不是一個會被執行的測試。
 *
 * 歷史沒有獨立寫入端點，一律經 `PUT /api/reading-progress` 觸發（見 contracts §3）。
 */

const HISTORY_MAX = 3;
const IP = '10.94.1.1';

let author: { id: string };
let reader: { id: string; email: string; password: string };
let cookie: string;
let novels: { novelId: string; chapterIds: string[] }[];

async function read(index: number, chapterIndex = 0): Promise<Response> {
  return testFetch('/api/reading-progress', {
    method: 'PUT',
    ip: IP,
    cookie,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      novelId: novels[index].novelId,
      chapterId: novels[index].chapterIds[chapterIndex],
      percent: 10,
    }),
  });
}

async function historyNovelIds(): Promise<string[]> {
  const rows = await prisma.readingHistory.findMany({
    where: { userId: reader.id },
    orderBy: { readAt: 'desc' },
  });
  return rows.map((r) => r.novelId);
}

beforeAll(async () => {
  await resetAuthTables();
  author = await createAccount('history-author', 'author');
  reader = await createAccount('history-reader');
  novels = [];
  for (let i = 0; i < HISTORY_MAX + 1; i++) {
    novels.push(await createPublishedNovel({ authorId: author.id, chapterCount: 2 }));
  }
  cookie = await loginAs(reader.email, reader.password, IP);
});

beforeEach(async () => {
  await prisma.readingHistory.deleteMany();
  await prisma.readingProgress.deleteMany();
});

afterAll(async () => {
  await prisma.readingHistory.deleteMany();
  await prisma.readingProgress.deleteMany();
  for (const n of novels) await deleteNovelOwned(author.id, n.novelId);
  await resetAuthTables();
});

describe('T013：上限淘汰', () => {
  it('達上限後閱讀新作品 → 淘汰 readAt 最舊者，總數維持上限', async () => {
    for (let i = 0; i < HISTORY_MAX; i++) await read(i);
    expect(await prisma.readingHistory.count({ where: { userId: reader.id } })).toBe(HISTORY_MAX);

    const oldest = novels[0].novelId;
    await read(HISTORY_MAX);

    const ids = await historyNovelIds();
    expect(ids).toHaveLength(HISTORY_MAX);
    expect(ids).not.toContain(oldest);
    expect(ids[0]).toBe(novels[HISTORY_MAX].novelId);
  });

  it('重讀已在歷史中的作品只更新該筆，不觸發淘汰', async () => {
    for (let i = 0; i < HISTORY_MAX; i++) await read(i);
    const before = await historyNovelIds();

    await read(0, 1); // 最舊的那一部，換一個章節重讀

    const after = await historyNovelIds();
    expect(after).toHaveLength(HISTORY_MAX);
    expect(new Set(after)).toEqual(new Set(before));
    expect(after[0], '重讀後應成為最新一筆').toBe(novels[0].novelId);

    const row = await prisma.readingHistory.findUniqueOrThrow({
      where: { userId_novelId: { userId: reader.id, novelId: novels[0].novelId } },
    });
    expect(row.chapterId).toBe(novels[0].chapterIds[1]);
  });
});

describe('T013：GET / DELETE /api/history', () => {
  it('列表每部作品一筆、依 readAt 由新到舊', async () => {
    for (let i = 0; i < HISTORY_MAX; i++) await read(i);

    const res = await testFetch('/api/history?limit=20', { method: 'GET', ip: IP, cookie });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      items: { novelId: string; chapterTitle: string }[];
      nextCursor: string | null;
    };
    expect(json.items.map((i) => i.novelId)).toEqual([
      novels[2].novelId,
      novels[1].novelId,
      novels[0].novelId,
    ]);
    expect(new Set(json.items.map((i) => i.novelId)).size).toBe(json.items.length);
    expect(json.nextCursor).toBeNull();
  });

  it('清除單一作品 → 只刪那一筆', async () => {
    for (let i = 0; i < HISTORY_MAX; i++) await read(i);

    const res = await testFetch(`/api/history?novelId=${novels[1].novelId}`, {
      method: 'DELETE',
      ip: IP,
      cookie,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 1 });

    const ids = await historyNovelIds();
    expect(ids).toHaveLength(HISTORY_MAX - 1);
    expect(ids).not.toContain(novels[1].novelId);
  });

  it('省略 novelId → 清空全部', async () => {
    for (let i = 0; i < HISTORY_MAX; i++) await read(i);

    const res = await testFetch('/api/history', { method: 'DELETE', ip: IP, cookie });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: HISTORY_MAX });
    expect(await historyNovelIds()).toEqual([]);
  });

  it('limit 越界（0 / 21）→ 400', async () => {
    for (const limit of [0, 21]) {
      const res = await testFetch(`/api/history?limit=${limit}`, { method: 'GET', ip: IP, cookie });
      expect(res.status, `limit=${limit}`).toBe(400);
    }
  });
});
