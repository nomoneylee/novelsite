import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { testFetch, loginAs } from '../helpers/client';
import { resetAuthTables } from '../helpers/resetAuthTables';
import { createAccount, createPublishedNovel } from '../helpers/fixtures';
import { deleteNovelOwned } from '@/lib/repositories';

/**
 * T010：閱讀進度上報（SC-005、US1 AC10、FR-013）
 * ================================================
 * 三條線：`percent` 越界時**既有進度不被破壞**、章節不屬於所報作品回 404、
 * 成功上報 MUST **同時**寫入 `ReadingHistory`（該表沒有獨立寫入端點，
 * 這裡是它唯一的落點，見 contracts/reader-state-api.md §3）。
 */

let author: { id: string };
let reader: { id: string; email: string; password: string };
let cookie: string;
let novelA: { novelId: string; chapterIds: string[] };
let novelB: { novelId: string; chapterIds: string[] };

const IP = '10.91.1.1';

async function putProgress(body: unknown, ip = IP): Promise<Response> {
  return testFetch('/api/reading-progress', {
    method: 'PUT',
    ip,
    cookie,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  await resetAuthTables();
  author = await createAccount('progress-author', 'author');
  reader = await createAccount('progress-reader');
  novelA = await createPublishedNovel({ authorId: author.id });
  novelB = await createPublishedNovel({ authorId: author.id });
  cookie = await loginAs(reader.email, reader.password, IP);
});

afterAll(async () => {
  await deleteNovelOwned(author.id, novelA.novelId);
  await deleteNovelOwned(author.id, novelB.novelId);
  await resetAuthTables();
});

describe('T010：PUT /api/reading-progress', () => {
  it('成功上報寫入進度，並於同一次請求內 upsert 閱讀歷史（FR-013）', async () => {
    const res = await putProgress({
      novelId: novelA.novelId,
      chapterId: novelA.chapterIds[1],
      percent: 37,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const progress = await prisma.readingProgress.findUnique({
      where: { userId_novelId: { userId: reader.id, novelId: novelA.novelId } },
    });
    expect(progress?.chapterId).toBe(novelA.chapterIds[1]);
    expect(progress?.percent).toBe(37);

    const history = await prisma.readingHistory.findUnique({
      where: { userId_novelId: { userId: reader.id, novelId: novelA.novelId } },
    });
    expect(history, 'ReadingHistory 沒有獨立寫入端點，此處是唯一落點').not.toBeNull();
    expect(history?.chapterId).toBe(novelA.chapterIds[1]);
  });

  it.each([150, -1, 3.5, '80', null])(
    'percent 為 %p → 400，且既有進度逐欄未被破壞（US1 AC10、SC-005）',
    async (percent) => {
      const before = await prisma.readingProgress.findUnique({
        where: { userId_novelId: { userId: reader.id, novelId: novelA.novelId } },
      });

      const res = await putProgress({
        novelId: novelA.novelId,
        chapterId: novelA.chapterIds[0],
        percent,
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe('VALIDATION_ERROR');

      const after = await prisma.readingProgress.findUnique({
        where: { userId_novelId: { userId: reader.id, novelId: novelA.novelId } },
      });
      expect(after?.chapterId).toBe(before?.chapterId);
      expect(after?.percent).toBe(before?.percent);
    }
  );

  it('chapterId 不屬於所報 novelId → 404，且不寫入任何一列', async () => {
    const beforeProgress = await prisma.readingProgress.count();
    const beforeHistory = await prisma.readingHistory.count();

    const res = await putProgress({
      novelId: novelB.novelId,
      chapterId: novelA.chapterIds[0],
      percent: 10,
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('NOT_FOUND');

    expect(await prisma.readingProgress.count()).toBe(beforeProgress);
    expect(await prisma.readingHistory.count()).toBe(beforeHistory);
  });

  it('章節完全不存在 → 404', async () => {
    const res = await putProgress({
      novelId: novelA.novelId,
      chapterId: 'no-such-chapter',
      percent: 10,
    });
    expect(res.status).toBe(404);
  });

  it('0 與 100 為合法邊界值', async () => {
    for (const percent of [0, 100]) {
      const res = await putProgress({
        novelId: novelA.novelId,
        chapterId: novelA.chapterIds[0],
        percent,
      });
      expect(res.status, `percent=${percent}`).toBe(200);
    }
  });

  it('GET /api/reading-progress?novelId= 回傳續讀點（含章節序號）', async () => {
    await putProgress({
      novelId: novelA.novelId,
      chapterId: novelA.chapterIds[2],
      percent: 55,
    });

    const res = await testFetch(`/api/reading-progress?novelId=${novelA.novelId}`, {
      method: 'GET',
      ip: IP,
      cookie,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      chapterId: novelA.chapterIds[2],
      chapterNumber: 3,
      percent: 55,
    });
  });

  it('尚無進度的作品回 null（而非 404）', async () => {
    const res = await testFetch(`/api/reading-progress?novelId=${novelB.novelId}`, {
      method: 'GET',
      ip: IP,
      cookie,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });
});
