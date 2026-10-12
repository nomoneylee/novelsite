import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { testFetch, loginAs } from '../helpers/client';
import { resetAuthTables } from '../helpers/resetAuthTables';
import { createAccount, createPublishedNovel } from '../helpers/fixtures';
import { deleteNovelOwned } from '@/lib/repositories';

/**
 * T086：閱讀上報的去重窗口與作者排除（FR-033a、FR-035、SC-007）
 * ==============================================================
 * 曝光數是排行分數的第一項，也是作者唯一看得到的「有沒有人在看」。
 * 兩件事決定它是不是真的：
 *
 *  1. **去重**：一次閱讀就是一次。讀者中途重新整理、切分頁再回來、
 *     行動網路換 IP 前後各載入一次 —— 這些都是同一次閱讀，計成三次就等於曝光可以自己刷。
 *  2. **作者排除**：作者不是自己作品的讀者。少了這條，寫作當下反覆預覽就會把自己送上排行榜。
 *
 * 去重的鍵是 `(viewerHash, chapterId)`，故本檔一併釘住鍵的兩個維度：
 * **換一章要另計**（否則整部作品每 30 分鐘只算得到一次閱讀），
 * 而**登入者換位址不另計**（登入者的雜湊只取 userId，見 tests/unit/viewerHash.test.ts）。
 *
 * **時間以回撥資料列模擬**，MUST NOT 真的等 30 分鐘 —— 一個要跑半小時的測試等於沒有測試。
 */

const WINDOW_MIN = env.VIEW_DEDUPE_WINDOW_MINUTES;

let author: { id: string; email: string; password: string };
let reader: { id: string; email: string; password: string };
let readerCookie: string;
let authorCookie: string;
let novelId: string;
let chapterIds: string[];

function reportView(
  chapterId: string,
  opts: { ip: string; cookie?: string; userAgent?: string }
): Promise<Response> {
  return testFetch(`/api/chapters/${chapterId}/view`, {
    method: 'POST',
    ip: opts.ip,
    cookie: opts.cookie,
    headers: { 'User-Agent': opts.userAgent ?? 'FEAT4-Dedupe-UA/1.0' },
  });
}

function viewCount(chapterId?: string): Promise<number> {
  return prisma.chapterView.count({
    where: chapterId ? { chapterId } : { novelId },
  });
}

/** 把某章節的既有明細往前回撥 N 分鐘，用來把「現在」推出（或留在）去重窗口 */
async function backdateViews(chapterId: string, minutes: number): Promise<void> {
  await prisma.chapterView.updateMany({
    where: { chapterId },
    data: { viewedAt: new Date(Date.now() - minutes * 60_000) },
  });
}

beforeAll(async () => {
  await resetAuthTables();
  author = await createAccount('dedupe-author', 'author');
  reader = await createAccount('dedupe-reader');
  const novel = await createPublishedNovel({ authorId: author.id, chapterCount: 3 });
  novelId = novel.novelId;
  chapterIds = novel.chapterIds;
  readerCookie = await loginAs(reader.email, reader.password, '10.86.9.1');
  authorCookie = await loginAs(author.email, author.password, '10.86.9.2');
});

beforeEach(async () => {
  await prisma.chapterView.deleteMany({ where: { novelId } });
});

afterAll(async () => {
  await prisma.chapterView.deleteMany({ where: { novelId } });
  await deleteNovelOwned(author.id, novelId);
  await resetAuthTables();
});

describe('T086-1：去重窗口內重複上報只計 1 次（FR-035）', () => {
  it('匿名讀者連續三次上報同一章節 → 明細恰 1 列，且三次回應皆為成功', async () => {
    const ip = '10.86.1.1';
    for (let i = 0; i < 3; i++) {
      const res = await reportView(chapterIds[0], { ip });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    }
    expect(await viewCount(chapterIds[0])).toBe(1);
  });

  it('登入讀者連續三次上報同一章節 → 明細恰 1 列，且該列帶得回 userId', async () => {
    const ip = '10.86.1.2';
    for (let i = 0; i < 3; i++) {
      expect((await reportView(chapterIds[0], { ip, cookie: readerCookie })).status).toBe(200);
    }
    const rows = await prisma.chapterView.findMany({ where: { chapterId: chapterIds[0] } });
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(reader.id);
    expect(rows[0].novelId).toBe(novelId);
    expect(rows[0].viewerHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('窗口尚未過完（回撥至窗口內）再上報 → 仍為 1 列', async () => {
    const ip = '10.86.1.3';
    await reportView(chapterIds[0], { ip });
    // 回撥到「窗口 −1 分鐘」：仍在窗口內
    await backdateViews(chapterIds[0], Math.max(1, WINDOW_MIN - 1));

    await reportView(chapterIds[0], { ip });
    expect(await viewCount(chapterIds[0])).toBe(1);
  });
});

describe('T086-2：跨窗口後再增（SC-007 後半）', () => {
  it('既有明細回撥至窗口之外再上報 → 明細增為 2 列', async () => {
    const ip = '10.86.2.1';
    await reportView(chapterIds[0], { ip });
    expect(await viewCount(chapterIds[0])).toBe(1);

    await backdateViews(chapterIds[0], WINDOW_MIN + 1);

    await reportView(chapterIds[0], { ip });
    expect(await viewCount(chapterIds[0])).toBe(2);
  });
});

describe('T086-3：去重鍵的兩個維度', () => {
  it('同一讀者換一個章節 → 另計一列（鍵含 chapterId，非只看讀者）', async () => {
    const ip = '10.86.3.1';
    await reportView(chapterIds[0], { ip });
    await reportView(chapterIds[1], { ip });
    await reportView(chapterIds[1], { ip }); // 第二章的重複仍被擋

    expect(await viewCount(chapterIds[0])).toBe(1);
    expect(await viewCount(chapterIds[1])).toBe(1);
    expect(await viewCount()).toBe(2);
  });

  it('同一登入讀者換位址與瀏覽器識別字串 → 仍只 1 列（登入者的雜湊只取 userId）', async () => {
    await reportView(chapterIds[2], {
      ip: '10.86.3.2',
      cookie: readerCookie,
      userAgent: 'FirstBrowser/1.0',
    });
    await reportView(chapterIds[2], {
      ip: '198.51.100.77',
      cookie: readerCookie,
      userAgent: 'SecondBrowser/9.9',
    });

    expect(await viewCount(chapterIds[2])).toBe(1);
  });

  it('兩位不同的匿名讀者（不同位址）→ 各計一列', async () => {
    await reportView(chapterIds[2], { ip: '10.86.3.3' });
    await reportView(chapterIds[2], { ip: '10.86.3.4' });

    expect(await viewCount(chapterIds[2])).toBe(2);
  });
});

describe('T086-4：作品擁有者本人的閱讀恆不計入（FR-033a、SC-007）', () => {
  it('作者反覆重整自己的章節五次 → 明細恆為 0 列，且每次回應與一般讀者無異', async () => {
    const ip = '10.86.4.1';
    for (let i = 0; i < 5; i++) {
      const res = await reportView(chapterIds[0], { ip, cookie: authorCookie });
      // 靜默：作者看到的回應與被記錄時完全相同，無從得知自己被排除
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    }
    expect(await viewCount()).toBe(0);
  });

  it('作者跨章節反覆閱讀整部作品 → 全作品明細仍為 0 列', async () => {
    const ip = '10.86.4.2';
    for (const chapterId of chapterIds) {
      await reportView(chapterId, { ip, cookie: authorCookie });
      await reportView(chapterId, { ip, cookie: authorCookie });
    }
    expect(await viewCount()).toBe(0);
  });

  it('作者被排除的是「自己的作品」而非「作者這個角色」：讀他人作品仍計入', async () => {
    const other = await createAccount('dedupe-other-author', 'author');
    const otherNovel = await createPublishedNovel({ authorId: other.id, chapterCount: 1 });
    try {
      await reportView(otherNovel.chapterIds[0], { ip: '10.86.4.3', cookie: authorCookie });
      expect(await prisma.chapterView.count({ where: { novelId: otherNovel.novelId } })).toBe(1);
    } finally {
      await prisma.chapterView.deleteMany({ where: { novelId: otherNovel.novelId } });
      await deleteNovelOwned(other.id, otherNovel.novelId);
    }
  });
});
