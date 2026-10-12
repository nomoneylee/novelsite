import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { testFetch, loginAs } from '../helpers/client';
import { resetAuthTables } from '../helpers/resetAuthTables';
import { createAccount, createPublishedNovel, cleanupNovels } from '../helpers/fixtures';

/**
 * T050：對他人的評論與留言的修改一律 403（FR-004、US2 AC4）
 * ==========================================================
 * **403 而非 404 是刻意的**：評論與留言是公開可見的資源，它的存在性本來就不是秘密，
 * 用 404 假裝「查無此物」只會讓真正的 404（識別碼根本不存在）不再有任何資訊量。
 * 這與作者向資源的「非擁有者一律 404」規則刻意相反、兩者並存（spec Assumptions），
 * 故本檔一併固定住「不存在 → 404」那一側，使「該回哪一個」寫死在測試裡。
 *
 * 每一則案例都在請求前後比對資料本身：只驗狀態碼的話，
 * 一個先改再回 403 的實作也會綠燈。
 *
 * 評論的擁有者**每案一位新讀者**：一人一評使同一位讀者對同一部作品發不出第二則，
 * 共用擁有者會讓第二個案例的前置作業自己撞上 409。
 */

interface Actor {
  id: string;
  cookie: string;
  ip: string;
}

const OWNER_REVIEW = '這是擁有者寫的評論';
const OWNER_COMMENT = '這是擁有者寫的留言';

let author: { id: string };
let novelId: string;
let chapterId: string;
let intruder: Actor;
const created: { authorId: string; novelId: string }[] = [];
let seq = 0;

async function newReader(label: string): Promise<Actor> {
  seq += 1;
  const ip = `10.97.1.${seq}`;
  const acct = await createAccount(`forbid-${label}`);
  return { id: acct.id, cookie: await loginAs(acct.email, acct.password, ip), ip };
}

async function createReview(actor: Actor): Promise<string> {
  const res = await testFetch(`/api/novels/${novelId}/reviews`, {
    method: 'POST',
    ip: actor.ip,
    cookie: actor.cookie,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rating: 4, content: OWNER_REVIEW }),
  });
  expect(res.status, '前置作業：發表評論應為 200').toBe(200);
  return ((await res.json()) as { review: { id: string } }).review.id;
}

async function createComment(actor: Actor): Promise<string> {
  const res = await testFetch(`/api/chapters/${chapterId}/comments`, {
    method: 'POST',
    ip: actor.ip,
    cookie: actor.cookie,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: OWNER_COMMENT }),
  });
  expect(res.status, '前置作業：發表留言應為 200').toBe(200);
  return ((await res.json()) as { comment: { id: string } }).comment.id;
}

beforeAll(async () => {
  await resetAuthTables();
  author = await createAccount('forbid-author', 'author');
  const novel = await createPublishedNovel({ authorId: author.id, chapterCount: 1 });
  novelId = novel.novelId;
  chapterId = novel.chapterIds[0];
  created.push({ authorId: author.id, novelId });
  intruder = await newReader('intruder');
});

afterAll(async () => {
  // 評論、讚與留言皆由級聯一併移除，故清理只需刪作品；
  // 直接對新表下 deleteMany 反而會在實作尚未落地時擲出而中斷清理
  await cleanupNovels(created);
  await resetAuthTables();
});

describe('T050：他人的評論不可編輯、不可刪除（FR-004、US2 AC4）', () => {
  it('PATCH 他人的評論 → 403 FORBIDDEN，且評分與內容皆未變更', async () => {
    const owner = await newReader('review-patch');
    const reviewId = await createReview(owner);

    const res = await testFetch(`/api/reviews/${reviewId}`, {
      method: 'PATCH',
      ip: intruder.ip,
      cookie: intruder.cookie,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: 1, content: '被別人改掉的內容' }),
    });
    expect(res.status, '公開資源的非擁有者操作回 403，MUST NOT 回 404').toBe(403);
    expect((await res.json()).error.code).toBe('FORBIDDEN');

    const row = await prisma.review.findUniqueOrThrow({ where: { id: reviewId } });
    expect(row.rating).toBe(4);
    expect(row.content).toBe(OWNER_REVIEW);
  });

  it('DELETE 他人的評論 → 403 FORBIDDEN，且該列仍在', async () => {
    const owner = await newReader('review-delete');
    const reviewId = await createReview(owner);

    const res = await testFetch(`/api/reviews/${reviewId}`, {
      method: 'DELETE',
      ip: intruder.ip,
      cookie: intruder.cookie,
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('FORBIDDEN');
    expect(await prisma.review.count({ where: { id: reviewId } })).toBe(1);
  });

  it('對照組：擁有者自己編輯同一則評論 → 200（證明 403 不是因為端點壞了）', async () => {
    const owner = await newReader('review-self');
    const reviewId = await createReview(owner);

    const res = await testFetch(`/api/reviews/${reviewId}`, {
      method: 'PATCH',
      ip: owner.ip,
      cookie: owner.cookie,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '擁有者自己改的內容' }),
    });
    expect(res.status).toBe(200);
    const row = await prisma.review.findUniqueOrThrow({ where: { id: reviewId } });
    expect(row.content).toBe('擁有者自己改的內容');
  });

  it('不存在的評論識別碼 → 404（404 保留給真的不存在，403 才有資訊量）', async () => {
    const res = await testFetch('/api/reviews/no-such-review-id', {
      method: 'DELETE',
      ip: intruder.ip,
      cookie: intruder.cookie,
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('NOT_FOUND');
  });
});

describe('T050：他人的留言不可刪除（FR-004）', () => {
  it('DELETE 他人的留言 → 403 FORBIDDEN，該列既未消失也未變成墓碑', async () => {
    const owner = await newReader('comment-delete');
    const commentId = await createComment(owner);

    const res = await testFetch(`/api/comments/${commentId}`, {
      method: 'DELETE',
      ip: intruder.ip,
      cookie: intruder.cookie,
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('FORBIDDEN');

    const row = await prisma.comment.findUniqueOrThrow({ where: { id: commentId } });
    expect(row.status).toBe('visible');
    expect(row.content).toBe(OWNER_COMMENT);
  });

  it('對照組：擁有者自己刪除同一則留言 → 200 且轉為墓碑', async () => {
    const owner = await newReader('comment-self');
    const commentId = await createComment(owner);

    const res = await testFetch(`/api/comments/${commentId}`, {
      method: 'DELETE',
      ip: owner.ip,
      cookie: owner.cookie,
    });
    expect(res.status).toBe(200);
    const row = await prisma.comment.findUniqueOrThrow({ where: { id: commentId } });
    expect(row.status).toBe('deleted');
  });

  it('不存在的留言識別碼 → 404', async () => {
    const res = await testFetch('/api/comments/no-such-comment-id', {
      method: 'DELETE',
      ip: intruder.ip,
      cookie: intruder.cookie,
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('NOT_FOUND');
  });
});
