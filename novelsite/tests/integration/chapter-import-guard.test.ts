import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { testFetch, loginAs } from '../helpers/client';
import { waitForImportLogs } from '../helpers/serverLog';
import {
  anyCategoryId,
  createAuthor,
  createReader,
  cleanupAuthoring,
  TEST_PREFIX,
} from '../helpers/authoring';
import type { TestAuthor } from '../helpers/authoring';

/**
 * US2：授權邊界（FEAT-7 T028–T031a）
 * ==================================
 * 實作已於 Phase 2（T013／T014）落地 —— 憲章第 II 條不允許存在「先能動、之後補鎖」的
 * 寫入路徑。**本檔的工作是證明它成立**，以及核對錯誤語意與既有作者寫入路徑完全一致。
 *
 * 一律打**真實端點**：來源比對、`Content-Type`／`Content-Length` 判定與匯入紀錄
 * 都只存在於 Route Handler，繞過它等於把 FR-015a、FR-016b、FR-017b 排除在驗收之外。
 *
 * **「回 4xx」與「沒有寫入」是兩件事**：只驗狀態碼時，一個先寫入再回 403 的實作
 * 也會全綠。四種拒絕皆一併斷言資料庫零新增列。
 */

const OWNER_IP = '10.70.2.1';
const OTHER_IP = '10.70.2.2';
const READER_IP = '10.70.2.3';

/** 跨站來源。**MUST 與測試伺服器的 host 不同**，否則 `assertSameOrigin` 會通過 */
const EVIL_ORIGIN = 'https://evil.example.com';

let owner: TestAuthor;
let other: TestAuthor;
let reader: TestAuthor;
let ownerCookie: string;
let otherCookie: string;
let readerCookie: string;

interface Target {
  novelId: string;
  volumeId: string;
}

/** 建立「作品 + 一個空的卷」，歸屬於指定作者 */
async function createEmptyVolume(label: string, authorId: string): Promise<Target> {
  const categoryId = await anyCategoryId();
  const novelId = `${TEST_PREFIX}novel-${label}`;
  const volumeId = `${TEST_PREFIX}volume-${label}`;

  await prisma.novel.create({
    data: {
      id: novelId,
      title: `授權測試作品 ${label}`,
      authorId,
      coverColor: 'linear-gradient(135deg, #1a0533 0%, #4a1942 40%, #8b2fc9 100%)',
      categoryId,
      wordCount: 0,
      chapterCount: 0,
      rating: 0,
      excerpt: '整合測試用的作品簡介。',
      status: 'draft',
    },
  });
  await prisma.volume.create({ data: { id: volumeId, number: 1, title: '第一卷', novelId } });

  return { novelId, volumeId };
}

function mdFile(filename: string, body: string): File {
  return new File([new TextEncoder().encode(body)], filename, { type: 'text/markdown' });
}

/** 三個合法來源檔 —— 內容本身無可挑剔，被擋下的只會是授權 */
function validFiles(): FormData {
  const form = new FormData();
  for (const n of [1, 2, 3]) {
    const file = mdFile(`第${n}章_授權測試第${n}章.md`, `第 ${n} 章正文。`);
    form.append('files', file, file.name);
  }
  return form;
}

function importPath(volumeId: string): string {
  return `/api/author/volumes/${volumeId}/chapters/import`;
}

type FetchInit = Parameters<typeof testFetch>[1];

/** 合法的 multipart 匯入請求（`Content-Type` 與 `Content-Length` 皆由 fetch 自行補齊） */
function importFiles(
  volumeId: string,
  opts: { ip: string; cookie?: string; origin?: string }
): Promise<Response> {
  return testFetch(importPath(volumeId), {
    method: 'POST',
    ip: opts.ip,
    cookie: opts.cookie,
    ...(opts.origin ? { headers: { Origin: opts.origin } } : {}),
    body: validFiles(),
  });
}

/**
 * 以 chunked 傳輸送出 —— **這是唯一能讓請求不帶 `Content-Length` 的方式**：
 * 任何已知長度的 body（字串、`FormData`、TypedArray）fetch 都會自行補上該標頭。
 */
function chunkedBodyInit(): { body: unknown; duplex: string } {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('x'));
      controller.close();
    },
  });
  // `duplex` 是 undici 對串流 body 的必填項，尚未進到 TypeScript 的 `RequestInit` 定義
  return { body, duplex: 'half' };
}

async function chapterRowsOf(novelId: string): Promise<{ chapters: number; contents: number }> {
  const [chapters, contents] = await Promise.all([
    prisma.chapter.count({ where: { novelId } }),
    prisma.chapterContent.count({ where: { chapter: { novelId } } }),
  ]);
  return { chapters, contents };
}

beforeAll(async () => {
  await cleanupAuthoring();
  owner = await createAuthor('guard-owner');
  other = await createAuthor('guard-other');
  reader = await createReader('guard-reader');
  ownerCookie = await loginAs(owner.email, owner.password, OWNER_IP);
  otherCookie = await loginAs(other.email, other.password, OTHER_IP);
  readerCookie = await loginAs(reader.email, reader.password, READER_IP);
});

afterAll(async () => {
  await cleanupAuthoring();
});

describe('T028 四種拒絕（FR-015、FR-016、契約 §1.3／§1.5）', () => {
  it('未登入 → 401 UNAUTHENTICATED「請先登入」，且資料庫零新增列', async () => {
    const target = await createEmptyVolume('anon', owner.id);

    const res = await importFiles(target.volumeId, { ip: OWNER_IP });
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHENTICATED');
    // T031：與既有作者寫入路徑逐字相同（`requireAuthorForAction`）
    expect(body.error.message).toBe('請先登入');
    // FR-019 只涵蓋逐檔判定類的錯誤；授權錯誤發生在讀取任何檔案之前，MUST NOT 指名來源檔
    expect(body.error.message).not.toContain('.md');

    expect(await chapterRowsOf(target.novelId)).toEqual({ chapters: 0, contents: 0 });
  });

  it('讀者角色 → 403 FORBIDDEN「此操作僅限作者」，且資料庫零新增列', async () => {
    const target = await createEmptyVolume('reader', owner.id);

    const res = await importFiles(target.volumeId, { ip: READER_IP, cookie: readerCookie });
    expect(res.status).toBe(403);

    const body = await res.json();
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.message).toBe('此操作僅限作者');
    expect(body.error.message).not.toContain('.md');

    expect(await chapterRowsOf(target.novelId)).toEqual({ chapters: 0, contents: 0 });
  });

  it('非擁有者 → 404 NOT_FOUND「找不到指定的資源」，且資料庫零新增列', async () => {
    const target = await createEmptyVolume('notowner', owner.id);

    // **MUST 是 404 而非 403**：403 等於告訴對方「這個 volumeId 是有效的，只是不是你的」，
    // 而作者的作品清單本身就是需要保護的資訊（FR-016、契約 §1.5）
    const res = await importFiles(target.volumeId, { ip: OTHER_IP, cookie: otherCookie });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toBe('找不到指定的資源');
    expect(body.error.message).not.toContain('.md');

    expect(await chapterRowsOf(target.novelId)).toEqual({ chapters: 0, contents: 0 });
  });

  it('跨站 Origin → 403「請求來源不被信任」，且資料庫零新增列', async () => {
    const target = await createEmptyVolume('crosssite', owner.id);

    // 借擁有者的 Cookie 從別的網站發請求 —— 身分與擁有權都會通過，擋下它的只有來源比對
    const res = await importFiles(target.volumeId, {
      ip: OWNER_IP,
      cookie: ownerCookie,
      origin: EVIL_ORIGIN,
    });
    expect(res.status).toBe(403);

    const body = await res.json();
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.message).toBe('請求來源不被信任');

    expect(await chapterRowsOf(target.novelId)).toEqual({ chapters: 0, contents: 0 });
  });
});

describe('T029 不存在與他人所有不可區分（FR-016）', () => {
  it('對不存在的 volumeId 與對他人的 volumeId，狀態碼與回應主體逐位元組相同', async () => {
    const foreign = await createEmptyVolume('foreign', other.id);
    const missingVolumeId = `${TEST_PREFIX}volume-does-not-exist`;

    const resMissing = await importFiles(missingVolumeId, { ip: OWNER_IP, cookie: ownerCookie });
    const resForeign = await importFiles(foreign.volumeId, { ip: OWNER_IP, cookie: ownerCookie });

    expect(resMissing.status).toBe(404);
    expect(resForeign.status).toBe(resMissing.status);

    const bytesMissing = Buffer.from(await resMissing.arrayBuffer());
    const bytesForeign = Buffer.from(await resForeign.arrayBuffer());
    // 先比字串：不相同時的失敗訊息看得出差在哪
    expect(bytesForeign.toString('utf8')).toBe(bytesMissing.toString('utf8'));
    expect(bytesForeign.equals(bytesMissing)).toBe(true);

    expect(await chapterRowsOf(foreign.novelId)).toEqual({ chapters: 0, contents: 0 });
  });
});

describe('T030 守衛早於身分驗證（FR-015a、契約 §1.4／§1.5）', () => {
  it('(a) 跨站來源 + 未登入 → 403 而非 401', async () => {
    const target = await createEmptyVolume('order-origin', owner.id);

    // `assertSameOrigin` 擋的是「借使用者的 Cookie 從別的網站發請求」，那種請求的
    // 身分驗證會通過 —— 排到身分之後等於先讓它過了第一關
    const res = await importFiles(target.volumeId, { ip: OWNER_IP, origin: EVIL_ORIGIN });
    expect(res.status).toBe(403);
    expect((await res.json()).error.message).toBe('請求來源不被信任');
  });

  it('(b) 合法來源 + 未登入 + 缺 Content-Type → 400 而非 401', async () => {
    const target = await createEmptyVolume('order-ctype', owner.id);

    // TypedArray body：fetch **不會**替它補 `Content-Type`，但會補 `Content-Length`，
    // 故這一案確實停在第 2 步
    const res = await testFetch(importPath(target.volumeId), {
      method: 'POST',
      ip: OWNER_IP,
      body: new Uint8Array([1, 2, 3]),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
  });

  it('(b) 合法來源 + 未登入 + 缺 Content-Length → 400 而非 401', async () => {
    const target = await createEmptyVolume('order-clen', owner.id);

    // 這一步是 FR-017b「緩衝完整內容之前依宣告長度拒絕」的唯一著力點，
    // 排到身分之後就得先把 50 MB 收下來。**沒有這一案，日後有人「修正」成先驗身分時
    // 不會有任何東西變紅**，而症狀是上限防線整條失效
    const res = await testFetch(importPath(target.volumeId), {
      method: 'POST',
      ip: OWNER_IP,
      headers: { 'Content-Type': 'multipart/form-data; boundary=----guardtest' },
      ...chunkedBodyInit(),
    } as unknown as FetchInit);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('Content-Length');
  });
});

describe('T031a 匯入紀錄的出口覆蓋（FR-016b、SC-007、契約 §1.4 第 8 步）', () => {
  it('五種出口各記錄恰一行，欄位恰 9 個，身分驗證前的三種 actorId／novelId 為 null', async () => {
    const target = await createEmptyVolume('logouts', owner.id);

    // 五種出口依序各送一次。**同一個卷**：紀錄以 `volumeId` 過濾，
    // 「恰一行」才有比對的基準
    const crossSite = await importFiles(target.volumeId, {
      ip: OWNER_IP,
      cookie: ownerCookie,
      origin: EVIL_ORIGIN,
    });
    expect(crossSite.status).toBe(403);

    const noContentType = await testFetch(importPath(target.volumeId), {
      method: 'POST',
      ip: OWNER_IP,
      body: new Uint8Array([1, 2, 3]),
    });
    expect(noContentType.status).toBe(400);

    const noContentLength = await testFetch(importPath(target.volumeId), {
      method: 'POST',
      ip: OWNER_IP,
      headers: { 'Content-Type': 'multipart/form-data; boundary=----logtest' },
      ...chunkedBodyInit(),
    } as unknown as FetchInit);
    expect(noContentLength.status).toBe(400);

    const anonymous = await importFiles(target.volumeId, { ip: OWNER_IP });
    expect(anonymous.status).toBe(401);

    const success = await importFiles(target.volumeId, { ip: OWNER_IP, cookie: ownerCookie });
    expect(success.status, await success.clone().text()).toBe(200);

    const records = await waitForImportLogs(target.volumeId, 5);

    // **恰五行**：多一行代表某個出口記了兩次，那會讓 FR-016a 的分組計數失準
    expect(records).toHaveLength(5);
    expect(records.map((row) => row.result)).toEqual([
      'origin_rejected',
      'bad_request',
      'bad_request',
      'unauthenticated',
      'ok',
    ]);

    const EXPECTED_FIELDS = [
      'actorId',
      'at',
      'durationMs',
      'event',
      'fileCount',
      'novelId',
      'result',
      'totalBytes',
      'volumeId',
    ];
    for (const record of records) {
      // data-model §2.4：輸出恰 9 欄（7 個入參 + `event` + `at`）
      expect(Object.keys(record).sort()).toEqual(EXPECTED_FIELDS);
      expect(record.volumeId).toBe(target.volumeId);
    }

    // 前三種發生在身分驗證之前：兩欄 MUST 為 null，且**MUST 仍出現在輸出中** ——
    // 略過整筆記錄的，正好是被擋在門外的請求，而那些才是異常流量的樣子
    for (const record of records.slice(0, 3)) {
      expect(record).toHaveProperty('actorId', null);
      expect(record).toHaveProperty('novelId', null);
    }

    // 未登入同樣取不到身分；成功出口兩欄皆有值
    expect(records[3].actorId).toBeNull();
    expect(records[4].actorId).toBe(owner.id);
    expect(records[4].novelId).toBe(target.novelId);
  });
});
