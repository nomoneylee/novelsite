import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { testFetch, loginAs } from '../helpers/client';
import { resetAuthTables } from '../helpers/resetAuthTables';
import { createAccount, createPublishedNovel, cleanupNovels } from '../helpers/fixtures';

/**
 * T053a：互動域的未登入防線（FR-002、FR-026、US2 AC7）
 * =====================================================
 * FR-002 的對象是「本階段新增的**所有**寫入入口」，而 T009 只涵蓋 US1 的六個端點；
 * 4-B 新增的七條寫入路徑先前沒有任何 401 斷言 —— 一個漏掉守衛的端點不會有症狀，
 * 直到有人不帶 Cookie 就改掉了別人的資料。
 *
 * 「回 401」與「沒有寫入」是**兩件事**：只驗狀態碼時，一個先寫入再回 401 的實作也會綠燈，
 * 故每一則案例都在請求前後比對三張表的總列數，並逐欄核對被指名的那一列未被更動。
 *
 * 另一半是相反方向的保證：**讀取是公開的**（FR-026）。
 * 把讀取一併關起來是最容易「順手」做出來的錯誤，而它會讓未登入訪客連留言區都看不到，
 * 於是 US2 AC7 的「可讀、送出才需登入」變成假的。
 */

const REVIEW_TEXT = '未登入者不得改動這則評論';
const COMMENT_TEXT = '未登入者不得刪除這則留言';
const IP = '10.100.1.1';

interface Actor {
  id: string;
  cookie: string;
  ip: string;
}

let author: Actor;
let reader: Actor;
let novelId: string;
let chapterId: string;
let reviewId: string;
let commentId: string;
const created: { authorId: string; novelId: string }[] = [];
let seq = 0;

async function newActor(label: string, role: 'reader' | 'author' = 'reader'): Promise<Actor> {
  seq += 1;
  const ip = `10.100.2.${seq}`;
  const acct = await createAccount(`guard4b-${label}`, role);
  return { id: acct.id, cookie: await loginAs(acct.email, acct.password, ip), ip };
}

async function countAll(): Promise<Record<string, number>> {
  const [reviews, reviewLikes, comments] = await Promise.all([
    prisma.review.count(),
    prisma.reviewLike.count(),
    prisma.comment.count(),
  ]);
  return { reviews, reviewLikes, comments };
}

/** 未登入請求：不帶 Cookie，Origin 由 testFetch 預設為同源（跨站另有 T073 涵蓋） */
function anonymous(path: string, method: string, body?: unknown): Promise<Response> {
  return testFetch(path, {
    method,
    ip: IP,
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

beforeAll(async () => {
  await resetAuthTables();
  author = await newActor('author', 'author');
  reader = await newActor('reader');

  const novel = await createPublishedNovel({ authorId: author.id, chapterCount: 1 });
  novelId = novel.novelId;
  chapterId = novel.chapterIds[0];
  created.push({ authorId: author.id, novelId });

  const reviewRes = await testFetch(`/api/novels/${novelId}/reviews`, {
    method: 'POST',
    ip: reader.ip,
    cookie: reader.cookie,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rating: 4, content: REVIEW_TEXT }),
  });
  expect(reviewRes.status, '前置作業：發表評論應為 200').toBe(200);
  reviewId = ((await reviewRes.json()) as { review: { id: string } }).review.id;

  const commentRes = await testFetch(`/api/chapters/${chapterId}/comments`, {
    method: 'POST',
    ip: reader.ip,
    cookie: reader.cookie,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: COMMENT_TEXT }),
  });
  expect(commentRes.status, '前置作業：發表留言應為 200').toBe(200);
  commentId = ((await commentRes.json()) as { comment: { id: string } }).comment.id;
});

afterAll(async () => {
  // 評論、讚與留言皆由級聯一併移除，故清理只需刪作品；
  // 直接對新表下 deleteMany 反而會在實作尚未落地時擲出而中斷清理
  await cleanupNovels(created);
  await resetAuthTables();
});

describe('T053a：未登入對 US2 的七條寫入路徑一律 401 且無任何寫入（FR-002）', () => {
  /** `path` 於執行時才組得出（識別碼在 beforeAll 才有），故以取值函式延後求值 */
  const writeEndpoints: { name: string; path: () => string; method: string; body?: unknown }[] = [
    {
      name: '發表評論 POST /api/novels/{id}/reviews',
      path: () => `/api/novels/${novelId}/reviews`,
      method: 'POST',
      body: { rating: 1, content: '未登入送出的評論' },
    },
    {
      name: '編輯評論 PATCH /api/reviews/{id}',
      path: () => `/api/reviews/${reviewId}`,
      method: 'PATCH',
      body: { rating: 1, content: '未登入改掉的評論' },
    },
    {
      name: '刪除評論 DELETE /api/reviews/{id}',
      path: () => `/api/reviews/${reviewId}`,
      method: 'DELETE',
    },
    {
      name: '按讚 POST /api/reviews/{id}/like',
      path: () => `/api/reviews/${reviewId}/like`,
      method: 'POST',
    },
    {
      name: '取消按讚 DELETE /api/reviews/{id}/like',
      path: () => `/api/reviews/${reviewId}/like`,
      method: 'DELETE',
    },
    {
      name: '發表留言 POST /api/chapters/{id}/comments',
      path: () => `/api/chapters/${chapterId}/comments`,
      method: 'POST',
      body: { content: '未登入送出的留言' },
    },
    {
      name: '刪除留言 DELETE /api/comments/{id}',
      path: () => `/api/comments/${commentId}`,
      method: 'DELETE',
    },
    {
      name: '作者隱藏 PATCH /api/author/comments/{id}',
      path: () => `/api/author/comments/${commentId}`,
      method: 'PATCH',
      body: { hidden: true },
    },
  ];

  it.each(writeEndpoints)('$name → 401 UNAUTHENTICATED 且三張表列數不變', async (endpoint) => {
    const before = await countAll();

    const res = await anonymous(endpoint.path(), endpoint.method, endpoint.body);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('UNAUTHENTICATED');

    expect(await countAll()).toEqual(before);
  });

  it('被指名的那兩列逐欄未被更動（列數不變不代表內容不變）', async () => {
    const review = await prisma.review.findUniqueOrThrow({ where: { id: reviewId } });
    expect(review.content).toBe(REVIEW_TEXT);
    expect(review.rating).toBe(4);
    expect(review.likeCount).toBe(0);
    expect(review.status).toBe('visible');

    const comment = await prisma.comment.findUniqueOrThrow({ where: { id: commentId } });
    expect(comment.content).toBe(COMMENT_TEXT);
    expect(comment.status).toBe('visible');
  });

  it('作者的留言管理列表（GET）未登入同樣回 401 —— 那是作者向資源，不公開', async () => {
    const res = await anonymous('/api/author/comments', 'GET');
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('UNAUTHENTICATED');
  });
});

describe('T053a：未登入的讀取一律放行且內容完整（FR-026、US2 AC7）', () => {
  it('GET /api/chapters/{id}/comments → 200，留言內容完整可讀', async () => {
    const res = await anonymous(`/api/chapters/${chapterId}/comments`, 'GET');
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      items: { id: string; content: string }[];
      nextCursor: string | null;
    };
    const found = json.items.find((c) => c.id === commentId);
    expect(found, '未登入訪客 MUST 讀得到留言').toBeDefined();
    expect(found?.content).toBe(COMMENT_TEXT);
    expect(json.nextCursor).toBeNull();
  });

  it('GET /api/novels/{id}/reviews → 200，評論內容完整可讀', async () => {
    const res = await anonymous(`/api/novels/${novelId}/reviews`, 'GET');
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      items: { id: string; content: string; likedByMe: boolean }[];
    };
    const found = json.items.find((r) => r.id === reviewId);
    expect(found, '未登入訪客 MUST 讀得到評論').toBeDefined();
    expect(found?.content).toBe(REVIEW_TEXT);
    // 未登入時 likedByMe 固定為 false，且 MUST NOT 因此多發一次查詢（契約 §1）
    expect(found?.likedByMe).toBe(false);
  });

  it('登入與未登入看到的是同一份內容 —— 只有送出入口需要身分，讀取不需要', async () => {
    const anon = await anonymous(`/api/chapters/${chapterId}/comments`, 'GET');
    const authed = await testFetch(`/api/chapters/${chapterId}/comments`, {
      method: 'GET',
      ip: IP,
      cookie: reader.cookie,
    });
    expect(authed.status).toBe(200);

    const idsOf = async (res: Response): Promise<string[]> =>
      ((await res.json()) as { items: { id: string }[] }).items.map((c) => c.id);
    expect(await idsOf(authed)).toEqual(await idsOf(anon));
  });
});
