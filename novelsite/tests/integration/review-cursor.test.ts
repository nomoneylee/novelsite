import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { testFetch } from '../helpers/client';
import { resetAuthTables } from '../helpers/resetAuthTables';
import { createAccount, createPublishedNovel, cleanupNovels } from '../helpers/fixtures';

/**
 * T048：評論列表的伺服器排序與複合游標分頁（FR-023a、FR-023b、US2 AC13）
 * ========================================================================
 * 分頁的漏洞不會出現在「每一頁都有東西」，而出現在**同分處的接縫**：
 * `likeCount DESC` 沒有 `id ASC` 決勝時，同讚數的五則評論在兩次查詢間的相對次序未定義，
 * 於是跨頁時有的被送兩次、有的一次都沒送到。故本檔的資料刻意做出兩組平手：
 * 五種讚數各五則（`hot` 的接縫）、五個時刻各五則（`latest` 的接縫）。
 *
 * 資料以資料存取層外的直接寫入建立，理由有二：
 * (1) 一人一評使「同一部作品的 25 則評論」必然要 25 個帳號，逐一走 HTTP 發表只是把
 *     這個檔案變成一個限流測試；
 * (2) 平手是本檔的主題，而 `likeCount` 與 `createdAt` 的**精確值**只有直接寫入控制得住。
 * 識別碼一併明確指定（`feat4-rv-00`…）：決勝鍵是 `id ASC`，用隨機 cuid 的話「次序穩定」
 * 這件事就只能靠巧合成立。
 */

const IP = '10.95.1.1';
const TOTAL = 25;
const NOVEL_TITLE = 'FEAT-4 T048 評論分頁';

let author: { id: string };
let novelId: string;
const created: { authorId: string; novelId: string }[] = [];

interface Seeded {
  id: string;
  likeCount: number;
  createdAt: Date;
}

const seeded: Seeded[] = [];

/** 依契約排序：主鍵降冪，同值時 `id` 升冪 */
function expectedOrder(by: 'hot' | 'latest'): string[] {
  return [...seeded]
    .sort((a, b) => {
      const primary =
        by === 'hot' ? b.likeCount - a.likeCount : b.createdAt.getTime() - a.createdAt.getTime();
      if (primary !== 0) return primary;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .map((r) => r.id);
}

async function fetchPage(
  sort: 'hot' | 'latest',
  limit: number,
  cursor: string | null
): Promise<{ ids: string[]; nextCursor: string | null }> {
  const qs = `?sort=${sort}&limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
  const res = await testFetch(`/api/novels/${novelId}/reviews${qs}`, { method: 'GET', ip: IP });
  expect(res.status, `${sort} 分頁請求應為 200`).toBe(200);
  const json = (await res.json()) as { items: { id: string }[]; nextCursor: string | null };
  expect(json.items.length).toBeLessThanOrEqual(limit);
  return { ids: json.items.map((i) => i.id), nextCursor: json.nextCursor };
}

async function pageThrough(sort: 'hot' | 'latest', limit: number): Promise<string[]> {
  const seen: string[] = [];
  let cursor: string | null = null;
  let guard = 0;

  do {
    const page = await fetchPage(sort, limit, cursor);
    seen.push(...page.ids);
    cursor = page.nextCursor;
    guard += 1;
  } while (cursor && guard < 20);

  expect(cursor, '翻完後 nextCursor MUST 為 null').toBeNull();
  return seen;
}

beforeAll(async () => {
  await resetAuthTables();
  author = await createAccount('rev2-author', 'author');
  const novel = await createPublishedNovel({
    authorId: author.id,
    chapterCount: 1,
    title: NOVEL_TITLE,
  });
  novelId = novel.novelId;
  created.push({ authorId: author.id, novelId });

  const base = new Date('2026-08-01T00:00:00.000Z');
  for (let i = 0; i < TOTAL; i++) {
    const reader = await createAccount(`rev2-r${String(i).padStart(2, '0')}`);
    const id = `feat4-rv-${String(i).padStart(2, '0')}`;
    // 讚數依 i % 5 分組、時刻依 floor(i / 5) 分組 —— 兩種分組刻意錯開，
    // 使 hot 與 latest 的正確答案彼此不同（同一個順序兩種排序都對，等於什麼都沒驗）
    const likeCount = i % 5;
    const createdAt = new Date(base.getTime() + Math.floor(i / 5) * 60_000);
    await prisma.review.create({
      data: {
        id,
        novelId,
        userId: reader.id,
        rating: (i % 5) + 1,
        content: `第 ${i} 則評論`,
        likeCount,
        createdAt,
      },
    });
    seeded.push({ id, likeCount, createdAt });
  }
});

afterAll(async () => {
  // 評論與其讚由 `Novel` 的級聯一併移除，故清理只需刪作品；
  // 直接對新表下 deleteMany 反而會在實作尚未落地時擲出而中斷清理
  await cleanupNovels(created);
  await resetAuthTables();
});

describe('T048：hot 與 latest 兩種排序逐頁附加無重複亦無遺漏（US2 AC13）', () => {
  it.each(['hot', 'latest'] as const)(
    'sort=%s：以 limit=7 翻完 25 則，聯集恰為 25 則且無任何重複',
    async (sort) => {
      const seen = await pageThrough(sort, 7);
      expect(seen).toHaveLength(TOTAL);
      expect(new Set(seen).size).toBe(TOTAL);
      expect([...seen].sort()).toEqual(seeded.map((r) => r.id).sort());
    }
  );

  it.each(['hot', 'latest'] as const)(
    'sort=%s：逐頁附加後的完整次序等於契約所訂的排序（同值以 id ASC 決勝）',
    async (sort) => {
      expect(await pageThrough(sort, 7)).toEqual(expectedOrder(sort));
    }
  );

  it.each(['hot', 'latest'] as const)(
    'sort=%s：每頁大小不改變結果 —— limit=4 與 limit=20 翻出的次序完全相同',
    async (sort) => {
      expect(await pageThrough(sort, 4)).toEqual(await pageThrough(sort, 20));
    }
  );
});

describe('T048：同讚數／同時間時次序穩定（FR-023b）', () => {
  it('hot：同讚數的五則以 id ASC 相鄰排列，且不因重複查詢而改變', async () => {
    const first = await pageThrough('hot', 7);
    const second = await pageThrough('hot', 7);
    expect(second).toEqual(first);

    // 五種讚數各佔連續五個位置；每一段內部為 id 升冪
    for (let likeCount = 4; likeCount >= 0; likeCount--) {
      const groupIds = seeded
        .filter((r) => r.likeCount === likeCount)
        .map((r) => r.id)
        .sort();
      const slice = first.slice((4 - likeCount) * 5, (4 - likeCount) * 5 + 5);
      expect(slice, `讚數 ${likeCount} 的區段`).toEqual(groupIds);
    }
  });

  it('latest：同時刻的五則以 id ASC 相鄰排列，且不因重複查詢而改變', async () => {
    const first = await pageThrough('latest', 7);
    const second = await pageThrough('latest', 7);
    expect(second).toEqual(first);

    for (let group = 4; group >= 0; group--) {
      const groupIds = seeded
        .filter((r) => Math.floor(Number(r.id.slice(-2)) / 5) === group)
        .map((r) => r.id)
        .sort();
      const slice = first.slice((4 - group) * 5, (4 - group) * 5 + 5);
      expect(slice, `第 ${group} 個時刻的區段`).toEqual(groupIds);
    }
  });

  it('第一頁重複請求兩次逐則相同（游標未介入時的基準；不穩定的排序在這裡就會露出來）', async () => {
    const a = await fetchPage('hot', 7, null);
    const b = await fetchPage('hot', 7, null);
    expect(b.ids).toEqual(a.ids);
  });
});

describe('T048：首屏不載入全部評論（FR-023a）', () => {
  it('省略 limit 時每頁 20 則且仍有下一頁 —— 25 則不會一次回完', async () => {
    const res = await testFetch(`/api/novels/${novelId}/reviews`, { method: 'GET', ip: IP });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { items: unknown[]; nextCursor: string | null };
    expect(json.items).toHaveLength(20);
    expect(json.nextCursor).not.toBeNull();
  });

  it('省略 sort 時採預設的 hot 排序（切換排序前後看到的是同一份契約）', async () => {
    const res = await testFetch(`/api/novels/${novelId}/reviews?limit=7`, {
      method: 'GET',
      ip: IP,
    });
    const json = (await res.json()) as { items: { id: string }[] };
    expect(json.items.map((i) => i.id)).toEqual(expectedOrder('hot').slice(0, 7));
  });

  it('無效游標 → 400 VALIDATION_ERROR（而非 500 或靜默回空頁）', async () => {
    const res = await testFetch(`/api/novels/${novelId}/reviews?cursor=!!!not-base64!!!`, {
      method: 'GET',
      ip: IP,
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
  });
});
