import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { createChapterRow, saveChapterDraftRow } from '@/lib/repositories';
import { testFetch, loginAs } from '../helpers/client';
import { callAction, hasErrorCode } from '../helpers/serverAction';
import { resetAuthTables } from '../helpers/resetAuthTables';
import { createAccount, createPublishedNovel, cleanupNovels } from '../helpers/fixtures';

/**
 * T116：追更通知的收件人與則數（SC-011、FR-052a、FR-054）
 * =========================================================
 * 通知是唯一會主動打擾使用者的功能，「多發」與「少發」的代價不對稱：
 * 少發只是沒收到，多發會讓人關掉通知——之後連該收的也收不到了。
 * 故本檔的每一則案例都斷言**恰好的數字**，MUST NOT 用 `toBeGreaterThan`。
 *
 * 三個必須分開驗的數：
 *
 *  1. **N 位收藏者 → 恰好 N 則**（作者不計）。作者把自己的作品加進書架是常見行為。
 *  2. **同一次排程作業發佈 M 章 → 仍為 N 則**，而非 N×M。
 *     這是 FR-052a 的全部內容，也是「逐章通知」這個最自然的寫法的唯一防線。
 *  3. **發佈前取消收藏者 → 0 則**。收件人以**發佈當下**的書架為準，
 *     不是曾經收藏過的人。
 *
 * **並斷言 `type` 恆為 `chapter_published`**（FR-054）：本階段只做追更通知，
 * 其餘型別「保留資料欄位但 MUST NOT 產生資料」。沒有這條斷言時，
 * 一個順手把 `review_reply` 也接上去的改動不會弄紅任何測試 ——
 * 而那些型別的通知對象與去重規則從未被定義過。
 */

const CRON_IP = '10.91.1.1';
const AUTHOR_IP = '10.91.2.1';

/** 保留到最後的收藏者人數（SC-011 的 N） */
const FOLLOWER_COUNT = 3;

let author: { id: string; email: string; password: string };
let authorCookie: string;
let novelId: string;
let volumeId: string;
const followerIds: string[] = [];
let exFollowerId: string;
const created: { authorId: string; novelId: string }[] = [];

async function makeDraftChapter(label: string): Promise<string> {
  const { chapterId, number } = await createChapterRow(novelId, volumeId);
  const body = `${label} 第 ${number} 章的正文。`;
  await saveChapterDraftRow(chapterId, {
    title: `${label} 第 ${number} 章`,
    bodyMarkdown: body,
    wordCount: body.replace(/\s/g, '').length,
  });
  return chapterId;
}

async function runPublishCron(): Promise<{
  detail: { chaptersPublished: number; notificationsCreated: number };
}> {
  const res = await testFetch('/api/cron/publish-scheduled', {
    method: 'POST',
    ip: CRON_IP,
    headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
  });
  expect(res.status).toBe(200);
  return res.json();
}

async function countByUser(): Promise<Record<string, number>> {
  const rows = await prisma.notification.groupBy({ by: ['userId'], _count: { _all: true } });
  return Object.fromEntries(rows.map((r) => [r.userId, r._count._all]));
}

beforeAll(async () => {
  await resetAuthTables();
  await prisma.notification.deleteMany();

  author = await createAccount('notify-author', 'author');
  authorCookie = await loginAs(author.email, author.password, AUTHOR_IP);

  const novel = await createPublishedNovel({ authorId: author.id, chapterCount: 1 });
  novelId = novel.novelId;
  volumeId = novel.volumeId;
  created.push({ authorId: author.id, novelId });

  for (let i = 1; i <= FOLLOWER_COUNT; i++) {
    const reader = await createAccount(`notify-follower-${i}`);
    followerIds.push(reader.id);
    await prisma.bookshelf.create({ data: { userId: reader.id, novelId } });
  }

  // 作者本人也把作品加進書架：不排除的話，每次發佈都會通知自己「你的作品更新了」
  await prisma.bookshelf.create({ data: { userId: author.id, novelId } });

  // 曾收藏、在任何章節發佈之前就移出書架的讀者
  const exFollower = await createAccount('notify-ex-follower');
  exFollowerId = exFollower.id;
  await prisma.bookshelf.create({ data: { userId: exFollowerId, novelId } });
  await prisma.bookshelf.deleteMany({ where: { userId: exFollowerId, novelId } });
}, 120_000);

afterAll(async () => {
  await prisma.notification.deleteMany();
  await cleanupNovels(created);
  await resetAuthTables();
});

describe('T116-1：立即發佈一章 → 恰好 N 則（作者不計，SC-011）', () => {
  beforeAll(async () => {
    const chapterId = await makeDraftChapter('立即');
    const res = await callAction('publishChapterAction', [{ chapterId }], {
      ip: AUTHOR_IP,
      cookie: authorCookie,
      // 本 Action 只註冊在動態路由 `/author/editor/[chapterId]` 上（它的唯一引用者是
      // `ChapterEditor`），故 MUST 指定具體網址 —— 預設的「取第一個靜態路由」找不到目標
      route: `/author/editor/${chapterId}`,
    });
    expect(hasErrorCode(res, 'VALIDATION_ERROR')).toBe(false);
  }, 60_000);

  it('通知總數恰為收藏者人數', async () => {
    expect(await prisma.notification.count()).toBe(FOLLOWER_COUNT);
  });

  it('每位收藏者各得恰好一則', async () => {
    const byUser = await countByUser();
    for (const userId of followerIds) {
      expect(byUser[userId]).toBe(1);
    }
  });

  it('作者本人不在收件人之列（即使自己收藏了自己的作品）', async () => {
    expect(await prisma.notification.count({ where: { userId: author.id } })).toBe(0);
  });

  it('發佈前已取消收藏者不收到（收件人以發佈當下的書架為準）', async () => {
    expect(await prisma.notification.count({ where: { userId: exFollowerId } })).toBe(0);
  });
});

describe('T116-2：同一次排程作業發佈同作品 M 章 → 仍為 N 則（FR-052a）', () => {
  const M = 2;
  let before: number;
  let detail: { chaptersPublished: number; notificationsCreated: number };

  beforeAll(async () => {
    before = await prisma.notification.count();

    const past = new Date(Date.now() - 60_000);
    for (let i = 1; i <= M; i++) {
      const chapterId = await makeDraftChapter(`排程${i}`);
      await prisma.chapter.update({ where: { id: chapterId }, data: { scheduledAt: past } });
    }

    ({ detail } = await runPublishCron());
  }, 60_000);

  it('本次確實發佈了 M 章（否則「仍為 N 則」只是因為一章都沒發）', () => {
    expect(detail.chaptersPublished).toBe(M);
  });

  it('本次新增的通知數為 N，而非 N×M', () => {
    expect(detail.notificationsCreated).toBe(FOLLOWER_COUNT);
    expect(detail.notificationsCreated).not.toBe(FOLLOWER_COUNT * M);
  });

  it('資料庫中的增量同樣為 N（回報值與實際寫入相符）', async () => {
    expect((await prisma.notification.count()) - before).toBe(FOLLOWER_COUNT);
  });

  it('每位收藏者本輪各多一則（合併後的那一則，payload 的 chapterCount 為 M）', async () => {
    const byUser = await countByUser();
    for (const userId of followerIds) {
      expect(byUser[userId]).toBe(2); // 立即發佈 1 則 + 本次排程 1 則
    }

    const latest = await prisma.notification.findFirstOrThrow({
      where: { userId: followerIds[0] },
      orderBy: { createdAt: 'desc' },
    });
    expect(JSON.parse(latest.payload).chapterCount).toBe(M);
  });

  it('作者與已取消收藏者仍為 0 則', async () => {
    expect(await prisma.notification.count({ where: { userId: author.id } })).toBe(0);
    expect(await prisma.notification.count({ where: { userId: exFollowerId } })).toBe(0);
  });
});

describe('T116-3：本階段只產生 chapter_published 型別（FR-054）', () => {
  it('全部通知的 type 恰為 chapter_published 一種', async () => {
    const types = await prisma.notification.groupBy({ by: ['type'] });
    expect(types.map((t) => t.type)).toEqual(['chapter_published']);
  });

  it('確實有通知存在（空表時「只有一種型別」是空話）', async () => {
    expect(await prisma.notification.count()).toBeGreaterThan(0);
  });
});
