import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import net from 'node:net';
import { prisma } from '@/lib/db';
import { IMPORT_LIMITS } from '@/lib/validation/chapterImport';
import { MAX_LENGTH } from '@/lib/validation/common';
import { testFetch, loginAs, baseUrl } from '../helpers/client';
import { anyCategoryId, createAuthor, cleanupAuthoring, TEST_PREFIX } from '../helpers/authoring';
import type { TestAuthor } from '../helpers/authoring';

/**
 * US4：三項上限與 `Content-Length` 守衛（FEAT-7 T041–T043）
 * ========================================================
 * 因 FR-016a 明訂不另設限流，這三項上限是資源面的**唯一**防線。
 *
 * 一律打**真實端點**：`Content-Length` 判定只存在於 Route Handler，
 * 直接呼叫服務層等於把 FR-017b 整條排除在驗收之外。
 *
 * **總大小的兩案自行序列化 multipart 而非交給 `fetch` 代勞**：
 * 「剛好貼齊 50 MB」要的是**請求主體恰為 52,428,800 位元組**，
 * 而 `fetch(body: FormData)` 的邊界字串由 undici 隨機產生、長度不由呼叫端決定 ——
 * 差幾個位元組就落在上限的另一邊，而那正是這一組案例唯一要問的事。
 */

const IP = '10.70.2.1';

let author: TestAuthor;
let cookie: string;

interface Target {
  novelId: string;
  volumeId: string;
}

/** 建立「作品 + 一個**空的**卷」。斷言以「該作品的章節列數」為準，故每案各用一部作品 */
async function createEmptyVolume(label: string): Promise<Target> {
  const categoryId = await anyCategoryId();
  const novelId = `${TEST_PREFIX}novel-${label}`;
  const volumeId = `${TEST_PREFIX}volume-${label}`;

  await prisma.novel.create({
    data: {
      id: novelId,
      title: `上限測試作品 ${label}`,
      authorId: author.id,
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

/** 指定位元組數的 `.md` 檔（ASCII 內容，位元組數即字元數） */
function mdFileOfBytes(filename: string, bytes: number): File {
  return mdFile(filename, 'a'.repeat(bytes));
}

/**
 * `FormData` → 實際會上線的位元組。`new Response(form)` 用的是與 `fetch` 同一套
 * undici 序列化器，故拿到的邊界與位元組數就是真正送出去的那一份。
 */
async function serialize(form: FormData): Promise<{ body: ArrayBuffer; contentType: string }> {
  const res = new Response(form);
  const contentType = res.headers.get('content-type')!;
  // `ArrayBuffer` 而非 `Buffer`／`Uint8Array`：`BodyInit` 的 `BufferSource` 在本專案的
  // TypeScript 版本下只收得下 `ArrayBuffer` 這一支
  return { body: await res.arrayBuffer(), contentType };
}

/**
 * 序列化為**恰好 `targetBytes`** 的請求主體：先量一次空的填充欄，再以差額補足。
 * 填充欄名不是 `files`，端點的 `form.getAll('files')` 不會撿到它 ——
 * 它撐的是「請求主體大小」，而 FR-017b 判的正是這個數字。
 */
async function serializeExact(
  files: File[],
  targetBytes: number
): Promise<{ body: ArrayBuffer; contentType: string }> {
  const build = (padding: string): FormData => {
    const form = new FormData();
    for (const file of files) form.append('files', file, file.name);
    form.append('padding', padding);
    return form;
  };

  const probe = await serialize(build(''));
  const needed = targetBytes - probe.body.byteLength;
  if (needed < 0) {
    throw new Error(
      `serializeExact：檔案本身已 ${probe.body.byteLength} 位元組，超過目標 ${targetBytes}`
    );
  }
  const exact = await serialize(build('p'.repeat(needed)));
  if (exact.body.byteLength !== targetBytes) {
    throw new Error(`serializeExact：實得 ${exact.body.byteLength} 位元組，預期 ${targetBytes}`);
  }
  return exact;
}

/** 以既定的位元組主體打端點。`Content-Length` 由 undici 自主體長度填入 */
async function postRaw(
  volumeId: string,
  payload: { body: ArrayBuffer; contentType: string }
): Promise<Response> {
  return testFetch(`/api/author/volumes/${volumeId}/chapters/import`, {
    method: 'POST',
    ip: IP,
    cookie,
    headers: { 'content-type': payload.contentType },
    body: payload.body,
  });
}

async function postFiles(volumeId: string, files: File[]): Promise<Response> {
  const form = new FormData();
  for (const file of files) form.append('files', file, file.name);
  return testFetch(`/api/author/volumes/${volumeId}/chapters/import`, {
    method: 'POST',
    ip: IP,
    cookie,
    body: form,
  });
}

async function messageOf(res: Response): Promise<string> {
  const parsed = (await res.json()) as { error?: { message?: string } };
  return parsed.error?.message ?? '';
}

beforeAll(async () => {
  await cleanupAuthoring();
  author = await createAuthor('limits');
  cookie = await loginAs(author.email, author.password, IP);
});

afterAll(async () => {
  await cleanupAuthoring();
});

describe('T041 檔案數上限（FR-017、FR-018）', () => {
  it('1001 個檔案被拒，訊息同時含實際值與上限值', async () => {
    const target = await createEmptyVolume('count-over');
    const files = Array.from({ length: IMPORT_LIMITS.maxFiles + 1 }, (_, i) =>
      mdFile(`第${i + 1}章_測試.md`, `第 ${i + 1} 章正文。`)
    );

    const res = await postFiles(target.volumeId, files);
    expect(res.status).toBe(400);

    const message = await messageOf(res);
    expect(message).toContain(String(IMPORT_LIMITS.maxFiles + 1));
    expect(message).toContain(String(IMPORT_LIMITS.maxFiles));
    // **批次級判定 MUST NOT 指名任何檔案**：超標的是總數，指哪一個都是誤導
    expect(message).not.toContain('.md');

    expect(await prisma.chapter.count({ where: { novelId: target.novelId } })).toBe(0);
  }, 120_000);

  // **剛好貼齊上限（1000 個）的那一案由 T043 的上界壓測擔任**（FEAT-7 T041 實作裁示，2026-08-22）：
  // 兩者的請求與斷言完全重疊 —— T043 送的就是 1000 個檔案，且斷言全數落地。
  // 各寫一次的唯一差別是把最貴的那一趟跑兩遍。
});

describe('T041 單檔上限（FR-017、FR-018、FR-019）', () => {
  it('1 MB + 1 位元組的檔案被拒，訊息指名該檔並含實際值與上限值', async () => {
    const target = await createEmptyVolume('file-over');
    const filename = '第1章_過大.md';
    const size = IMPORT_LIMITS.maxFileBytes + 1;

    const res = await postFiles(target.volumeId, [mdFileOfBytes(filename, size)]);
    expect(res.status).toBe(400);

    const message = await messageOf(res);
    // FR-019：逐檔判定類 MUST 指名來源檔
    expect(message).toContain(filename);
    expect(message).toContain(String(size));
    expect(message).toContain(String(IMPORT_LIMITS.maxFileBytes));

    expect(await prisma.chapter.count({ where: { novelId: target.novelId } })).toBe(0);
  }, 120_000);

  /**
   * **剛好 1 MB 的檔案 MUST NOT 被單檔上限擋下** —— 它被擋是因為正文超長，不是因為檔案大。
   *
   * 這一案讀起來像是在測失敗，其實它鎖的是 FR-017a(a)「任何合法章節都不會被大小上限誤擋」：
   * 章節正文上限為 100,000 **字元**，而 UTF-8 每字元至少 1 位元組 ——
   * **恰為 1 MB 的檔案在字元數上必然早已超過 100,000**，故它永遠走不到成功那條路
   * （FEAT-7 T041 實作裁示，2026-08-22：原任務只寫「剛好貼齊上限一案」，
   * 照字面寫成「預期 200」的測試不可能綠，而最省事的修法是把單檔上限改成不判斷）。
   * 判準因此是**擋它的是哪一道**：訊息 MUST 是正文超長，MUST NOT 是單檔超限。
   */
  it('剛好 1 MB 的檔案不被單檔上限擋下（改由正文長度判定，FR-020）', async () => {
    const target = await createEmptyVolume('file-at');
    const filename = '第1章_貼齊.md';

    const res = await postFiles(target.volumeId, [
      mdFileOfBytes(filename, IMPORT_LIMITS.maxFileBytes),
    ]);
    expect(res.status).toBe(400);

    const message = await messageOf(res);
    expect(message).toContain(filename);
    expect(message).toContain(String(MAX_LENGTH.chapterBody));
    expect(message).not.toContain('單檔');

    expect(await prisma.chapter.count({ where: { novelId: target.novelId } })).toBe(0);
  }, 120_000);
});

describe('T041 總大小上限（FR-017、FR-017b、FR-018）', () => {
  /** 五個合法章節檔，主體其餘部分以填充欄補到指定位元組數 */
  function fiveChapters(): File[] {
    return [1, 2, 3, 4, 5].map((n) => mdFile(`第${n}章_測試第${n}章.md`, `第 ${n} 章的正文。`));
  }

  it('請求主體恰為 50 MB 時照常匯入 —— 上限是包含的', async () => {
    const target = await createEmptyVolume('total-at');
    const payload = await serializeExact(fiveChapters(), IMPORT_LIMITS.maxTotalBytes);
    expect(payload.body.byteLength).toBe(IMPORT_LIMITS.maxTotalBytes);

    const res = await postRaw(target.volumeId, payload);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await res.json()) as { created: number }).created).toBe(5);

    expect(await prisma.chapter.count({ where: { novelId: target.novelId } })).toBe(5);
  }, 180_000);

  it('請求主體為 50 MB + 1 位元組時被拒，訊息含實際值與上限值且不指名任何檔案', async () => {
    const target = await createEmptyVolume('total-over');
    const oversize = IMPORT_LIMITS.maxTotalBytes + 1;
    const payload = await serializeExact(fiveChapters(), oversize);

    const res = await postRaw(target.volumeId, payload);
    expect(res.status).toBe(400);

    const message = await messageOf(res);
    expect(message).toContain(String(oversize));
    expect(message).toContain(String(IMPORT_LIMITS.maxTotalBytes));
    // **批次級判定 MUST NOT 指名任何檔案**：超標的是總量，指哪一個都是誤導
    expect(message).not.toContain('.md');

    expect(await prisma.chapter.count({ where: { novelId: target.novelId } })).toBe(0);
  }, 180_000);
});

/**
 * T042：`Content-Length` 守衛（FR-017b、research R-11）
 * ====================================================
 * 這兩案 MUST 走**原始 socket**：要驗的是「**宣告** 60 MB 但一個位元組的主體都還沒送」
 * 與「根本沒有 `Content-Length`」，而 `fetch` 兩者都不允許 ——
 * 主體長度由它自己填，chunked 也由它自己決定。
 */
function rawRequest(opts: {
  path: string;
  headers: Record<string, string>;
  body: Buffer;
}): Promise<{ status: number; body: string }> {
  const url = new URL(baseUrl());

  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: url.hostname, port: Number(url.port) });
    let received = Buffer.alloc(0);

    const head = [
      `POST ${opts.path} HTTP/1.1`,
      `Host: ${url.host}`,
      // 回應讀完即收工；少了它連線會停在 keep-alive 上，測試看起來像是伺服器沒回話
      'Connection: close',
      ...Object.entries(opts.headers).map(([key, value]) => `${key}: ${value}`),
      '',
      '',
    ].join('\r\n');

    const finish = () => {
      const separator = received.indexOf('\r\n\r\n');
      if (separator === -1) {
        reject(new Error(`rawRequest：回應不含完整標頭：${received.toString('utf8')}`));
        return;
      }
      const headText = received.subarray(0, separator).toString('utf8');
      const status = Number(/^HTTP\/1\.[01] (\d{3})/.exec(headText)?.[1] ?? 0);
      resolve({ status, body: received.subarray(separator + 4).toString('utf8') });
    };

    socket.on('error', reject);
    socket.on('data', (chunk: Buffer) => {
      received = Buffer.concat([received, chunk]);
    });
    socket.on('close', finish);
    socket.on('connect', () => {
      socket.write(head);
      if (opts.body.byteLength > 0) socket.write(opts.body);
      // **刻意不送滿宣告的長度**：伺服器若要等主體收齊才判定，這裡就會停在等待上
    });
  });
}

describe('T042 Content-Length 守衛（FR-017b）', () => {
  const CONTENT_TYPE = 'multipart/form-data; boundary=----novelsiteLimitTest';

  it('宣告長度超過 50 MB 時，在緩衝完整內容之前即被拒絕', async () => {
    const target = await createEmptyVolume('cl-over');
    const declared = 60_000_000;
    const startedAt = Date.now();

    const res = await rawRequest({
      path: `/api/author/volumes/${target.volumeId}/chapters/import`,
      headers: {
        'Content-Type': CONTENT_TYPE,
        'Content-Length': String(declared),
        Origin: baseUrl(),
        'X-Forwarded-For': IP,
        // **刻意不帶 Cookie**：本關排在身分驗證之前，故未登入者得到的是 400 而非 401
        // （契約 §1.5）。這一案同時是那個順序的驗收
      },
      // 宣告 60 MB，實際只送這幾十個位元組
      body: Buffer.from('------novelsiteLimitTest\r\n', 'utf8'),
    });

    expect(res.status).toBe(400);
    expect(res.body).toContain(String(IMPORT_LIMITS.maxTotalBytes));
    // 伺服器若先緩衝再判定，這裡會停在等待剩餘的 59.9 MB 上
    expect(Date.now() - startedAt).toBeLessThan(10_000);
  }, 60_000);

  it('缺 Content-Length 的請求同樣被拒 —— MUST NOT「缺了就跳過檢查」', async () => {
    const target = await createEmptyVolume('cl-missing');

    const res = await rawRequest({
      path: `/api/author/volumes/${target.volumeId}/chapters/import`,
      headers: {
        'Content-Type': CONTENT_TYPE,
        // 無 Content-Length；以 chunked 傳輸，那正是「跳過檢查」會放行的形態
        'Transfer-Encoding': 'chunked',
        Origin: baseUrl(),
        'X-Forwarded-For': IP,
      },
      body: Buffer.from('0\r\n\r\n', 'utf8'),
    });

    expect(res.status).toBe(400);
    expect(res.body).toContain('Content-Length');
  }, 60_000);
});

describe('T043 上界壓測：1000 章（FR-012、FR-013、research R-3）', () => {
  it('1000 章於交易 timeout 內全數落地，且作品計數與匯入前相同', async () => {
    const target = await createEmptyVolume('stress');
    const before = await prisma.novel.findUniqueOrThrow({
      where: { id: target.novelId },
      select: { chapterCount: true, wordCount: true },
    });

    const files = Array.from({ length: IMPORT_LIMITS.maxFiles }, (_, i) =>
      mdFile(`第${i + 1}章_壓測第${i + 1}章.md`, `第 ${i + 1} 章的正文內容，供上界壓測使用。`)
    );

    const startedAt = Date.now();
    const res = await postFiles(target.volumeId, files);
    const elapsedMs = Date.now() - startedAt;
    // 供 T015 的交易 timeout 取值參考（30 秒）；MUST NOT 拿它當斷言 ——
    // 機器快慢不同，斷言在別人的機器上會變成擲骰子
    console.log(`[T043] 1000 章匯入耗時 ${elapsedMs} ms`);

    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as { created: number; numbers: number[] };
    expect(body.created).toBe(IMPORT_LIMITS.maxFiles);
    expect(body.numbers[0]).toBe(1);
    expect(body.numbers[body.numbers.length - 1]).toBe(IMPORT_LIMITS.maxFiles);

    expect(await prisma.chapter.count({ where: { novelId: target.novelId } })).toBe(
      IMPORT_LIMITS.maxFiles
    );
    expect(
      await prisma.chapterContent.count({
        where: { chapter: { novelId: target.novelId } },
      })
    ).toBe(IMPORT_LIMITS.maxFiles);

    // **計數與匯入前相同才是正確結果**（FR-013）：匯入產出全為草稿，
    // 而 `refreshNovelCounters` 只彙總已發佈章節
    const after = await prisma.novel.findUniqueOrThrow({
      where: { id: target.novelId },
      select: { chapterCount: true, wordCount: true },
    });
    expect(after).toEqual(before);
  }, 300_000);
});
