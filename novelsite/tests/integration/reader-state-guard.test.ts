import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { testFetch } from '../helpers/client';
import { resetAuthTables } from '../helpers/resetAuthTables';
import { createAccount, createPublishedNovel } from '../helpers/fixtures';
import { deleteNovelOwned } from '@/lib/repositories';

/**
 * T009：讀者狀態全部寫入端點的未登入防線（FR-002、SC-004）
 * ==========================================================
 * 「回 401」與「沒有寫入」是**兩件事**。只斷言狀態碼時，一個先寫入再回 401 的實作
 * 也會綠燈；故每一則案例都在請求前後比對五張表的總列數。
 */

let author: { id: string };
let novel: { novelId: string; chapterIds: string[] };

async function countAll(): Promise<Record<string, number>> {
  const [bookshelf, events, progress, history, preference] = await Promise.all([
    prisma.bookshelf.count(),
    prisma.bookshelfEvent.count(),
    prisma.readingProgress.count(),
    prisma.readingHistory.count(),
    prisma.readerPreference.count(),
  ]);
  return { bookshelf, events, progress, history, preference };
}

beforeAll(async () => {
  await resetAuthTables();
  author = await createAccount('guard-author', 'author');
  novel = await createPublishedNovel({ authorId: author.id });
});

afterAll(async () => {
  await deleteNovelOwned(author.id, novel.novelId);
  await resetAuthTables();
});

describe('T009：未登入對讀者狀態寫入端點一律 401 且無任何寫入', () => {
  it.each(['POST', 'DELETE'])('%s /api/bookshelf/{novelId} → 401 且無寫入', async (method) => {
    const before = await countAll();
    const res = await testFetch(`/api/bookshelf/${novel.novelId}`, {
      method,
      ip: '10.90.1.1',
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('UNAUTHENTICATED');
    expect(await countAll()).toEqual(before);
  });

  it('PUT /api/reading-progress → 401 且無寫入', async () => {
    const before = await countAll();
    const res = await testFetch('/api/reading-progress', {
      method: 'PUT',
      ip: '10.90.1.2',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        novelId: novel.novelId,
        chapterId: novel.chapterIds[0],
        percent: 42,
      }),
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('UNAUTHENTICATED');
    expect(await countAll()).toEqual(before);
  });

  it('DELETE /api/history → 401 且無寫入', async () => {
    const before = await countAll();
    const res = await testFetch('/api/history', { method: 'DELETE', ip: '10.90.1.3' });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('UNAUTHENTICATED');
    expect(await countAll()).toEqual(before);
  });

  it('PUT /api/reader-preference → 401 且無寫入', async () => {
    const before = await countAll();
    const res = await testFetch('/api/reader-preference', {
      method: 'PUT',
      ip: '10.90.1.4',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fontSize: 'lg', theme: 'dark' }),
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('UNAUTHENTICATED');
    expect(await countAll()).toEqual(before);
  });

  it('POST /api/reader-state/merge → 401 且無寫入', async () => {
    const before = await countAll();
    const res = await testFetch('/api/reader-state/merge', {
      method: 'POST',
      ip: '10.90.1.5',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookshelf: [novel.novelId], history: [] }),
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('UNAUTHENTICATED');
    expect(await countAll()).toEqual(before);
  });

  it('讀取端點（GET）未登入同樣回 401 —— 讀者狀態全部需登入', async () => {
    for (const path of ['/api/bookshelf', '/api/history', '/api/reading-progress?novelId=x']) {
      const res = await testFetch(path, { method: 'GET', ip: '10.90.1.6' });
      expect(res.status, path).toBe(401);
      expect((await res.json()).error.code, path).toBe('UNAUTHENTICATED');
    }
  });
});
