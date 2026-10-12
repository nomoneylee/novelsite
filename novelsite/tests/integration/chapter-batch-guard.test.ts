import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { loginAs } from '../helpers/client';
import { callAction, hasErrorCode } from '../helpers/serverAction';
import { waitForBatchLogs } from '../helpers/serverLog';
import {
  createAuthor,
  addVolume,
  cleanupAuthoring,
  anyCategoryId,
  snapshotNovel,
  TEST_PREFIX,
  type TestAuthor,
} from '../helpers/authoring';
import { ServiceError } from '@/lib/services/errors';
import { publishChapters, deleteChapters } from '@/lib/services/chapterBatchService';
import { toChapterRanges, formatChapterRanges } from '@/lib/chapterBatch/ranges';

/**
 * FEAT-8 US3：授權邊界（T035–T038）
 * ==================================
 * 實作已於 T010／T014／T027 落地（共用守衛 ＋ 每一個寫入語句的 `where` 帶 `volumeId`）——
 * 憲章第 II 條不允許存在「先能動、之後補鎖」的寫入路徑。
 * **本檔的工作是證明那條邊界成立**：沒有這四案，守衛寫錯不會有任何東西變紅。
 *
 * **受測層級**（tasks.md 開頭的判準）：
 *
 * | 斷言的東西 | 層級 | 本檔的案 |
 * |---|---|---|
 * | 未登入 401、角色不足 403、結構化紀錄的任何一欄 | **Action 端點**（`callAction`） | T035 前二案、T038 |
 * | 擁有權、卷歸屬、資料庫零變動 | **服務層直呼** | T035 後二案、T036、T037 |
 *
 * 前二案 MUST 打端點：那兩個出口由 `requireAuthorForAction()` 在 **Action 層**擲出，
 * **服務層直呼永遠到不了**。
 *
 * **「回 4xx」與「沒有寫入」是兩件事**：只驗錯誤碼時，一個先寫入再回錯的實作
 * 也會全綠。故每一案都一併斷言資料庫零變動。
 *
 * 本檔專屬位址前綴：`10.132.*`
 */

const OWNER_ROLE_IP = '10.132.1.1';
const OWNER_AUTH_IP = '10.132.1.2';
const LOG_OWNER_IP = '10.132.1.3';
const LOG_INTRUDER_IP = '10.132.1.4';
const LOG_ROLE_IP = '10.132.1.5';
const LOG_AUTH_IP = '10.132.1.6';

let owner: TestAuthor;
let intruder: TestAuthor;
let ownerNovelId: string;
let intruderNovelId: string;
let managePath: string;

let seq = 0;

async function createNovelFor(authorId: string, label: string): Promise<string> {
  const novelId = `${TEST_PREFIX}novel-${label}`;
  await prisma.novel.create({
    data: {
      id: novelId,
      title: `批次授權測試作品 ${label}`,
      authorId,
      coverColor: 'linear-gradient(135deg, #1a0533 0%, #4a1942 40%, #8b2fc9 100%)',
      categoryId: await anyCategoryId(),
      wordCount: 0,
      chapterCount: 0,
      rating: 0,
      excerpt: '整合測試用的作品簡介。',
      status: 'published',
    },
  });
  return novelId;
}

/** 建立 n 章草稿。前置資料經 Prisma 直接建置（同 `helpers/authoring.ts` 的判準） */
async function makeChapters(
  novelId: string,
  volumeId: string,
  count: number
): Promise<{ id: string; number: number }[]> {
  const rows = Array.from({ length: count }, () => {
    seq += 1;
    return {
      id: `${TEST_PREFIX}bg-${Date.now().toString(36)}-${seq}`,
      novelId,
      volumeId,
      number: seq,
      title: `授權測試第 ${seq} 章`,
      wordCount: 10,
      status: 'draft',
      publishedAt: null,
      scheduledAt: null,
    };
  });
  await prisma.chapter.createMany({ data: rows });
  return rows.map((r) => ({ id: r.id, number: r.number }));
}

async function newVolume(novelId: string): Promise<string> {
  seq += 1;
  return addVolume(novelId, seq);
}

/**
 * 取出服務層擲出的 `ServiceError`。
 *
 * 呼叫成功時 MUST 自行擲錯：`rejects.toThrow()` 只證明「有擲東西」，
 * 而本檔要比對的是**錯誤碼與訊息逐字相同**。
 */
async function captureServiceError(fn: () => Promise<unknown>): Promise<ServiceError> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof ServiceError) return err;
    throw err;
  }
  throw new Error('預期被拒絕，但呼叫成功了 —— 授權邊界沒有成立');
}

beforeAll(async () => {
  await cleanupAuthoring();
  owner = await createAuthor('batch-guard-owner');
  intruder = await createAuthor('batch-guard-intruder');
  ownerNovelId = await createNovelFor(owner.id, 'batch-guard-owner');
  intruderNovelId = await createNovelFor(intruder.id, 'batch-guard-intruder');
  managePath = `/author/novels/${ownerNovelId}`;
}, 120_000);

afterAll(async () => {
  await cleanupAuthoring();
});

// ─────────────────────────────────────────
// T035：授權四拒
// ─────────────────────────────────────────

describe('T035：未登入與角色不足 —— MUST 由 Action 層擋下（FR-023）', () => {
  let volumeId: string;
  let chapterIds: string[];
  let before: string;

  beforeAll(async () => {
    volumeId = await newVolume(ownerNovelId);
    chapterIds = (await makeChapters(ownerNovelId, volumeId, 3)).map((c) => c.id);
    before = await snapshotNovel(ownerNovelId);
  }, 60_000);

  /**
   * 只以 reader 身分 POST 到 `/author/*` 證明不了任何事 —— `proxy.ts` 會先回 302，
   * Action 根本沒被叫到。故沿用 `author-role-guard.test.ts` 的手法：
   * 先以 author 身分登入取得帶 `role=author` 快照的憑證，再把 DB 角色降為 reader ——
   * proxy 看快照放行，Action 覆核 DB 後 MUST 自己擋下。
   */
  it('角色不足：兩個批次 Action 皆回 FORBIDDEN（非 302），且資料零變動', async () => {
    const cookie = await loginAs(owner.email, owner.password, OWNER_ROLE_IP);
    await prisma.user.update({ where: { id: owner.id }, data: { role: 'reader' } });
    try {
      for (const name of ['publishChaptersAction', 'deleteChaptersAction']) {
        const res = await callAction(name, [{ volumeId, chapterIds }], {
          ip: OWNER_ROLE_IP,
          cookie,
          route: managePath,
        });
        expect(res.status, '收到 302 代表擋下它的是 proxy，這一則就沒驗到 Action').not.toBe(302);
        expect(
          hasErrorCode(res, 'FORBIDDEN'),
          `${name} 未回 FORBIDDEN：${res.text.slice(0, 400)}`
        ).toBe(true);
      }
    } finally {
      await prisma.user.update({ where: { id: owner.id }, data: { role: 'author' } });
    }
    expect(await snapshotNovel(ownerNovelId)).toBe(before);
  }, 60_000);

  it('未登入：工作階段已於 DB 撤銷 → 兩個 Action 皆回 UNAUTHENTICATED，且資料零變動', async () => {
    const cookie = await loginAs(owner.email, owner.password, OWNER_AUTH_IP);
    await prisma.session.updateMany({
      where: { userId: owner.id },
      data: { revokedAt: new Date() },
    });

    for (const name of ['publishChaptersAction', 'deleteChaptersAction']) {
      const res = await callAction(name, [{ volumeId, chapterIds }], {
        ip: OWNER_AUTH_IP,
        cookie,
        route: managePath,
      });
      expect(res.status).not.toBe(302);
      expect(
        hasErrorCode(res, 'UNAUTHENTICATED'),
        `${name} 未回 UNAUTHENTICATED：${res.text.slice(0, 400)}`
      ).toBe(true);
    }
    expect(await snapshotNovel(ownerNovelId)).toBe(before);
  }, 60_000);
});

describe('T035：非擁有者與卷不存在 —— 兩者的回應 MUST 逐字不可區分（FR-022）', () => {
  let volumeId: string;
  let chapterIds: string[];
  let before: string;

  beforeAll(async () => {
    volumeId = await newVolume(ownerNovelId);
    chapterIds = (await makeChapters(ownerNovelId, volumeId, 3)).map((c) => c.id);
    before = await snapshotNovel(ownerNovelId);
  }, 60_000);

  for (const [label, run] of [
    ['批次發佈', publishChapters],
    ['批次刪除', deleteChapters],
  ] as const) {
    it(`${label}：非擁有者與卷不存在皆回 NOT_FOUND，訊息逐字相同，且資料零變動`, async () => {
      const notOwner = await captureServiceError(() => run(intruder.id, { volumeId, chapterIds }));
      const missingVolume = await captureServiceError(() =>
        run(owner.id, { volumeId: `${TEST_PREFIX}no-such-volume`, chapterIds })
      );

      expect(notOwner.code).toBe('NOT_FOUND');
      expect(missingVolume.code).toBe('NOT_FOUND');
      // 差異本身就是洩漏 —— 作者的草稿清單正是需要保護的資訊
      expect(notOwner.message).toBe(missingVolume.message);
      expect(await snapshotNovel(ownerNovelId)).toBe(before);
    }, 60_000);
  }
});

// ─────────────────────────────────────────
// T036：批次內夾入他人章節 → 整批失敗
// ─────────────────────────────────────────

describe('T036：9 章屬己 ＋ 1 章屬人 → 整批失敗，那 9 章未被部分執行（FR-021）', () => {
  for (const [label, run] of [
    ['批次發佈', publishChapters],
    ['批次刪除', deleteChapters],
  ] as const) {
    it(`${label}：整批被拒，己方 9 章 100% 與操作前相同`, async () => {
      const volumeId = await newVolume(ownerNovelId);
      const mine = await makeChapters(ownerNovelId, volumeId, 9);
      const theirVolumeId = await newVolume(intruderNovelId);
      const [theirs] = await makeChapters(intruderNovelId, theirVolumeId, 1);

      const before = await snapshotNovel(ownerNovelId);

      const err = await captureServiceError(() =>
        run(owner.id, { volumeId, chapterIds: [...mine.map((c) => c.id), theirs.id] })
      );
      expect(err.code).toBe('NOT_FOUND');

      // 部分執行的實作會讓這裡出現 9 章已發佈（或 9 章已消失）
      expect(await snapshotNovel(ownerNovelId)).toBe(before);
      expect(await prisma.chapter.count({ where: { volumeId } })).toBe(9);
      expect(await prisma.chapter.count({ where: { id: theirs.id } })).toBe(1);
    }, 60_000);
  }
});

// ─────────────────────────────────────────
// T037：跨卷（同一作品的第 2 卷）→ 整批失敗
// ─────────────────────────────────────────

describe('T037：批次指明第 1 卷卻夾入同作品第 2 卷的章節 → 整批失敗（FR-021a）', () => {
  for (const [label, run] of [
    ['批次發佈', publishChapters],
    ['批次刪除', deleteChapters],
  ] as const) {
    it(`${label}：整批被拒、零變動，且回應與擁有權失敗逐字不可區分`, async () => {
      const firstVolumeId = await newVolume(ownerNovelId);
      const secondVolumeId = await newVolume(ownerNovelId);
      const first = await makeChapters(ownerNovelId, firstVolumeId, 3);
      const [second] = await makeChapters(ownerNovelId, secondVolumeId, 1);

      const before = await snapshotNovel(ownerNovelId);

      const crossVolume = await captureServiceError(() =>
        run(owner.id, {
          volumeId: firstVolumeId,
          chapterIds: [...first.map((c) => c.id), second.id],
        })
      );
      // 「限單一卷」是伺服器端不變量，不是前端慣例
      const notOwner = await captureServiceError(() =>
        run(intruder.id, { volumeId: firstVolumeId, chapterIds: first.map((c) => c.id) })
      );

      expect(crossVolume.code).toBe('NOT_FOUND');
      expect(crossVolume.message).toBe(notOwner.message);
      expect(await snapshotNovel(ownerNovelId)).toBe(before);
    }, 60_000);
  }
});

// ─────────────────────────────────────────
// T038：結構化紀錄的出口覆蓋（FR-028／FR-028a）
// ─────────────────────────────────────────

describe('T038：五種出口各恰一行紀錄（FR-028、SC-008）', () => {
  let volumeId: string;
  let chapters: { id: string; number: number }[];
  let since: string;
  let records: Awaited<ReturnType<typeof waitForBatchLogs>>;

  /**
   * 五種出口逐一走一遍，**全案經 `callAction` 打 Action 端點** ——
   * `logBatchEvent` 落在 Action 層，服務層直呼看不到任何一行。
   *
   * 過濾 MUST 用 `since` ＋ `operation` 而非 `volumeId`：
   * 未登入與角色不足那兩行的 `volumeId` 為 `null`（`readBatchRef` 排在守衛之後），
   * 用 `volumeId` 濾會**恰好漏掉**最該被驗證的兩行。
   */
  beforeAll(async () => {
    volumeId = await newVolume(ownerNovelId);
    chapters = await makeChapters(ownerNovelId, volumeId, 3);
    const chapterIds = chapters.map((c) => c.id);

    const ownerCookie = await loginAs(owner.email, owner.password, LOG_OWNER_IP);
    since = new Date().toISOString();

    // (1) ok
    await callAction('publishChaptersAction', [{ volumeId, chapterIds }], {
      ip: LOG_OWNER_IP,
      cookie: ownerCookie,
      route: managePath,
    });

    // (2) validation_error：超過 1000 章的上限
    await callAction(
      'publishChaptersAction',
      [{ volumeId, chapterIds: Array.from({ length: 1001 }, (_, i) => `${TEST_PREFIX}x-${i}`) }],
      { ip: LOG_OWNER_IP, cookie: ownerCookie, route: managePath }
    );

    // (3) not_found：已登入的作者動了別人的卷
    const intruderCookie = await loginAs(intruder.email, intruder.password, LOG_INTRUDER_IP);
    await callAction('publishChaptersAction', [{ volumeId, chapterIds }], {
      ip: LOG_INTRUDER_IP,
      cookie: intruderCookie,
      route: managePath,
    });

    // (4) forbidden：憑證快照仍是 author，DB 角色已降為 reader
    const roleCookie = await loginAs(intruder.email, intruder.password, LOG_ROLE_IP);
    await prisma.user.update({ where: { id: intruder.id }, data: { role: 'reader' } });
    try {
      await callAction('publishChaptersAction', [{ volumeId, chapterIds }], {
        ip: LOG_ROLE_IP,
        cookie: roleCookie,
        route: managePath,
      });
    } finally {
      await prisma.user.update({ where: { id: intruder.id }, data: { role: 'author' } });
    }

    // (5) unauthenticated：工作階段已於 DB 撤銷
    const authCookie = await loginAs(intruder.email, intruder.password, LOG_AUTH_IP);
    await prisma.session.updateMany({
      where: { userId: intruder.id },
      data: { revokedAt: new Date() },
    });
    await callAction('publishChaptersAction', [{ volumeId, chapterIds }], {
      ip: LOG_AUTH_IP,
      cookie: authCookie,
      route: managePath,
    });

    records = await waitForBatchLogs({ since, operation: 'publish' }, 5);
  }, 180_000);

  it('五種出口各恰一行，且沒有多出來的第六行', () => {
    expect(records).toHaveLength(5);
    expect([...records.map((r) => r.result)].sort()).toEqual(
      ['forbidden', 'not_found', 'ok', 'unauthenticated', 'validation_error'].sort()
    );
  });

  it('未登入與角色不足：actorId／novelId／volumeId 皆為 null，且該三欄仍在輸出中', () => {
    for (const result of ['unauthenticated', 'forbidden'] as const) {
      const record = records.find((r) => r.result === result)!;
      // 略過的正好是被擋在門外的請求，而那些才是異常流量的樣子
      expect(Object.keys(record)).toEqual(
        expect.arrayContaining(['actorId', 'novelId', 'volumeId'])
      );
      expect(record.actorId, `${result} 的 actorId`).toBeNull();
      expect(record.novelId, `${result} 的 novelId`).toBeNull();
      expect(record.volumeId, `${result} 的 volumeId`).toBeNull();
      expect(record.chapterCount, `${result} 的 chapterCount`).toBe(0);
    }
  });

  it('非擁有者：actorId 為實際發起者的 uid（novelId 仍為 null）', () => {
    const record = records.find((r) => r.result === 'not_found')!;
    // 擁有權判定發生在身分驗證**之後** —— 這一行少了 actorId 就答不出「誰動了別人的作品」
    expect(record.actorId).toBe(intruder.id);
    expect(record.novelId).toBeNull();
    expect(record.volumeId).toBe(volumeId);
  });

  it('超限：result 為 validation_error，chapterCount 為去重後的實際筆數', () => {
    const record = records.find((r) => r.result === 'validation_error')!;
    expect(record.actorId).toBe(owner.id);
    expect(record.novelId).toBeNull();
    expect(record.chapterCount).toBe(1001);
  });

  it('成功：ranges 逐字等於 formatChapterRanges 對該批章號的輸出（FR-028a）', () => {
    const record = records.find((r) => r.result === 'ok')!;
    expect(record.actorId).toBe(owner.id);
    expect(record.novelId).toBe(ownerNovelId);
    expect(record.volumeId).toBe(volumeId);
    expect(record.chapterCount).toBe(3);
    expect(record.ranges).toBe(formatChapterRanges(toChapterRanges(chapters.map((c) => c.number))));
  });
});
