import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { testFetch, loginAs } from '../helpers/client';
import { resetAuthTables } from '../helpers/resetAuthTables';
import { createAccount, createPublishedNovel, cleanupNovels } from '../helpers/fixtures';

/**
 * T047：一人一評、刪除即釋放、評分同步重算（FR-021～FR-023、SC-003、US2 AC1～AC3）
 * ===================================================================================
 * 三件事在同一個檔案裡，因為它們是**同一把鎖的三個面**：
 * 唯一鍵擋下第二次發表（409）、硬刪除讓唯一鍵自然釋放（可重新發表）、
 * 而三個寫入操作都必須在同一交易內把 `Novel.rating` 與 `ratingCount` 算回真值。
 *
 * 「回 409」與「資料庫只有一列」是**兩件事**：一個先寫入再回 409 的實作只驗狀態碼也會綠燈，
 * 故每一則案例都直接數該組合的列數。
 *
 * **每個案例各用一位新讀者與一部新作品**：評分是作品層級的累計值，共用作品會讓前一案的
 * 殘值決定後一案的期望值；而讀者共用會讓 `interaction:<userId>` 的額度跨案例累積
 * （症狀是「單獨跑會過、一起跑會紅」，見 tests/integration/sensitive-rate-limit.test.ts 的同一教訓）。
 */

interface Reader {
  id: string;
  cookie: string;
  ip: string;
}

let author: { id: string };
const createdNovels: { authorId: string; novelId: string }[] = [];
let seq = 0;

async function newReader(label: string): Promise<Reader> {
  seq += 1;
  const ip = `10.94.1.${seq}`;
  const acct = await createAccount(`rev1-${label}`);
  return { id: acct.id, cookie: await loginAs(acct.email, acct.password, ip), ip };
}

async function newNovel(): Promise<string> {
  const novel = await createPublishedNovel({ authorId: author.id, chapterCount: 1 });
  createdNovels.push({ authorId: author.id, novelId: novel.novelId });
  return novel.novelId;
}

function postReview(
  reader: Reader,
  novelId: string,
  body: { rating: number; content: string }
): Promise<Response> {
  return testFetch(`/api/novels/${novelId}/reviews`, {
    method: 'POST',
    ip: reader.ip,
    cookie: reader.cookie,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function patchReview(
  reader: Reader,
  reviewId: string,
  body: { rating?: number; content?: string }
): Promise<Response> {
  return testFetch(`/api/reviews/${reviewId}`, {
    method: 'PATCH',
    ip: reader.ip,
    cookie: reader.cookie,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function deleteReview(reader: Reader, reviewId: string): Promise<Response> {
  return testFetch(`/api/reviews/${reviewId}`, {
    method: 'DELETE',
    ip: reader.ip,
    cookie: reader.cookie,
  });
}

async function counters(
  novelId: string
): Promise<{ rating: number; ratingCount: number; commentCount: number }> {
  return prisma.novel.findUniqueOrThrow({
    where: { id: novelId },
    select: { rating: true, ratingCount: true, commentCount: true },
  });
}

async function reviewIdOf(res: Response): Promise<string> {
  const json = (await res.json()) as { review: { id: string } };
  return json.review.id;
}

beforeAll(async () => {
  await resetAuthTables();
  author = await createAccount('rev1-author', 'author');
});

afterAll(async () => {
  await cleanupNovels(createdNovels);
  await resetAuthTables();
});

describe('T047：一人一評（FR-021、SC-003、US2 AC1／AC2）', () => {
  it('第一次發表 → 200，資料庫恰一列，評分與評分人數同步更新', async () => {
    const reader = await newReader('first');
    const novelId = await newNovel();
    expect(await counters(novelId)).toEqual({ rating: 0, ratingCount: 0, commentCount: 0 });

    const res = await postReview(reader, novelId, { rating: 4, content: '節奏穩，值得追。' });
    expect(res.status).toBe(200);

    expect(await prisma.review.count({ where: { novelId, userId: reader.id } })).toBe(1);
    const after = await counters(novelId);
    expect(after.rating).toBeCloseTo(4, 1);
    expect(after.ratingCount).toBe(1);
    expect(after.commentCount).toBe(1);
  });

  it('第二次發表 → 409 CONFLICT，訊息引導改為編輯，且該組合恆為 1 列', async () => {
    const reader = await newReader('dup');
    const novelId = await newNovel();
    expect((await postReview(reader, novelId, { rating: 4, content: '第一則' })).status).toBe(200);

    const res = await postReview(reader, novelId, { rating: 1, content: '第二則' });
    expect(res.status).toBe(409);
    const json = (await res.json()) as { error: { code: string; message: string } };
    expect(json.error.code).toBe('CONFLICT');
    expect(json.error.message).toContain('編輯');

    // 資料庫不新增第二列，且第一則的內容未被第二次請求覆寫
    const rows = await prisma.review.findMany({ where: { novelId, userId: reader.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe('第一則');
    expect(rows[0].rating).toBe(4);

    const after = await counters(novelId);
    expect(after.ratingCount).toBe(1);
    expect(after.commentCount).toBe(1);
  });

  it('不同讀者對同一作品各自發表 → 兩列並存（唯一鍵是「作品＋人」，不是「作品」）', async () => {
    const a = await newReader('two-a');
    const b = await newReader('two-b');
    const novelId = await newNovel();

    expect((await postReview(a, novelId, { rating: 4, content: 'A 的評論' })).status).toBe(200);
    expect((await postReview(b, novelId, { rating: 5, content: 'B 的評論' })).status).toBe(200);

    expect(await prisma.review.count({ where: { novelId } })).toBe(2);
    const after = await counters(novelId);
    expect(after.rating).toBeCloseTo(4.5, 1);
    expect(after.ratingCount).toBe(2);
  });
});

describe('T047：刪除即移除，唯一鍵自然釋放（FR-023、US2 AC3）', () => {
  it('刪除自己的評論後可對同一作品重新發表，且無任何特例處理（一樣走 POST、一樣回 200）', async () => {
    const reader = await newReader('redo');
    const novelId = await newNovel();

    const created = await postReview(reader, novelId, { rating: 2, content: '看了三章就棄了' });
    expect(created.status).toBe(200);
    const reviewId = await reviewIdOf(created);

    const removed = await deleteReview(reader, reviewId);
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ ok: true });

    // 軟刪除會讓這一行變成 1 —— 而那正是「刪除後重新評論」撞唯一鍵的起點
    expect(await prisma.review.count({ where: { id: reviewId } })).toBe(0);
    expect(await prisma.review.count({ where: { novelId, userId: reader.id } })).toBe(0);

    const again = await postReview(reader, novelId, { rating: 5, content: '回頭補完，改觀了' });
    expect(again.status).toBe(200);
    expect(await prisma.review.count({ where: { novelId, userId: reader.id } })).toBe(1);

    const after = await counters(novelId);
    expect(after.rating).toBeCloseTo(5, 1);
    expect(after.ratingCount).toBe(1);
    expect(after.commentCount).toBe(1);
  });
});

describe('T047：新增／編輯／刪除後評分同步重算（FR-022、US2 AC1／AC3）', () => {
  it('編輯評分 → 平均隨之重算，評分人數不變', async () => {
    const a = await newReader('edit-a');
    const b = await newReader('edit-b');
    const novelId = await newNovel();

    const created = await postReview(a, novelId, { rating: 4, content: 'A 的評論' });
    const reviewId = await reviewIdOf(created);
    await postReview(b, novelId, { rating: 5, content: 'B 的評論' });
    expect((await counters(novelId)).rating).toBeCloseTo(4.5, 1);

    const patched = await patchReview(a, reviewId, { rating: 2, content: 'A 改變主意了' });
    expect(patched.status).toBe(200);

    const after = await counters(novelId);
    expect(after.rating).toBeCloseTo(3.5, 1);
    expect(after.ratingCount).toBe(2);
    // 編輯不是發表，留言數 MUST NOT 因編輯而增加
    expect(after.commentCount).toBe(2);

    const row = await prisma.review.findUniqueOrThrow({ where: { id: reviewId } });
    expect(row.rating).toBe(2);
    expect(row.content).toBe('A 改變主意了');
  });

  it('刪除其中一則 → 評分扣回為剩下那則的值；刪光後歸零（不留下沒有評分者的平均分）', async () => {
    const a = await newReader('recalc-a');
    const b = await newReader('recalc-b');
    const novelId = await newNovel();

    const first = await reviewIdOf(
      await postReview(a, novelId, { rating: 2, content: 'A 的評論' })
    );
    const second = await reviewIdOf(
      await postReview(b, novelId, { rating: 5, content: 'B 的評論' })
    );
    expect((await counters(novelId)).ratingCount).toBe(2);

    expect((await deleteReview(a, first)).status).toBe(200);
    const afterOne = await counters(novelId);
    expect(afterOne.rating).toBeCloseTo(5, 1);
    expect(afterOne.ratingCount).toBe(1);
    expect(afterOne.commentCount).toBe(1);

    expect((await deleteReview(b, second)).status).toBe(200);
    const afterAllRemoved = await counters(novelId);
    expect(afterAllRemoved.ratingCount).toBe(0);
    // 0 位評分者卻留著 5.0，畫面上就是一個沒有來源的數字（FR-043a 的同一條理由）
    expect(afterAllRemoved.rating).toBeCloseTo(0, 1);
    expect(afterAllRemoved.commentCount).toBe(0);
  });
});
