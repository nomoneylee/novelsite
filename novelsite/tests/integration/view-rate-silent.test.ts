import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { testFetch } from '../helpers/client';
import { resetAuthTables } from '../helpers/resetAuthTables';
import { createAccount, createPublishedNovel } from '../helpers/fixtures';
import { deleteNovelOwned } from '@/lib/repositories';

/**
 * T087：閱讀上報超額後的「靜默捨棄」（FR-035a、contracts/analytics-scheduling-api.md §1）
 * =====================================================================================
 * 限流本身不稀奇，稀奇的是**它的回應必須說謊**：超額的上報回 `{ ok: true }`、不寫入明細。
 *
 * 為什麼不能回 429 —— 兩個理由，缺一不可：
 *  1. 回 429 等於把門檻直接告訴對方：連打到出現 429 的那一次就是上限，
 *     之後每分鐘打 N−1 次即可長期灌水。**能被測出來的門檻等於沒有門檻**。
 *  2. 上報是閱讀頁背景送出的請求，正常讀者快速翻頁也可能撞到；
 *     回錯誤只會在真讀者的主控台留下一排紅字，而他什麼也沒做錯。
 *
 * 因此本檔的斷言不是「有沒有被擋」，而是**「擋與沒擋看不出差別」**：
 * 同狀態碼、同主體、同回應標頭集合、無 `Retry-After`。
 * 唯一能證明限流真的生效的是資料庫那一側 —— 明細沒有增加。
 *
 * **超額探針 MUST 打一個沒被上報過的章節**：若拿耗額度用的那一章來探，
 * 去重窗口本來就會擋下它，於是一個完全沒有限流的實作也會通過這個測試。
 * 探針章節搭配「換一個位址就寫得進去」的對照組，才把原因釘在限流而非別的關卡。
 */

const MAX = env.CHAPTER_VIEW_RATE_MAX;

/** 耗盡額度的來源位址；MUST 專屬本檔，與其他測試共用會讓額度提前被別人用掉 */
const FLOODER_IP = '10.87.7.7';
const CLEAN_IP = '10.87.8.8';
const BASELINE_IP = '10.87.9.9';

let author: { id: string };
let novelId: string;
/** 0 = 耗額度用、1 = 超額探針、2 = 正常回應的比對基準 */
let chapterIds: string[];

function reportView(chapterId: string, ip: string): Promise<Response> {
  return testFetch(`/api/chapters/${chapterId}/view`, {
    method: 'POST',
    ip,
    headers: { 'User-Agent': 'FEAT4-RateSilent-UA/1.0' },
  });
}

/** 回應標頭名稱集合（排除必然逐次不同的 `date`），用於「無可區分差異」的比對 */
function headerNames(res: Response): string[] {
  return [...res.headers.keys()].filter((name) => name !== 'date').sort();
}

function viewCount(chapterId: string): Promise<number> {
  return prisma.chapterView.count({ where: { chapterId } });
}

beforeAll(async () => {
  await resetAuthTables();
  author = await createAccount('ratesilent-author', 'author');
  const novel = await createPublishedNovel({ authorId: author.id, chapterCount: 3 });
  novelId = novel.novelId;
  chapterIds = novel.chapterIds;
  await prisma.chapterView.deleteMany({ where: { novelId } });
});

afterAll(async () => {
  await prisma.chapterView.deleteMany({ where: { novelId } });
  await deleteNovelOwned(author.id, novelId);
  await resetAuthTables();
});

describe('T087：超額上報與正常上報無可區分差異，且明細不再增加', () => {
  /** 正常情況的回應樣貌，於耗盡額度**之前**取得（換一個乾淨的位址，不影響 flooder 的額度） */
  let baselineStatus: number;
  let baselineBody: unknown;
  let baselineHeaderNames: string[];
  let baselineContentType: string | null;

  /** 額度耗盡後、對「從未被上報過的章節」送出的那一次 */
  let overLimitStatus: number;
  let overLimitBody: unknown;
  let overLimitHeaderNames: string[];
  let overLimitContentType: string | null;
  let overLimitRetryAfter: string | null;

  beforeAll(async () => {
    // 1) 基準：乾淨位址、乾淨章節 —— 這是「被正常記錄」時的回應
    const baseline = await reportView(chapterIds[2], BASELINE_IP);
    baselineStatus = baseline.status;
    baselineHeaderNames = headerNames(baseline);
    baselineContentType = baseline.headers.get('content-type');
    baselineBody = await baseline.json();

    // 2) 以 flooder 位址打滿額度。全部打在同一章，去重會讓其中只有第一次寫入明細，
    //    但限流的計數是**每一次請求**都算 —— 兩者的差別正是下一步要驗的
    for (let i = 0; i < MAX; i++) {
      await reportView(chapterIds[0], FLOODER_IP);
    }

    // 3) 超額探針：同一位址、但打一個從未被上報過的章節（去重擋不住它）
    const overLimit = await reportView(chapterIds[1], FLOODER_IP);
    overLimitStatus = overLimit.status;
    overLimitHeaderNames = headerNames(overLimit);
    overLimitContentType = overLimit.headers.get('content-type');
    overLimitRetryAfter = overLimit.headers.get('retry-after');
    overLimitBody = await overLimit.json();
  }, 120_000);

  it('狀態碼與正常情況相同（MUST NOT 為 429，亦 MUST NOT 為任何錯誤碼）', () => {
    expect(baselineStatus).toBe(200);
    expect(overLimitStatus).toBe(baselineStatus);
    expect(overLimitStatus).not.toBe(429);
  });

  it('回應主體與正常情況逐字相同', () => {
    expect(baselineBody).toEqual({ ok: true });
    expect(overLimitBody).toEqual(baselineBody);
  });

  it('回應標頭集合與正常情況相同，且不含 Retry-After', () => {
    expect(overLimitRetryAfter).toBeNull();
    expect(overLimitContentType).toBe(baselineContentType);
    expect(overLimitHeaderNames).toEqual(baselineHeaderNames);
  });

  it('超額的那一次 MUST NOT 寫入明細（限流真的生效）', async () => {
    expect(await viewCount(chapterIds[1])).toBe(0);
  });

  it('額度用盡前已寫入的明細不受影響（限流是拒收新的，不是回滾舊的）', async () => {
    // 打滿額度的 MAX 次全在同一章，其中第一次寫入、其餘被去重擋下
    expect(await viewCount(chapterIds[0])).toBe(1);
  });

  it('限流鍵為來源位址：換一個位址上報同一章節，明細立刻寫得進去', async () => {
    const res = await reportView(chapterIds[1], CLEAN_IP);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    // 這是把上一案的原因釘在「限流」而非「章節不可上報」的對照組
    expect(await viewCount(chapterIds[1])).toBe(1);
  });

  it('超額後持續上報仍一律回成功且明細不再增加（門檻無法由回應差異測出）', async () => {
    const before = await prisma.chapterView.count({ where: { novelId } });

    const results: { status: number; body: unknown; retryAfter: string | null }[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await reportView(chapterIds[2], FLOODER_IP);
      results.push({
        status: res.status,
        body: await res.json(),
        retryAfter: res.headers.get('retry-after'),
      });
    }

    for (const r of results) {
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ ok: true });
      expect(r.retryAfter).toBeNull();
    }
    expect(await prisma.chapterView.count({ where: { novelId } })).toBe(before);
  });
});
