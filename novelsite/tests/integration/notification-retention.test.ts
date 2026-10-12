import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { testFetch } from '../helpers/client';
import { resetAuthTables } from '../helpers/resetAuthTables';
import { createAccount } from '../helpers/fixtures';

/**
 * T117c：通知保留期的實際清理（FR-053、contracts/analytics-scheduling-api.md §4）
 * ==============================================================================
 * 「通知 MUST 保留 90 天」在本任務之前只是一個**沒人執行的宣告**：
 * `NOTIFICATION_RETENTION_DAYS` 有預設值、`notificationRepository.purgeOlderThan()`
 * 有實作，但沒有任何呼叫端（T122 只建了函式）。結果是通知表無上限成長，
 * 而這種成長沒有任何症狀 —— 直到通知列表的查詢開始變慢，
 * 而那時看起來像是索引的問題。
 *
 * 三件事一起成立，保留期才算真的存在：
 *
 *  1. **逾期者被刪除**（清理確實被執行）。
 *  2. **未逾期者留存**（保留期不是「全刪」的別名 —— 一個把整張表清空的實作，
 *     只驗第 1 條時同樣會綠）。
 *  3. **`detail.notificationsPurged` 與實際刪除數相符**（FR-057）。
 *     清理是無聲的破壞性動作：不回報、或回報一個湊出來的數字時，
 *     保留期設錯（例如 90 寫成 9）不會有任何人看得出來，
 *     而使用者只會發現通知莫名其妙變少了。
 *
 * 清理的呼叫端是**每日彙總**（T127a）而非另一個排程作業：三個保留期的清理集中在
 * 同一個作業內，接漏一個時只需看一個地方（arch.md §10.3）。
 * 故本檔透過 `POST /api/cron/rollup-stats` 觸發，MUST NOT 直接呼叫資料存取層 ——
 * 那樣驗到的是「函式會刪」，而先前缺的正是「有人呼叫它」。
 */

const DAY_MS = 24 * 3_600_000;
const CRON_IP = '10.94.1.1';

interface RollupBody {
  ok: boolean;
  detail: {
    daysProcessed: number;
    novelsTouched: number;
    viewsPurged: number;
    bookshelfEventsPurged: number;
    notificationsPurged: number;
  };
}

let reader: { id: string };
/** 逾期（MUST 被刪）與未逾期（MUST 留存）的通知識別碼 */
const expiredIds: string[] = [];
const keptIds: string[] = [];

async function makeNotification(ageDays: number, into: string[]): Promise<void> {
  const row = await prisma.notification.create({
    data: {
      userId: reader.id,
      type: 'chapter_published',
      payload: JSON.stringify({ ageDays }),
      createdAt: new Date(Date.now() - ageDays * DAY_MS),
    },
  });
  into.push(row.id);
}

beforeAll(async () => {
  await resetAuthTables();
  // 本檔比對的是「刪了幾筆」的精確值，故 MUST 由空表起算 ——
  // 前一個檔案殘留的逾期通知會被一併刪除並計入回報數
  await prisma.notification.deleteMany();

  reader = await createAccount('retention-reader');

  const retention = env.NOTIFICATION_RETENTION_DAYS;
  await makeNotification(retention + 30, expiredIds); // 遠早於保留期
  await makeNotification(retention + 1, expiredIds); // 剛過保留期
  await makeNotification(retention - 1, keptIds); // 剛好還在保留期內
  await makeNotification(0, keptIds); // 今天才產生
}, 120_000);

afterAll(async () => {
  await prisma.notification.deleteMany();
  await resetAuthTables();
});

describe('T117c：每日彙總清理逾期通知並如實回報筆數', () => {
  let body: RollupBody;

  beforeAll(async () => {
    const res = await testFetch('/api/cron/rollup-stats', {
      method: 'POST',
      ip: CRON_IP,
      headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
    });
    expect(res.status).toBe(200);
    body = await res.json();
  }, 60_000);

  it('保留期預設為 90 天（FR-053）', () => {
    expect(env.NOTIFICATION_RETENTION_DAYS).toBe(90);
  });

  it('逾期的通知被刪除', async () => {
    const survivors = await prisma.notification.count({ where: { id: { in: expiredIds } } });
    expect(survivors).toBe(0);
  });

  it('未逾期的通知留存（保留期不是「全刪」的別名）', async () => {
    const kept = await prisma.notification.findMany({
      where: { id: { in: keptIds } },
      select: { id: true },
    });
    expect(kept.map((n) => n.id).sort()).toEqual([...keptIds].sort());
  });

  it('detail.notificationsPurged 與實際刪除數相符（FR-057）', () => {
    expect(body.detail.notificationsPurged).toBe(expiredIds.length);
  });

  it('三個清理對象各自回報，MUST NOT 併成一個總數', () => {
    expect(body.detail).toMatchObject({
      viewsPurged: expect.any(Number),
      bookshelfEventsPurged: expect.any(Number),
      notificationsPurged: expect.any(Number),
    });
  });

  it('再執行一次時 notificationsPurged 為 0（已無逾期者可刪，非每次都回同一個數字）', async () => {
    const res = await testFetch('/api/cron/rollup-stats', {
      method: 'POST',
      ip: CRON_IP,
      headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
    });
    expect(res.status).toBe(200);
    const second = (await res.json()) as RollupBody;

    expect(second.detail.notificationsPurged).toBe(0);
    expect(await prisma.notification.count()).toBe(keptIds.length);
  }, 60_000);
});
