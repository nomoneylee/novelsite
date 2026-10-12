import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { testFetch, loginAs } from '../helpers/client';
import { resetAuthTables } from '../helpers/resetAuthTables';
import { createAccount, createPublishedNovel, cleanupNovels } from '../helpers/fixtures';
import { env } from '@/lib/env';

/**
 * T052：發表評論與留言的速率限制（FR-028、US2 AC8、contracts/interaction-api.md §4）
 * ==================================================================================
 * 限流的價值全在**超額之後**：擋下第 N+1 次是它的工作，
 * 但「先前已送出的 N 則不受影響」才是它可以被接受的前提 ——
 * 一個把整個時間窗內的寫入全部回滾的實作也會讓 429 出現，那不是限流而是資料遺失。
 *
 * 額度鍵為 `interaction:<userId>`（**一把鎖，評論與留言共用**），故本檔一併驗證
 * 「用留言耗盡後，評論同樣被擋」與「換一個帳號不受影響」——
 * 兩者一個驗鍵的範圍、一個驗鍵的粒度，少了任一個，一個全域計數器也會通過。
 *
 * 每個案例各用一個新帳號：限流鍵是使用者識別碼，共用帳號會讓前一案的計數洩漏到下一案，
 * 症狀是「單獨跑會過、一起跑會紅」（見 tests/integration/sensitive-rate-limit.test.ts）。
 */

const MAX = env.INTERACTION_RATE_MAX;

interface Actor {
  id: string;
  cookie: string;
  ip: string;
}

let author: { id: string };
let chapterId: string;
const createdNovels: { authorId: string; novelId: string }[] = [];
let seq = 0;

async function newReader(label: string): Promise<Actor> {
  seq += 1;
  const ip = `10.99.1.${seq}`;
  const acct = await createAccount(`ratelimit-${label}`);
  return { id: acct.id, cookie: await loginAs(acct.email, acct.password, ip), ip };
}

async function newNovel(): Promise<string> {
  const novel = await createPublishedNovel({ authorId: author.id, chapterCount: 1 });
  createdNovels.push({ authorId: author.id, novelId: novel.novelId });
  return novel.novelId;
}

function postComment(actor: Actor, content: string): Promise<Response> {
  return testFetch(`/api/chapters/${chapterId}/comments`, {
    method: 'POST',
    ip: actor.ip,
    cookie: actor.cookie,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
}

function postReview(actor: Actor, novelId: string): Promise<Response> {
  return testFetch(`/api/novels/${novelId}/reviews`, {
    method: 'POST',
    ip: actor.ip,
    cookie: actor.cookie,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rating: 5, content: '額度用完之後才送出的評論' }),
  });
}

beforeAll(async () => {
  await resetAuthTables();
  author = await createAccount('ratelimit-author', 'author');
  const novel = await createPublishedNovel({ authorId: author.id, chapterCount: 1 });
  createdNovels.push({ authorId: author.id, novelId: novel.novelId });
  chapterId = novel.chapterIds[0];
});

afterAll(async () => {
  // 留言、評論與讚皆由級聯一併移除，故清理只需刪作品；
  // 直接對新表下 deleteMany 反而會在實作尚未落地時擲出而中斷清理
  await cleanupNovels(createdNovels);
  await resetAuthTables();
});

describe(`T052：一分鐘內超過 INTERACTION_RATE_MAX（${MAX}）→ 429 RATE_LIMITED`, () => {
  it(`前 ${MAX} 則留言全部成功，第 ${MAX + 1} 則回 429 並附 Retry-After`, async () => {
    const actor = await newReader('burst');

    for (let i = 1; i <= MAX; i++) {
      const res = await postComment(actor, `第 ${i} 則留言`);
      expect(res.status, `第 ${i} 則不該被限流`).toBe(200);
    }

    const limited = await postComment(actor, `第 ${MAX + 1} 則留言`);
    expect(limited.status).toBe(429);
    expect((await limited.json()).error.code).toBe('RATE_LIMITED');

    const retryAfter = limited.headers.get('Retry-After');
    expect(retryAfter, 'Retry-After MUST 存在，否則客戶端只能盲目重試').not.toBeNull();
    expect(Number(retryAfter)).toBeGreaterThan(0);
  });

  it('先前已送出的內容不受影響：被擋下的那一次不回滾、也不吃掉前面已寫入的留言', async () => {
    const actor = await newReader('preserve');

    const sent: string[] = [];
    for (let i = 1; i <= MAX; i++) {
      const content = `保留檢查第 ${i} 則`;
      expect((await postComment(actor, content)).status).toBe(200);
      sent.push(content);
    }
    expect((await postComment(actor, '這一則會被擋下')).status).toBe(429);

    const rows = await prisma.comment.findMany({
      where: { chapterId, userId: actor.id },
      select: { content: true },
    });
    expect(rows).toHaveLength(MAX);
    expect(rows.map((r) => r.content).sort()).toEqual([...sent].sort());
    // 被擋下的那一則 MUST NOT 留下任何痕跡
    expect(rows.some((r) => r.content === '這一則會被擋下')).toBe(false);
  });
});

describe('T052：額度鍵為 interaction:<userId>（contracts §4）', () => {
  it('評論與留言共用同一份額度 —— 用留言耗盡後，發表評論同樣被擋', async () => {
    const actor = await newReader('shared');
    const novelId = await newNovel();

    for (let i = 1; i <= MAX; i++) {
      expect((await postComment(actor, `共用額度第 ${i} 則`)).status).toBe(200);
    }

    const res = await postReview(actor, novelId);
    expect(res.status, '兩個入口是同一把鎖，MUST NOT 各自一份額度').toBe(429);
    expect((await res.json()).error.code).toBe('RATE_LIMITED');
    expect(await prisma.review.count({ where: { novelId, userId: actor.id } })).toBe(0);
  });

  it('鍵的粒度是使用者：一個帳號被限流時，另一個帳號照常可以發言', async () => {
    const blocked = await newReader('isolation-a');
    const other = await newReader('isolation-b');

    for (let i = 1; i <= MAX; i++) {
      expect((await postComment(blocked, `隔離檢查第 ${i} 則`)).status).toBe(200);
    }
    expect((await postComment(blocked, '被擋下的那一則')).status).toBe(429);

    const res = await postComment(other, '另一個帳號的留言');
    expect(res.status, '限流 MUST NOT 是全域計數器').toBe(200);
  });
});
