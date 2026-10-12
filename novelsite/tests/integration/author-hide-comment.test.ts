import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { testFetch, loginAs } from '../helpers/client';
import { resetAuthTables } from '../helpers/resetAuthTables';
import { createAccount, createPublishedNovel, cleanupNovels } from '../helpers/fixtures';

/**
 * T051：作者可以隱藏，但不能竄改（FR-030～FR-032、US2 AC9／AC10）
 * ================================================================
 * 這一刀的驗收有兩個彼此獨立的面：
 *
 * 1. **隱藏要真的隱藏** —— 含**留言作者本人**也看不到。讓發言者看得到、其他人看不到，
 *    會使兩邊看到不同的事實，於是「我的留言被吃掉了」與「我沒看到你說什麼」同時成立
 *    而無人能查證（spec Edge Case）。
 * 2. **內容要逐字不變** —— `content` 欄位在整個流程前後 MUST 完全相同。
 *    本檔連「請求裡挾帶 `content`」都試一次：簽章裡沒有這個參數是實作的事，
 *    而端點吃不吃這個欄位是**對外的保證**，只有從 HTTP 這一側送進去才驗得到。
 */

const ORIGINAL = '這段劇情跟第二卷的設定對不上，作者是不是忘了？';

interface Actor {
  id: string;
  cookie: string;
  ip: string;
}

interface CommentNode {
  id: string;
  content: string;
  replies?: CommentNode[];
}

let ownerAuthor: Actor;
let otherAuthor: Actor;
let reader: Actor;
let novelId: string;
let chapterId: string;
const created: { authorId: string; novelId: string }[] = [];
let seq = 0;

async function newActor(label: string, role: 'reader' | 'author' = 'reader'): Promise<Actor> {
  seq += 1;
  const ip = `10.98.1.${seq}`;
  const acct = await createAccount(`hide-${label}`, role);
  return { id: acct.id, cookie: await loginAs(acct.email, acct.password, ip), ip };
}

async function createComment(content = ORIGINAL): Promise<string> {
  const res = await testFetch(`/api/chapters/${chapterId}/comments`, {
    method: 'POST',
    ip: reader.ip,
    cookie: reader.cookie,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  expect(res.status, '前置作業：發表留言應為 200').toBe(200);
  return ((await res.json()) as { comment: { id: string } }).comment.id;
}

function setHidden(actor: Actor, commentId: string, body: unknown): Promise<Response> {
  return testFetch(`/api/author/comments/${commentId}`, {
    method: 'PATCH',
    ip: actor.ip,
    cookie: actor.cookie,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function visibleIds(cookie?: string): Promise<string[]> {
  const res = await testFetch(`/api/chapters/${chapterId}/comments`, {
    method: 'GET',
    ip: '10.98.9.1',
    ...(cookie ? { cookie } : {}),
  });
  expect(res.status).toBe(200);
  const json = (await res.json()) as { items: CommentNode[] };
  const flat: string[] = [];
  for (const item of json.items) {
    flat.push(item.id);
    for (const reply of item.replies ?? []) flat.push(reply.id);
  }
  return flat;
}

function rowOf(commentId: string) {
  return prisma.comment.findUniqueOrThrow({ where: { id: commentId } });
}

beforeAll(async () => {
  await resetAuthTables();
  ownerAuthor = await newActor('owner-author', 'author');
  otherAuthor = await newActor('other-author', 'author');
  reader = await newActor('reader');

  const novel = await createPublishedNovel({ authorId: ownerAuthor.id, chapterCount: 1 });
  novelId = novel.novelId;
  chapterId = novel.chapterIds[0];
  created.push({ authorId: ownerAuthor.id, novelId });

  // 第二位作者要有自己的作品，否則「他人作品下的留言」被拒可能只是因為角色不足
  const other = await createPublishedNovel({ authorId: otherAuthor.id, chapterCount: 1 });
  created.push({ authorId: otherAuthor.id, novelId: other.novelId });
});

afterAll(async () => {
  // 留言由 `Chapter` 的級聯一併移除，故清理只需刪作品；
  // 直接對新表下 deleteMany 反而會在實作尚未落地時擲出而中斷清理
  await cleanupNovels(created);
  await resetAuthTables();
});

describe('T051：隱藏後讀者端與留言作者本人皆不顯示（FR-030、US2 AC9）', () => {
  it('隱藏 → 未登入者、其他讀者、留言作者本人三種身分都看不到；資料列的 content 逐字未變', async () => {
    const commentId = await createComment();
    expect(await visibleIds()).toContain(commentId);

    const res = await setHidden(ownerAuthor, commentId, { hidden: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    for (const [label, cookie] of [
      ['未登入訪客', undefined],
      ['留言作者本人', reader.cookie],
      ['作品的作者', ownerAuthor.cookie],
    ] as const) {
      expect(await visibleIds(cookie), `${label} MUST NOT 看到被隱藏的留言`).not.toContain(
        commentId
      );
    }

    const row = await rowOf(commentId);
    expect(row.status).toBe('hidden');
    expect(row.content, '隱藏，不是竄改：content MUST 逐字未變更').toBe(ORIGINAL);
  });

  it('取消隱藏 → 讀者端再次可見，content 仍逐字未變', async () => {
    const commentId = await createComment();
    expect((await setHidden(ownerAuthor, commentId, { hidden: true })).status).toBe(200);
    expect(await visibleIds()).not.toContain(commentId);

    expect((await setHidden(ownerAuthor, commentId, { hidden: false })).status).toBe(200);
    expect(await visibleIds()).toContain(commentId);

    const row = await rowOf(commentId);
    expect(row.status).toBe('visible');
    expect(row.content).toBe(ORIGINAL);
  });

  it('被隱藏的留言不會從任何回應中外洩原文', async () => {
    const commentId = await createComment('這句話會被隱藏，MUST NOT 出現在任何回應裡');
    expect((await setHidden(ownerAuthor, commentId, { hidden: true })).status).toBe(200);

    const res = await testFetch(`/api/chapters/${chapterId}/comments`, {
      method: 'GET',
      ip: '10.98.9.2',
      cookie: reader.cookie,
    });
    expect(await res.text()).not.toContain('這句話會被隱藏');
  });
});

describe('T051：作者無任何可改動內容的入口（FR-031、US2 AC9）', () => {
  it('請求裡挾帶 content → 內容 MUST NOT 因此被改寫', async () => {
    const commentId = await createComment();

    // 狀態碼不強斷言：把未知欄位剝除後照常隱藏（200）或整個請求被拒（400）都可接受，
    // 唯一不可接受的是資料庫裡的那句話被換掉。
    await setHidden(ownerAuthor, commentId, { hidden: true, content: '作者改寫過的內容' });

    const row = await rowOf(commentId);
    expect(row.content).toBe(ORIGINAL);
    expect(row.content).not.toContain('作者改寫過的內容');
  });

  it('只送 content、不送 hidden → 內容仍未變（本端點只寫 status）', async () => {
    const commentId = await createComment();

    await setHidden(ownerAuthor, commentId, { content: '只想偷改字' });

    const row = await rowOf(commentId);
    expect(row.content).toBe(ORIGINAL);
  });
});

describe('T051：對他人作品下的留言執行隱藏一律被拒（FR-032、US2 AC10）', () => {
  it('另一位作者隱藏 → 403，且 status 與 content 皆未變更', async () => {
    const commentId = await createComment();
    const before = await rowOf(commentId);

    const res = await setHidden(otherAuthor, commentId, { hidden: true });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('FORBIDDEN');

    const after = await rowOf(commentId);
    expect(after.status).toBe(before.status);
    expect(after.content).toBe(ORIGINAL);
    expect(await visibleIds()).toContain(commentId);
  });

  it('一般讀者（非作者角色）隱藏 → 一樣被拒且資料未變更', async () => {
    const commentId = await createComment();

    const res = await setHidden(reader, commentId, { hidden: true });
    expect(res.status).toBe(403);

    const row = await rowOf(commentId);
    expect(row.status).toBe('visible');
    expect(row.content).toBe(ORIGINAL);
  });
});
