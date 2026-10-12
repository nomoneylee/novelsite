import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { testFetch, loginAs } from '../helpers/client';
import { resetAuthTables } from '../helpers/resetAuthTables';
import { createAccount, createPublishedNovel } from '../helpers/fixtures';
import { deleteNovelOwned } from '@/lib/repositories';

/**
 * T011：本機資料合併（SC-002、FR-015／FR-015a／FR-015b、FR-016）
 * ================================================================
 * 除了合併規則本身，本檔另斷言**合併新增的收藏走與 `bookshelfService.add` 相同的三件事**
 * （關聯列 + `favoriteCount` + `BookshelfEvent`）。少了這一則，`skipDuplicates` 會被實作成
 * 「只寫關聯列」，而「訪客累積 → 登入」正是收藏最常見的入庫途徑，
 * 那一天的淨增會系統性少計且**永久遺失**（`BookshelfEvent` 沒有校正機制）。
 */

let author: { id: string };
let reader: { id: string; email: string; password: string };
let cookie: string;
let novelA: { novelId: string; chapterIds: string[] };
let novelB: { novelId: string; chapterIds: string[] };
let novelC: { novelId: string; chapterIds: string[] };

const IP = '10.92.1.1';

interface MergePayload {
  bookshelf?: string[];
  history?: { novelId: string; chapterId: string; readAt: string }[];
  preference?: { fontSize?: string; theme?: string };
  truncated?: { bookshelf?: boolean; history?: boolean };
}

async function merge(payload: MergePayload): Promise<Response> {
  return testFetch('/api/reader-state/merge', {
    method: 'POST',
    ip: IP,
    cookie,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookshelf: [], history: [], ...payload }),
  });
}

async function favoriteCountOf(novelId: string): Promise<number> {
  const row = await prisma.novel.findUnique({
    where: { id: novelId },
    select: { favoriteCount: true },
  });
  return row?.favoriteCount ?? -1;
}

/** 每則案例都從「讀者端全空、作品計數歸零」重新起算 */
async function clearReaderState(): Promise<void> {
  await prisma.bookshelfEvent.deleteMany();
  await prisma.bookshelf.deleteMany();
  await prisma.readingHistory.deleteMany();
  await prisma.readingProgress.deleteMany();
  await prisma.readerPreference.deleteMany();
  await prisma.novel.updateMany({
    where: { id: { in: [novelA.novelId, novelB.novelId, novelC.novelId] } },
    data: { favoriteCount: 0 },
  });
}

beforeAll(async () => {
  await resetAuthTables();
  author = await createAccount('merge-author', 'author');
  reader = await createAccount('merge-reader');
  novelA = await createPublishedNovel({ authorId: author.id });
  novelB = await createPublishedNovel({ authorId: author.id });
  novelC = await createPublishedNovel({ authorId: author.id });
  cookie = await loginAs(reader.email, reader.password, IP);
});

beforeEach(clearReaderState);

afterAll(async () => {
  await clearReaderState();
  for (const n of [novelA, novelB, novelC]) {
    await deleteNovelOwned(author.id, n.novelId);
  }
  await resetAuthTables();
});

describe('T011：POST /api/reader-state/merge', () => {
  it('書架取聯集，雙方皆有者保留雲端 createdAt（本機無時間戳，無從比較新舊）', async () => {
    // 雲端已有 A（時間刻意設為過去）
    await prisma.bookshelf.create({
      data: {
        userId: reader.id,
        novelId: novelA.novelId,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    const cloudCreatedAt = (
      await prisma.bookshelf.findUniqueOrThrow({
        where: { userId_novelId: { userId: reader.id, novelId: novelA.novelId } },
      })
    ).createdAt;

    const res = await merge({ bookshelf: [novelA.novelId, novelB.novelId] });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.merged.bookshelf).toBe(1);
    expect(json.skipped.bookshelf).toBe(1);

    const rows = await prisma.bookshelf.findMany({ where: { userId: reader.id } });
    expect(rows.map((r) => r.novelId).sort()).toEqual([novelA.novelId, novelB.novelId].sort());

    const a = rows.find((r) => r.novelId === novelA.novelId)!;
    expect(a.createdAt.toISOString()).toBe(cloudCreatedAt.toISOString());
  });

  it('合併「新增」的每一筆收藏皆 favoriteCount +1 並產生 BookshelfEvent(delta=+1)；被 skip 者兩者皆不變', async () => {
    await prisma.bookshelf.create({ data: { userId: reader.id, novelId: novelA.novelId } });

    const res = await merge({ bookshelf: [novelA.novelId, novelB.novelId, novelC.novelId] });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.merged.bookshelf).toBe(2);
    expect(json.skipped.bookshelf).toBe(1);

    // 被 skip 的 A：計數與事件皆不動
    expect(await favoriteCountOf(novelA.novelId)).toBe(0);
    expect(await prisma.bookshelfEvent.count({ where: { novelId: novelA.novelId } })).toBe(0);

    // 實際新增的 B、C：計數 +1 且各有一筆 +1 事件
    for (const n of [novelB, novelC]) {
      expect(await favoriteCountOf(n.novelId), n.novelId).toBe(1);
      const events = await prisma.bookshelfEvent.findMany({ where: { novelId: n.novelId } });
      expect(events).toHaveLength(1);
      expect(events[0].delta).toBe(1);
      expect(events[0].userId).toBe(reader.id);
    }
  });

  it('閱讀歷史取 readAt 較新者為準', async () => {
    await prisma.readingHistory.create({
      data: {
        userId: reader.id,
        novelId: novelA.novelId,
        chapterId: novelA.chapterIds[0],
        readAt: new Date('2026-05-01T00:00:00.000Z'),
      },
    });
    await prisma.readingHistory.create({
      data: {
        userId: reader.id,
        novelId: novelB.novelId,
        chapterId: novelB.chapterIds[2],
        readAt: new Date('2026-08-01T00:00:00.000Z'),
      },
    });

    const res = await merge({
      history: [
        // 較新 → 覆寫
        {
          novelId: novelA.novelId,
          chapterId: novelA.chapterIds[2],
          readAt: '2026-06-01T00:00:00.000Z',
        },
        // 較舊 → 略過
        {
          novelId: novelB.novelId,
          chapterId: novelB.chapterIds[0],
          readAt: '2026-07-01T00:00:00.000Z',
        },
      ],
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.merged.history).toBe(1);
    expect(json.skipped.history).toBe(1);

    const a = await prisma.readingHistory.findUniqueOrThrow({
      where: { userId_novelId: { userId: reader.id, novelId: novelA.novelId } },
    });
    expect(a.chapterId).toBe(novelA.chapterIds[2]);
    expect(a.readAt.toISOString()).toBe('2026-06-01T00:00:00.000Z');

    const b = await prisma.readingHistory.findUniqueOrThrow({
      where: { userId_novelId: { userId: reader.id, novelId: novelB.novelId } },
    });
    expect(b.chapterId).toBe(novelB.chapterIds[2]);
  });

  it('偏好僅在伺服器尚無紀錄時建立；已有則不覆寫（FR-015a）', async () => {
    const first = await merge({ preference: { fontSize: 'lg', theme: 'dark' } });
    expect((await first.json()).merged.preference).toBe(1);

    const created = await prisma.readerPreference.findUniqueOrThrow({
      where: { userId: reader.id },
    });
    expect(created.fontSize).toBe('lg');
    expect(created.theme).toBe('dark');

    const second = await merge({ preference: { fontSize: 'sm', theme: 'eyecare' } });
    expect((await second.json()).merged.preference).toBe(0);

    const after = await prisma.readerPreference.findUniqueOrThrow({
      where: { userId: reader.id },
    });
    expect(after.fontSize).toBe('lg');
    expect(after.theme).toBe('dark');
  });

  it('指向不存在作品的項目計入 skipped 而非整批失敗（FR-016）', async () => {
    const res = await merge({
      bookshelf: ['no-such-novel', novelA.novelId],
      history: [
        { novelId: 'no-such-novel', chapterId: 'x', readAt: '2026-08-01T00:00:00.000Z' },
        {
          novelId: novelA.novelId,
          chapterId: novelA.chapterIds[0],
          readAt: '2026-08-01T00:00:00.000Z',
        },
      ],
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.merged).toMatchObject({ bookshelf: 1, history: 1 });
    expect(json.skipped).toMatchObject({ bookshelf: 1, history: 1 });
  });

  it('重複執行結果不變（冪等，FR-015b）', async () => {
    const payload: MergePayload = {
      bookshelf: [novelA.novelId, novelB.novelId],
      history: [
        {
          novelId: novelA.novelId,
          chapterId: novelA.chapterIds[1],
          readAt: '2026-08-01T00:00:00.000Z',
        },
      ],
      preference: { fontSize: 'md', theme: 'light' },
    };

    const first = await (await merge(payload)).json();
    expect(first.merged).toEqual({ bookshelf: 2, history: 1, preference: 1 });

    const snapshot = {
      bookshelf: await prisma.bookshelf.count({ where: { userId: reader.id } }),
      events: await prisma.bookshelfEvent.count(),
      history: await prisma.readingHistory.count({ where: { userId: reader.id } }),
      favoriteA: await favoriteCountOf(novelA.novelId),
    };

    const second = await (await merge(payload)).json();
    expect(second.merged).toEqual({ bookshelf: 0, history: 0, preference: 0 });
    expect(second.skipped).toMatchObject({ bookshelf: 2, history: 1 });

    expect({
      bookshelf: await prisma.bookshelf.count({ where: { userId: reader.id } }),
      events: await prisma.bookshelfEvent.count(),
      history: await prisma.readingHistory.count({ where: { userId: reader.id } }),
      favoriteA: await favoriteCountOf(novelA.novelId),
    }).toEqual(snapshot);
  });

  it('任一陣列超過 MERGE_BATCH_MAX → 400，且無任何寫入', async () => {
    const before = await prisma.bookshelf.count();
    const res = await merge({ bookshelf: Array.from({ length: 201 }, (_, i) => `n-${i}`) });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
    expect(await prisma.bookshelf.count()).toBe(before);
  });

  it('客戶端標示的截斷旗標原樣回傳（FR-016a：前端據此告知使用者）', async () => {
    const res = await merge({
      bookshelf: [novelA.novelId],
      truncated: { bookshelf: true },
    });
    const json = await res.json();
    expect(json.truncated).toEqual({ bookshelf: true, history: false });
  });
});
