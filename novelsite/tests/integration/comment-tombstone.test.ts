import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { testFetch, loginAs } from '../helpers/client';
import { resetAuthTables } from '../helpers/resetAuthTables';
import { createAccount, createPublishedNovel, cleanupNovels } from '../helpers/fixtures';

/**
 * T049：刪除留言留下墓碑，他人的回覆不被連坐（FR-027、US2 AC11）
 * ================================================================
 * `Comment.parent` 是級聯刪除，所以「刪除自己的留言」若走 `delete`，
 * 掛在下面的別人的回覆會一起消失 —— 等於用刪自己的內容抹掉別人說過的話。
 * 本檔要證明的正是**沒有走那條路**：該列仍在、狀態為 `deleted`、對外是墓碑，
 * 而子回覆一字不少。
 *
 * 墓碑同時是一個**伺服器端**的規則：`canReply: false` 若只是給前端看的旗標，
 * 直接送 HTTP 就能繞過，故一併驗證伺服器拒絕回覆墓碑。
 */

const TOMBSTONE = '此留言已刪除';
const PARENT_TEXT = '這章的轉折我沒看懂';
const REPLY_TEXT = '第三段有伏筆，回頭看一次就通了';

interface Actor {
  id: string;
  cookie: string;
  ip: string;
}

interface CommentNode {
  id: string;
  content: string;
  canLike: boolean;
  canReply: boolean;
  user: { name: string } | null;
  replies?: CommentNode[];
}

let author: { id: string };
let novelId: string;
let chapterId: string;
const created: { authorId: string; novelId: string }[] = [];
let seq = 0;

async function newReader(label: string): Promise<Actor> {
  seq += 1;
  const ip = `10.96.1.${seq}`;
  const acct = await createAccount(`tomb-${label}`);
  return { id: acct.id, cookie: await loginAs(acct.email, acct.password, ip), ip };
}

function postComment(
  actor: Actor,
  body: { content: string; parentId?: string }
): Promise<Response> {
  return testFetch(`/api/chapters/${chapterId}/comments`, {
    method: 'POST',
    ip: actor.ip,
    cookie: actor.cookie,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function createComment(
  actor: Actor,
  body: { content: string; parentId?: string }
): Promise<string> {
  const res = await postComment(actor, body);
  expect(res.status, `發表留言應為 200，實得 ${res.status}`).toBe(200);
  const json = (await res.json()) as { comment: { id: string } };
  return json.comment.id;
}

async function listComments(cookie?: string): Promise<CommentNode[]> {
  const res = await testFetch(`/api/chapters/${chapterId}/comments`, {
    method: 'GET',
    ip: '10.96.9.1',
    ...(cookie ? { cookie } : {}),
  });
  expect(res.status).toBe(200);
  const json = (await res.json()) as { items: CommentNode[] };
  return json.items;
}

function commentCountOf(): Promise<number> {
  return prisma.novel
    .findUniqueOrThrow({ where: { id: novelId }, select: { commentCount: true } })
    .then((r) => r.commentCount);
}

beforeAll(async () => {
  await resetAuthTables();
  author = await createAccount('tomb-author', 'author');
  const novel = await createPublishedNovel({ authorId: author.id, chapterCount: 1 });
  novelId = novel.novelId;
  chapterId = novel.chapterIds[0];
  created.push({ authorId: author.id, novelId });
});

afterAll(async () => {
  // 留言由 `Chapter` 的級聯一併移除，故清理只需刪作品；
  // 直接對新表下 deleteMany 反而會在實作尚未落地時擲出而中斷清理
  await cleanupNovels(created);
  await resetAuthTables();
});

describe('T049：刪除有回覆的留言 → 墓碑，回覆完整保留', () => {
  it('該列保留、status=deleted、回傳墓碑文案，而他人的回覆一字不少', async () => {
    const parentAuthor = await newReader('parent');
    const replier = await newReader('replier');

    const parentId = await createComment(parentAuthor, { content: PARENT_TEXT });
    const replyId = await createComment(replier, { content: REPLY_TEXT, parentId });

    const before = await commentCountOf();
    const removed = await testFetch(`/api/comments/${parentId}`, {
      method: 'DELETE',
      ip: parentAuthor.ip,
      cookie: parentAuthor.cookie,
    });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ ok: true });

    // ① 該列保留（硬刪除會讓這一行變成 0，而下一行的回覆也會一起不見）
    const parentRow = await prisma.comment.findUnique({ where: { id: parentId } });
    expect(parentRow, '墓碑 MUST 保留該列').not.toBeNull();
    expect(parentRow?.status).toBe('deleted');

    // ② 他人的回覆未被級聯刪除，且內容未被更動
    const replyRow = await prisma.comment.findUnique({ where: { id: replyId } });
    expect(replyRow, '他人的回覆 MUST NOT 被連坐刪除').not.toBeNull();
    expect(replyRow?.status).toBe('visible');
    expect(replyRow?.content).toBe(REPLY_TEXT);
    expect(replyRow?.parentId).toBe(parentId);

    // ③ 對外是墓碑：固定文案、無發言者資訊、不可按讚、不可回覆
    const items = await listComments();
    const tomb = items.find((c) => c.id === parentId);
    expect(tomb, '墓碑 MUST 仍佔據串中位置以維持回覆結構').toBeDefined();
    expect(tomb?.content).toBe(TOMBSTONE);
    expect(tomb?.content).not.toContain(PARENT_TEXT);
    expect(tomb?.user ?? null).toBeNull();
    expect(tomb?.canLike).toBe(false);
    expect(tomb?.canReply).toBe(false);

    // ④ 回覆仍掛在墓碑之下且完整可見
    const reply = tomb?.replies?.find((r) => r.id === replyId);
    expect(reply, '回覆 MUST 仍掛於原位置').toBeDefined();
    expect(reply?.content).toBe(REPLY_TEXT);
    expect(reply?.user?.name).toBeTruthy();

    // ⑤ 留言數同一交易內 −1（contracts/interaction-api.md §2）
    expect(await commentCountOf()).toBe(before - 1);
  });

  it('原文字不再由任何回應路徑外洩 —— 未登入者與留言作者本人看到的都是墓碑', async () => {
    const owner = await newReader('leak');
    const commentId = await createComment(owner, { content: '待會就刪掉這句' });
    expect(
      (
        await testFetch(`/api/comments/${commentId}`, {
          method: 'DELETE',
          ip: owner.ip,
          cookie: owner.cookie,
        })
      ).status
    ).toBe(200);

    for (const cookie of [undefined, owner.cookie]) {
      const items = await listComments(cookie);
      const tomb = items.find((c) => c.id === commentId);
      expect(tomb?.content).toBe(TOMBSTONE);
      expect(JSON.stringify(items)).not.toContain('待會就刪掉這句');
    }
  });

  it('墓碑不可回覆 —— canReply 是伺服器端的規則，直接送 HTTP 一樣被拒', async () => {
    const owner = await newReader('noreply-owner');
    const other = await newReader('noreply-other');

    const commentId = await createComment(owner, { content: '這則等一下會變成墓碑' });
    expect(
      (
        await testFetch(`/api/comments/${commentId}`, {
          method: 'DELETE',
          ip: owner.ip,
          cookie: owner.cookie,
        })
      ).status
    ).toBe(200);

    const before = await prisma.comment.count({ where: { chapterId } });
    const res = await postComment(other, { content: '回覆一個墓碑', parentId: commentId });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
    expect(await prisma.comment.count({ where: { chapterId } })).toBe(before);
  });
});

describe('T049：發表留言的計數與樓層結構（contracts §2）', () => {
  it('發表一則留言 → Novel.commentCount +1（+1 與 −1 MUST 成對，否則計數會走負）', async () => {
    const reader = await newReader('count');
    const before = await commentCountOf();
    await createComment(reader, { content: '留個言看看計數' });
    expect(await commentCountOf()).toBe(before + 1);
  });

  it('回覆掛於父留言之下，MUST NOT 同時出現在頂層', async () => {
    const a = await newReader('thread-a');
    const b = await newReader('thread-b');

    const parentId = await createComment(a, { content: '頂層留言' });
    const replyId = await createComment(b, { content: '掛在下面的回覆', parentId });

    const items = await listComments();
    expect(
      items.some((c) => c.id === replyId),
      '回覆 MUST NOT 出現在頂層'
    ).toBe(false);
    const parent = items.find((c) => c.id === parentId);
    expect(parent?.replies?.map((r) => r.id)).toContain(replyId);
  });
});
