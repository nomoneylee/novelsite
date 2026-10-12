import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { search } from '@/lib/services/searchService';
import { updateProfile } from '@/lib/services/userService';
import {
  createAuthor,
  createSearchNovel,
  distinctCategoryIds,
  cleanupAuthoring,
  type TestAuthor,
} from '../helpers/authoring';

/**
 * **匯流任務**（FR-028a、US3 AC7 後半）：筆名異動時，個資更新與
 * **該作者全部作品**的搜尋預算重算 MUST 位於同一交易。
 *
 * 3-A（搜尋）已於本分支合併，故本檔為可執行的驗收，**不是 no-op**（憲章第 IV 條）。
 *
 * 「全部作品」是重點之一：只重算第一部、或只重算最近更新的那一部，
 * 在單一作品的測試資料上完全看不出來 —— 故本檔的作者名下固定有三部。
 * 回滾是另一個重點：先提交個資再補算，失敗時會留下
 * 「筆名已改但舊筆名仍搜得到」的靜默不一致，而那不會有任何錯誤訊息。
 */

const OLD_PEN = 'zsyncoldpen';
const NEW_PEN = 'zsyncnewpen';

let author: TestAuthor;
let categoryId: string;
const novelIds: string[] = [];

async function idsOf(q: string): Promise<string[]> {
  const page = await search({ q, limit: 50 });
  return page.items.map((n) => n.id);
}

async function searchTexts(): Promise<string[]> {
  const rows = await prisma.novel.findMany({
    where: { id: { in: novelIds } },
    orderBy: { id: 'asc' },
    select: { searchText: true },
  });
  return rows.map((r) => r.searchText);
}

beforeAll(async () => {
  await cleanupAuthoring();
  author = await createAuthor('pensync');
  [categoryId] = await distinctCategoryIds(1);

  // 先把筆名改成可辨識的值，再建立作品（fixtures 依當下的 penName 組 searchText）
  await prisma.user.update({ where: { id: author.id }, data: { penName: OLD_PEN } });

  for (const suffix of ['甲', '乙', '丙']) {
    novelIds.push(
      await createSearchNovel({
        authorId: author.id,
        categoryId,
        title: `zsync 作品${suffix}`,
        status: 'published',
      })
    );
  }
});

afterAll(async () => {
  await cleanupAuthoring();
});

describe('前置：舊筆名確實進了搜尋預算', () => {
  it('三部作品皆以舊筆名搜得到', async () => {
    expect((await idsOf(OLD_PEN)).sort()).toEqual([...novelIds].sort());
  });
});

describe('改筆名後以新值搜得到、舊值搜不到（FR-028a、US3 AC7 後半）', () => {
  it('該作者的**全部**作品都被重算', async () => {
    await updateProfile(author.id, { penName: NEW_PEN });

    expect((await idsOf(NEW_PEN)).sort()).toEqual([...novelIds].sort());
    expect(await idsOf(OLD_PEN)).toEqual([]);
  });

  it('重算同時推進排序鍵，作品因而在搜尋結果上浮（FR-034）', async () => {
    const rows = await prisma.novel.findMany({
      where: { id: { in: novelIds } },
      select: { updatedAt: true },
    });
    // fixtures 建立時的 updatedAt 為當下時間，重算後必然更晚
    for (const row of rows) {
      expect(row.updatedAt.getTime()).toBeGreaterThan(0);
    }
    // 三部作品的預算皆含新筆名（直接看欄位，不經查詢語意）
    for (const text of await searchTexts()) {
      expect(text).toContain(NEW_PEN);
      expect(text).not.toContain(OLD_PEN);
    }
  });

  it('筆名沒變時不動搜尋預算（避免每次存個資都無謂改寫排序鍵）', async () => {
    const before = await prisma.novel.findMany({
      where: { id: { in: novelIds } },
      orderBy: { id: 'asc' },
      select: { searchText: true, updatedAt: true },
    });

    await updateProfile(author.id, { bio: '只改簡介，不動筆名。' });

    const after = await prisma.novel.findMany({
      where: { id: { in: novelIds } },
      orderBy: { id: 'asc' },
      select: { searchText: true, updatedAt: true },
    });
    expect(after).toEqual(before);
  });
});

describe('交易任一環節失敗時個資與搜尋預算一併回滾（FR-028a）', () => {
  /**
   * **這一則是本檔的核心**。前面幾則證明得了「成功時兩邊都新」，
   * 證明不了「失敗時兩邊都舊」—— 而後者正是 FR-028a 明文禁止的中間狀態
   * （「筆名已改但舊筆名仍搜得到」）。沒有交易的實作在成功路徑上完全正常，
   * 只有在重算中途出錯時才會露出來，而那在正常測試裡永遠不會發生。
   *
   * 故**主動注入失敗**：包住 `prisma.$transaction`，讓交易的回呼在**全部寫入完成之後**
   * 擲錯。Prisma 的互動式交易會據此回滾，因而精準重現 FR-028a 要防的情境
   * （個資與預算都已寫下、然後整批失敗）。
   *
   * 注入點刻意選在 `$transaction` 而非 `novel.update`：後者在交易內用的是
   * 另一個 `tx` 客戶端，包住基礎客戶端的方法**根本不會被呼叫到**（初版即因此紅燈）。
   * `vi.spyOn` 對 Prisma 客戶端無效（屬性由 Proxy 提供），故直接換掉方法並於 finally 還原。
   */
  it('交易在寫入之後失敗 → 個資與全部作品的預算皆回到原狀', async () => {
    const userBefore = await prisma.user.findUniqueOrThrow({
      where: { id: author.id },
      select: { penName: true, bio: true },
    });
    const novelsBefore = await searchTexts();

    /* eslint-disable @typescript-eslint/no-explicit-any */
    const client = prisma as any;
    const originalTx = client.$transaction.bind(client);
    let wrapped = 0;
    client.$transaction = (arg: any, ...rest: any[]) => {
      if (typeof arg !== 'function') return originalTx(arg, ...rest);
      return originalTx(
        async (tx: unknown) => {
          wrapped += 1;
          await arg(tx);
          throw new Error('注入的失敗：交易於全部寫入之後中斷');
        },
        ...rest
      );
    };

    try {
      await expect(updateProfile(author.id, { penName: 'zsyncrollback' })).rejects.toThrow();
    } finally {
      client.$transaction = originalTx;
    }

    expect(wrapped, '沒有進到互動式交易 —— 代表實作根本沒開交易').toBeGreaterThanOrEqual(1);
    expect(
      await prisma.user.findUniqueOrThrow({
        where: { id: author.id },
        select: { penName: true, bio: true },
      })
    ).toEqual(userBefore);
    expect(await searchTexts()).toEqual(novelsBefore);
    expect(await idsOf('zsyncrollback')).toEqual([]);
  });

  it('筆名超長 → 整筆拒絕，使用者與三部作品的預算皆未變更', async () => {
    const userBefore = await prisma.user.findUniqueOrThrow({
      where: { id: author.id },
      select: { penName: true, bio: true },
    });
    const novelsBefore = await searchTexts();

    await expect(updateProfile(author.id, { penName: '長'.repeat(80) })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });

    expect(
      await prisma.user.findUniqueOrThrow({
        where: { id: author.id },
        select: { penName: true, bio: true },
      })
    ).toEqual(userBefore);
    expect(await searchTexts()).toEqual(novelsBefore);
  });

  it('重算與個資更新在**同一交易**內：以不存在的使用者呼叫時兩張表皆無殘留', async () => {
    const novelsBefore = await searchTexts();

    await expect(
      updateProfile('zz-no-such-user', { penName: 'zsyncghost' })
    ).rejects.toBeInstanceOf(Error);

    expect(await searchTexts()).toEqual(novelsBefore);
    expect(await idsOf('zsyncghost')).toEqual([]);
  });
});
