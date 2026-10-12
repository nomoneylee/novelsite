import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { testFetch } from '../helpers/client';
import { resetAuthTables } from '../helpers/resetAuthTables';
import { createAccount, createPublishedNovel } from '../helpers/fixtures';
import { deleteNovelOwned } from '@/lib/repositories';

/**
 * T089：彙總的全量校正與清理次序（SC-019 後半、FR-036b、data-model.md §7.1）
 * =========================================================================
 * `Novel` 上的四個計數是**快取值**，真相在原始表裡。快取一定會漂：
 * 交易中途失敗、直接改資料庫、未來某次重構漏掉一條增減路徑 —— 漂了以後沒有人看得出來。
 * 每日彙總的最後兩步（回填、校正）是這份快取的唯一修復機制，
 * 而修復機制的驗收方式只有一種：**刻意把它弄壞，看它會不會被修好**。
 *
 * 第二件事是**次序**：清理 MUST 發生在彙總與校正之後。
 * 反過來寫，同一次執行會先刪掉尚未彙總的明細，那些天的數字就永遠是 0 了 ——
 * 而且不會有任何錯誤訊息，因為每一步單獨看都成功了。
 * 本檔的驗法是安排一筆「已過保留期、但尚未被彙總」的明細：
 * 它同時出現在統計列裡（證明彙總先跑）又已從明細表消失（證明清理有跑），
 * 兩者只有在次序正確時才能同時成立。
 */

const DAY_MS = 24 * 3_600_000;
const TAIPEI_OFFSET_MS = 8 * 3_600_000;
const CRON_IP = '10.89.1.1';

/** 與 taipeiDay.ts 相同的固定偏移算術，於本檔獨立實作（理由見 rollup-idempotent.test.ts 檔首） */
function taipeiDayStartOf(at: Date): Date {
  return new Date(
    Math.floor((at.getTime() + TAIPEI_OFFSET_MS) / DAY_MS) * DAY_MS - TAIPEI_OFFSET_MS
  );
}
function dayStartAgo(n: number): Date {
  return new Date(taipeiDayStartOf(new Date()).getTime() - n * DAY_MS);
}
function noonOfDayAgo(n: number): Date {
  return new Date(dayStartAgo(n).getTime() + 12 * 3_600_000);
}

/** 已超過保留期、但從未被彙總過的那一天 */
const STALE_DAYS_AGO = env.VIEW_RETENTION_DAYS + 2;
/** 仍在保留期內的一天，作為「不該被清掉」的對照 */
const FRESH_DAYS_AGO = 1;

let author: { id: string };
let reader: { id: string };
let otherReader: { id: string };
let hiddenAuthor: { id: string };
let novelId: string;
let chapterIds: string[];

function runRollup(): Promise<Response> {
  return testFetch('/api/cron/rollup-stats', {
    method: 'POST',
    ip: CRON_IP,
    headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
  });
}

function novelCounters() {
  return prisma.novel.findUniqueOrThrow({
    where: { id: novelId },
    select: {
      favoriteCount: true,
      commentCount: true,
      rating: true,
      ratingCount: true,
      totalViews: true,
    },
  });
}

beforeAll(async () => {
  await resetAuthTables();
  await prisma.novelDailyStat.deleteMany();
  await prisma.chapterView.deleteMany();
  await prisma.bookshelfEvent.deleteMany();

  author = await createAccount('correction-author', 'author');
  reader = await createAccount('correction-reader');
  otherReader = await createAccount('correction-reader-2');
  hiddenAuthor = await createAccount('correction-reader-3');

  const novel = await createPublishedNovel({ authorId: author.id, chapterCount: 2 });
  novelId = novel.novelId;
  chapterIds = novel.chapterIds;

  // ── 原始紀錄（真相）─────────────────────────────────────────────
  // 收藏 2 筆
  await prisma.bookshelf.createMany({
    data: [
      { userId: reader.id, novelId },
      { userId: otherReader.id, novelId },
    ],
  });
  // 可見留言 1 則
  await prisma.comment.create({
    data: {
      chapterId: chapterIds[0],
      userId: reader.id,
      content: 'T089 的可見留言',
      status: 'visible',
      createdAt: noonOfDayAgo(FRESH_DAYS_AGO),
    },
  });
  // 已隱藏的留言 1 則 —— 校正 MUST NOT 把它算進 commentCount
  await prisma.comment.create({
    data: {
      chapterId: chapterIds[0],
      userId: otherReader.id,
      content: 'T089 的隱藏留言',
      status: 'hidden',
      createdAt: noonOfDayAgo(FRESH_DAYS_AGO),
    },
  });
  // 可見評論 1 則，評分 4
  await prisma.review.create({
    data: {
      novelId,
      userId: reader.id,
      rating: 4,
      content: 'T089 的可見評論，評分 4',
      status: 'visible',
      createdAt: noonOfDayAgo(FRESH_DAYS_AGO),
    },
  });
  // 已隱藏的評論 1 則，評分 1 —— 若被算進平均，rating 會變成 2.5 而非 4
  await prisma.review.create({
    data: {
      novelId,
      userId: hiddenAuthor.id,
      rating: 1,
      content: 'T089 的隱藏評論，評分 1',
      status: 'hidden',
      createdAt: noonOfDayAgo(FRESH_DAYS_AGO),
    },
  });

  // ── 清理次序用的明細 ────────────────────────────────────────────
  // 已過保留期、且從未被彙總過：彙總 → 清理的次序若相反，這一天的統計列會是 0
  await prisma.chapterView.create({
    data: {
      chapterId: chapterIds[0],
      novelId,
      viewerHash: 'stale-view-hash'.padEnd(64, '0'),
      viewedAt: noonOfDayAgo(STALE_DAYS_AGO),
    },
  });
  await prisma.bookshelfEvent.create({
    data: { userId: reader.id, novelId, delta: 1, createdAt: noonOfDayAgo(STALE_DAYS_AGO) },
  });
  // 仍在保留期內：清理 MUST NOT 碰它
  await prisma.chapterView.create({
    data: {
      chapterId: chapterIds[1],
      novelId,
      viewerHash: 'fresh-view-hash'.padEnd(64, '0'),
      viewedAt: noonOfDayAgo(FRESH_DAYS_AGO),
    },
  });

  // ── 刻意把四個快取計數改成錯誤值 ────────────────────────────────
  await prisma.novel.update({
    where: { id: novelId },
    data: { favoriteCount: 999, commentCount: 888, rating: 5, ratingCount: 777 },
  });
});

afterAll(async () => {
  await prisma.novelDailyStat.deleteMany();
  await prisma.chapterView.deleteMany();
  await prisma.bookshelfEvent.deleteMany();
  await prisma.bookshelf.deleteMany({ where: { novelId } });
  await prisma.review.deleteMany({ where: { novelId } });
  await prisma.comment.deleteMany({ where: { chapterId: { in: chapterIds } } });
  await deleteNovelOwned(author.id, novelId);
  await resetAuthTables();
});

describe('T089-1：錯誤的快取計數被校正回與原始紀錄一致（SC-019）', () => {
  let detail: Record<string, number>;

  beforeAll(async () => {
    // 先確認起始狀態確實是壞的 —— 否則「校正成功」可能只是它本來就對
    expect(await novelCounters()).toMatchObject({
      favoriteCount: 999,
      commentCount: 888,
      rating: 5,
      ratingCount: 777,
    });

    const res = await runRollup();
    expect(res.status).toBe(200);
    detail = (await res.json()).detail;
  }, 60_000);

  it('favoriteCount 以 Bookshelf 的列數全量重算', async () => {
    expect((await novelCounters()).favoriteCount).toBe(2);
  });

  it('commentCount 為可見留言 ＋ 可見評論，已隱藏者不計入', async () => {
    expect((await novelCounters()).commentCount).toBe(2);
  });

  it('rating 為可見評論的平均、ratingCount 為其則數（隱藏的低分評論不拉低平均）', async () => {
    const counters = await novelCounters();
    expect(counters.ratingCount).toBe(1);
    expect(counters.rating).toBeCloseTo(4, 5);
  });

  it('清理的刪除筆數逐項回報（無聲的破壞性動作 MUST 看得見）', () => {
    expect(detail.viewsPurged).toBeGreaterThanOrEqual(1);
    expect(detail.bookshelfEventsPurged).toBeGreaterThanOrEqual(1);
  });
});

describe('T089-2：清理發生在彙總之後（SC-019 後半）', () => {
  it('已過保留期的明細：其所屬日期仍有統計列且計入該筆（證明彙總先跑）', async () => {
    const row = await prisma.novelDailyStat.findFirst({
      where: { novelId, date: dayStartAgo(STALE_DAYS_AGO) },
    });
    expect(row).not.toBeNull();
    expect(row!.views).toBe(1);
    expect(row!.favorites).toBe(1);
  });

  it('該筆明細與收藏事件已從原始表移除（證明清理有跑，且晚於彙總）', async () => {
    const cutoff = new Date(Date.now() - env.VIEW_RETENTION_DAYS * DAY_MS);
    expect(await prisma.chapterView.count({ where: { novelId, viewedAt: { lt: cutoff } } })).toBe(
      0
    );
    expect(
      await prisma.bookshelfEvent.count({ where: { novelId, createdAt: { lt: cutoff } } })
    ).toBe(0);
  });

  it('保留期內的明細 MUST NOT 被清掉（清理的界線是保留期，不是「清空」）', async () => {
    expect(
      await prisma.chapterView.count({
        where: { novelId, viewedAt: { gte: dayStartAgo(FRESH_DAYS_AGO) } },
      })
    ).toBe(1);
  });

  it('保留期外那一天的統計列在明細消失後仍留著（統計是明細清掉之後唯一的紀錄）', async () => {
    const rows = await prisma.novelDailyStat.findMany({ where: { novelId } });
    expect(rows.some((r) => r.date.getTime() === dayStartAgo(STALE_DAYS_AGO).getTime())).toBe(true);
  });
});

describe('T089-3：校正後再跑一次仍相同（校正本身冪等，MUST NOT 累加）', () => {
  it('第二次彙總不改變四個計數', async () => {
    const before = await novelCounters();
    const res = await runRollup();
    expect(res.status).toBe(200);
    expect(await novelCounters()).toEqual(before);
  }, 60_000);
});
