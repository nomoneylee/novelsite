import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { createChapterRow, saveChapterDraftRow } from '@/lib/repositories';
import { testFetch, loginAs } from '../helpers/client';
import { callAction, hasErrorCode } from '../helpers/serverAction';
import { resetAuthTables } from '../helpers/resetAuthTables';
import { createAccount, createPublishedNovel, cleanupNovels } from '../helpers/fixtures';

/**
 * T115：排程發佈的到期、冪等與無效排程（SC-010、FR-049、FR-051）
 * ================================================================
 * 排程發佈是本階段唯一「沒有人在現場」的寫入路徑：作者按下排程之後就離開了，
 * 出錯時沒有人會看到錯誤訊息。三種失敗方式因而各自需要一條斷言：
 *
 *  1. **該發的沒發**（到期章節仍是草稿、或發了但計數沒回填）——
 *     讀者看到的是「作者停更了」，而作者看到的是「已排程」。
 *  2. **重複發**（排程器重試、機器重開後補跑）—— 章節不會發第二次，
 *     但**通知會**：`publishedAt` 被覆寫成新時間、收藏者再收到一次同一章的追更。
 *     故冪等 MUST 同時斷言「章節未再變動」與「通知未再產生」，只驗前者會漏掉後者。
 *  3. **不該發的發了**（未到期的排程章節被一併掃出）—— 提前曝光是不可回收的。
 *
 * **已被手動發佈或刪除者略過不報錯**（Edge Case）：掃描條件是
 * `status='draft' AND scheduledAt <= now`，兩者自然不入選；本檔仍明確驗一次 ——
 * 「不入選」與「入選後擲錯」在實作上只差一個判斷，而後者會讓**整批**排程停擺。
 *
 * **過去時間回 400 且不建立無效排程**（FR-049）：無效排程若被寫進去，
 * 下一次掃描就會立刻發佈它 —— 那與「立即發佈」的結果相同，作者卻以為自己排了程。
 */

const CRON_IP = '10.90.1.1';
const AUTHOR_IP = '10.90.2.1';

interface CronBody {
  ok: boolean;
  processed: number;
  durationMs: number;
  detail: { chaptersPublished: number; novelsAffected: number; notificationsCreated: number };
}

let author: { id: string; email: string; password: string };
let authorCookie: string;
let novelId: string;
let volumeId: string;
const followerIds: string[] = [];
const created: { authorId: string; novelId: string }[] = [];

/** 到期（過去）與未到期（未來）的排程時刻 */
const PAST = () => new Date(Date.now() - 60_000);
const FUTURE = () => new Date(Date.now() + 24 * 3_600_000);

async function runPublishCron(): Promise<CronBody> {
  const res = await testFetch('/api/cron/publish-scheduled', {
    method: 'POST',
    ip: CRON_IP,
    headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
  });
  expect(res.status).toBe(200);
  return res.json();
}

/** 建一個草稿章節並寫入排程時刻；回傳識別碼與字數 */
async function makeScheduledChapter(
  scheduledAt: Date | null,
  label: string
): Promise<{ chapterId: string; wordCount: number }> {
  const { chapterId, number } = await createChapterRow(novelId, volumeId);
  const body = `${label} 第 ${number} 章的正文。`;
  const wordCount = body.replace(/\s/g, '').length;
  await saveChapterDraftRow(chapterId, {
    title: `${label} 第 ${number} 章`,
    bodyMarkdown: body,
    wordCount,
  });
  if (scheduledAt) {
    await prisma.chapter.update({ where: { id: chapterId }, data: { scheduledAt } });
  }
  return { chapterId, wordCount };
}

async function notificationCount(): Promise<number> {
  return prisma.notification.count({ where: { userId: { in: followerIds } } });
}

async function novelCounters(): Promise<{ chapterCount: number; wordCount: number }> {
  return prisma.novel.findUniqueOrThrow({
    where: { id: novelId },
    select: { chapterCount: true, wordCount: true },
  });
}

beforeAll(async () => {
  await resetAuthTables();

  author = await createAccount('sched-author', 'author');
  authorCookie = await loginAs(author.email, author.password, AUTHOR_IP);

  const novel = await createPublishedNovel({ authorId: author.id, chapterCount: 1 });
  novelId = novel.novelId;
  volumeId = novel.volumeId;
  created.push({ authorId: author.id, novelId });

  // 兩位收藏者：通知只發一次的斷言需要一個「不為 0」的期望值才有意義
  for (const label of ['sched-follower-1', 'sched-follower-2']) {
    const reader = await createAccount(label);
    followerIds.push(reader.id);
    await prisma.bookshelf.create({ data: { userId: reader.id, novelId } });
  }

  await prisma.notification.deleteMany();
}, 120_000);

afterAll(async () => {
  await prisma.notification.deleteMany();
  await cleanupNovels(created);
  await resetAuthTables();
});

describe('T115-1：到期章節轉為已發佈並回填計數', () => {
  let due: { chapterId: string; wordCount: number }[];
  let future: { chapterId: string; wordCount: number };
  let beforeCounters: { chapterCount: number; wordCount: number };
  let body: CronBody;

  beforeAll(async () => {
    due = [
      await makeScheduledChapter(PAST(), '到期A'),
      await makeScheduledChapter(PAST(), '到期B'),
    ];
    future = await makeScheduledChapter(FUTURE(), '未到期');
    beforeCounters = await novelCounters();

    body = await runPublishCron();
  }, 60_000);

  it('回應形狀符合契約（三個計數逐一回報，FR-057）', () => {
    expect(body.ok).toBe(true);
    expect(typeof body.durationMs).toBe('number');
    expect(body.detail).toEqual({
      chaptersPublished: 2,
      novelsAffected: 1,
      notificationsCreated: 2, // 兩位收藏者，兩章合併為一則（FR-052a）
    });
  });

  it('兩章皆轉為已發佈、publishedAt 有值，且 scheduledAt 清為 null', async () => {
    for (const { chapterId } of due) {
      const row = await prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } });
      expect(row.status).toBe('published');
      expect(row.publishedAt).not.toBeNull();
      // 未清空時，下一次掃描會再次選中同一章（FR-051 的重複防護就在這一欄）
      expect(row.scheduledAt).toBeNull();
    }
  });

  it('未到期的排程章節維持草稿且 scheduledAt 未被動到（提前曝光不可回收）', async () => {
    const row = await prisma.chapter.findUniqueOrThrow({ where: { id: future.chapterId } });
    expect(row.status).toBe('draft');
    expect(row.scheduledAt).not.toBeNull();
  });

  it('Novel.chapterCount 與 wordCount 於同一次執行內回填（FR-051）', async () => {
    const after = await novelCounters();
    expect(after.chapterCount).toBe(beforeCounters.chapterCount + 2);
    expect(after.wordCount).toBe(
      beforeCounters.wordCount + due.reduce((sum, c) => sum + c.wordCount, 0)
    );
  });

  it('兩位收藏者各得恰好一則通知（兩章合併為一則，非兩則）', async () => {
    expect(await notificationCount()).toBe(2);
    for (const userId of followerIds) {
      expect(await prisma.notification.count({ where: { userId } })).toBe(1);
    }
  });
});

describe('T115-2：重複執行不產生第二次發佈與第二則通知（SC-010、FR-051）', () => {
  let snapshot: { id: string; status: string; publishedAt: Date | null }[];
  let notificationsBefore: number;
  let body: CronBody;

  beforeAll(async () => {
    snapshot = await prisma.chapter.findMany({
      where: { novelId },
      orderBy: { number: 'asc' },
      select: { id: true, status: true, publishedAt: true },
    });
    notificationsBefore = await notificationCount();

    body = await runPublishCron();
  }, 60_000);

  it('第二次執行的三個計數皆為 0（到期集合為空）', () => {
    expect(body.detail).toEqual({
      chaptersPublished: 0,
      novelsAffected: 0,
      notificationsCreated: 0,
    });
  });

  it('章節的狀態與 publishedAt 逐筆不變（MUST NOT 覆寫成本次執行的時刻）', async () => {
    const after = await prisma.chapter.findMany({
      where: { novelId },
      orderBy: { number: 'asc' },
      select: { id: true, status: true, publishedAt: true },
    });
    expect(after).toEqual(snapshot);
  });

  it('通知總數不變（重跑不再打擾收藏者）', async () => {
    expect(await notificationCount()).toBe(notificationsBefore);
  });
});

describe('T115-3：已被手動發佈或刪除者略過，且不報錯（Edge Case）', () => {
  let manualId: string;
  let deletedId: string;
  let body: CronBody;

  beforeAll(async () => {
    // 作者在到期前自己按了發佈：狀態已是 published，但 scheduledAt 仍留著
    const manual = await makeScheduledChapter(PAST(), '手動已發');
    manualId = manual.chapterId;
    await prisma.chapter.update({
      where: { id: manualId },
      data: { status: 'published', publishedAt: new Date() },
    });

    // 作者在到期前把章節刪掉：掃描時該列已不存在
    const removed = await makeScheduledChapter(PAST(), '已刪除');
    deletedId = removed.chapterId;
    await prisma.chapterContent.deleteMany({ where: { chapterId: deletedId } });
    await prisma.chapter.delete({ where: { id: deletedId } });

    body = await runPublishCron();
  }, 60_000);

  it('執行成功（整批 MUST NOT 因單章的狀態而中止）', () => {
    expect(body.ok).toBe(true);
  });

  it('手動已發佈者不被重複計入，也不產生新的通知', async () => {
    expect(body.detail.chaptersPublished).toBe(0);
    expect(body.detail.notificationsCreated).toBe(0);
    expect(await notificationCount()).toBe(2);
  });

  it('已刪除者確實不在資料庫中（掃描條件自然排除，非靠例外處理）', async () => {
    expect(await prisma.chapter.findUnique({ where: { id: deletedId } })).toBeNull();
  });
});

describe('T115-4：指定過去時間回 400 且不建立無效排程（FR-049）', () => {
  let chapterId: string;

  beforeAll(async () => {
    const draft = await makeScheduledChapter(null, '無效排程');
    chapterId = draft.chapterId;
  }, 60_000);

  it('publishChapterAction 帶過去時間回 VALIDATION_ERROR', async () => {
    const res = await callAction(
      'publishChapterAction',
      [{ chapterId, scheduledAt: PAST().toISOString() }],
      // 動態路由專屬的 Action，須指定具體網址（見 helpers/serverAction.ts 的 pickRoute）
      { ip: AUTHOR_IP, cookie: authorCookie, route: `/author/editor/${chapterId}` }
    );
    expect(hasErrorCode(res, 'VALIDATION_ERROR')).toBe(true);
  });

  it('該章節維持草稿且 scheduledAt 仍為 null（無效排程 MUST NOT 落庫）', async () => {
    const row = await prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } });
    expect(row.status).toBe('draft');
    // 寫進去的話，下一次掃描會立刻發佈它 —— 結果等同立即發佈，而作者以為自己排了程
    expect(row.scheduledAt).toBeNull();
  });

  it('未來時間則寫入排程並維持草稿（400 不是對「排程」本身的拒絕）', async () => {
    const at = FUTURE();
    const res = await callAction(
      'publishChapterAction',
      [{ chapterId, scheduledAt: at.toISOString() }],
      { ip: AUTHOR_IP, cookie: authorCookie, route: `/author/editor/${chapterId}` }
    );
    expect(hasErrorCode(res, 'VALIDATION_ERROR')).toBe(false);

    const row = await prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } });
    expect(row.status).toBe('draft');
    expect(row.scheduledAt?.getTime()).toBe(at.getTime());
  });
});
