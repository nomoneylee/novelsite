import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { testFetch } from '../helpers/client';
import { setNovelStatus } from '@/lib/services/novelService';
import { setChapterStatus, deleteChapter, saveChapterDraft } from '@/lib/services/chapterService';
import {
  createAuthor,
  createNovelWithChapter,
  addChapter,
  cleanupAuthoring,
  type TestAuthor,
  type TestNovel,
} from '../helpers/authoring';

/**
 * US1 AC8（下架的可見性）與 FR-011（反正規化計數只計已發佈章節）。
 *
 * 計數這一組刻意涵蓋**下架**與**刪除**兩條路徑：把「發佈時 +1」寫對很容易，
 * 難的是反過來那一邊 —— 少寫的那一半會以「作品頁寫著 12 章、目錄只有 11 章」
 * 這種沒人會回報但每個讀者都看得到的形式留在正式環境。
 */

const IP = '10.64.1.1';

let author: TestAuthor;
let novel: TestNovel;
let chapter2: string;

async function counters(): Promise<{ wordCount: number; chapterCount: number }> {
  const row = await prisma.novel.findUniqueOrThrow({
    where: { id: novel.novelId },
    select: { wordCount: true, chapterCount: true },
  });
  return row;
}

/** 直接由章節列算出應有的計數（只計已發佈），作為期望值的獨立來源 */
async function expectedCounters(): Promise<{ wordCount: number; chapterCount: number }> {
  const rows = await prisma.chapter.findMany({
    where: { novelId: novel.novelId, status: 'published' },
    select: { wordCount: true },
  });
  return {
    wordCount: rows.reduce((sum, r) => sum + r.wordCount, 0),
    chapterCount: rows.length,
  };
}

beforeAll(async () => {
  await cleanupAuthoring();
  author = await createAuthor('counters');
  novel = await createNovelWithChapter({
    authorId: author.id,
    novelStatus: 'published',
    chapterStatus: 'published',
  });
  chapter2 = await addChapter({
    novelId: novel.novelId,
    volumeId: novel.volumeId,
    number: 2,
    status: 'published',
  });
  // 讓計數自實際章節重算一次，取得乾淨的起點
  await setChapterStatus(author.id, { chapterId: chapter2, status: 'published' });
});

afterAll(async () => {
  await cleanupAuthoring();
});

describe('作品下架後的可見性（US1 AC8）', () => {
  it('前置：已發佈作品的詳情頁與章節頁皆可讀，且出現在書庫列表', async () => {
    const detail = await testFetch(`/novels/${novel.novelId}`, { method: 'GET', ip: IP });
    expect(detail.status).toBe(200);

    const reader = await testFetch(`/reader/${novel.novelId}/${novel.chapterId}`, {
      method: 'GET',
      ip: IP,
    });
    expect(reader.status).toBe(200);

    const list = await testFetch('/novels', { method: 'GET', ip: IP });
    expect(await list.text()).toContain(novel.novelId);
  });

  it('下架後：詳情頁與章節閱讀頁對訪客皆 404（不是 403）', async () => {
    await setNovelStatus(author.id, { novelId: novel.novelId, status: 'draft' });

    const detail = await testFetch(`/novels/${novel.novelId}`, { method: 'GET', ip: IP });
    expect(detail.status).toBe(404);

    const reader = await testFetch(`/reader/${novel.novelId}/${novel.chapterId}`, {
      method: 'GET',
      ip: IP,
    });
    expect(reader.status).toBe(404);
  });

  it('下架後：書庫列表不再包含該作品（FR-037 的讀取端條件）', async () => {
    const list = await testFetch('/novels', { method: 'GET', ip: IP });
    expect(await list.text()).not.toContain(novel.novelId);
  });

  /**
   * 網站地圖的資料來源同樣是 `getAllNovels()`，故本階段的 `status` 條件一併生效。
   * **誠實標示**：`sitemap.ts` 目前是預設被快取的 Route Handler，
   * 「作者下架後網站地圖即時更新」還需要 T054 補上 dynamic config；
   * 本則只驗**內容條件**成立，不主張即時性。
   */
  it('下架後：網站地圖不含該作品（內容條件；即時性待 T054）', async () => {
    const res = await testFetch('/sitemap.xml', { method: 'GET', ip: IP });
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain(`/novels/${novel.novelId}`);
  });

  it('重新上架後恢復可讀', async () => {
    await setNovelStatus(author.id, { novelId: novel.novelId, status: 'published' });
    const detail = await testFetch(`/novels/${novel.novelId}`, { method: 'GET', ip: IP });
    expect(detail.status).toBe(200);
  });
});

describe('章節下架與刪除後的計數回填（FR-011）', () => {
  it('起點：計數等於已發佈章節的實際加總', async () => {
    expect(await counters()).toEqual(await expectedCounters());
  });

  it('儲存正文後 wordCount 依新正文重算', async () => {
    await saveChapterDraft(author.id, {
      chapterId: chapter2,
      title: '第 2 章',
      bodyMarkdown: '一二三四五六七八九十一二三四五',
    });
    expect(await counters()).toEqual(await expectedCounters());
  });

  it('章節下架後：計數同步扣除（只計已發佈）', async () => {
    await setChapterStatus(author.id, { chapterId: chapter2, status: 'draft' });

    const after = await counters();
    expect(after).toEqual(await expectedCounters());
    expect(after.chapterCount).toBe(1);
  });

  it('章節刪除後：計數同步扣除', async () => {
    await setChapterStatus(author.id, { chapterId: chapter2, status: 'published' });
    expect((await counters()).chapterCount).toBe(2);

    await deleteChapter(author.id, { chapterId: chapter2 });

    const after = await counters();
    expect(after).toEqual(await expectedCounters());
    expect(after.chapterCount).toBe(1);
    expect(await prisma.chapter.count({ where: { id: chapter2 } })).toBe(0);
  });

  it('草稿章節從不計入（建立草稿不改變計數）', async () => {
    const before = await counters();
    await addChapter({ novelId: novel.novelId, volumeId: novel.volumeId, number: 5 });
    await setChapterStatus(author.id, { chapterId: novel.chapterId, status: 'published' });
    expect((await counters()).chapterCount).toBe(before.chapterCount);
  });
});
