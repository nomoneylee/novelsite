import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { publishChapter } from '@/lib/services/chapterService';
import { stripControlChars } from '@/lib/validation/common';
import { testFetch, loginAs } from '../helpers/client';
import { anyCategoryId, createAuthor, cleanupAuthoring, TEST_PREFIX } from '../helpers/authoring';
import type { TestAuthor } from '../helpers/authoring';

/**
 * US1：一次匯入整卷章節（FEAT-7 T024–T027）
 * ==========================================
 * 一律打**真實端點**而非直接呼叫服務層：`Content-Length` 判定、multipart 解析與
 * 匯入紀錄都只存在於 Route Handler，繞過它等於把 FR-017b 與 FR-016b 排除在驗收之外。
 *
 * 每一個案例用**自己的作品與卷**：全有全無與撞號的斷言都以「該作品的章節列數」為準，
 * 共用一部作品會讓前一案的殘留決定後一案的結果。
 */

const IP = '10.70.1.1';

let author: TestAuthor;
let cookie: string;

interface Target {
  novelId: string;
  volumeId: string;
}

/** 建立「作品 + 一個**空的**卷」。`createNovelWithChapter` 會附一章，本檔的斷言要的是空卷 */
async function createEmptyVolume(label: string): Promise<Target> {
  const categoryId = await anyCategoryId();
  const novelId = `${TEST_PREFIX}novel-${label}`;
  const volumeId = `${TEST_PREFIX}volume-${label}`;

  await prisma.novel.create({
    data: {
      id: novelId,
      title: `匯入測試作品 ${label}`,
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

/** 正文樣板。刻意夾一個控制字元（U+0007），用來證明入庫前確實走了淨化（FR-007） */
function sourceBody(n: number): string {
  return `第 ${n} 章第一段。\u0007\n\n第 ${n} 章第二段。`;
}

/** 五個合法來源檔 */
function fiveChapters(): File[] {
  return [1, 2, 3, 4, 5].map((n) => mdFile(`第${n}章_測試第${n}章.md`, sourceBody(n)));
}

async function importFiles(volumeId: string, files: File[], ip: string): Promise<Response> {
  const form = new FormData();
  for (const file of files) form.append('files', file, file.name);
  return testFetch(`/api/author/volumes/${volumeId}/chapters/import`, {
    method: 'POST',
    ip,
    cookie,
    body: form,
  });
}

async function chapterCountOf(novelId: string): Promise<number> {
  return prisma.chapter.count({ where: { novelId } });
}

async function countersOf(novelId: string): Promise<{ chapterCount: number; wordCount: number }> {
  const novel = await prisma.novel.findUniqueOrThrow({
    where: { id: novelId },
    select: { chapterCount: true, wordCount: true },
  });
  return novel;
}

beforeAll(async () => {
  await cleanupAuthoring();
  author = await createAuthor('import');
  cookie = await loginAs(author.email, author.password, IP);
});

afterAll(async () => {
  await cleanupAuthoring();
});

describe('T024 主路徑：5 檔 → 5 章草稿（FR-005、FR-007、FR-009、FR-013）', () => {
  it('建立 5 章草稿，正文經同一組淨化後逐字相同，且作品計數不變', async () => {
    const target = await createEmptyVolume('main');
    const before = await countersOf(target.novelId);
    const files = fiveChapters();

    const res = await importFiles(target.volumeId, files, IP);
    expect(res.status, await res.clone().text()).toBe(200);

    const body = await res.json();
    expect(body.created).toBe(5);
    expect(body.numbers).toEqual([1, 2, 3, 4, 5]);

    const chapters = await prisma.chapter.findMany({
      where: { novelId: target.novelId },
      orderBy: { number: 'asc' },
      select: {
        number: true,
        title: true,
        status: true,
        publishedAt: true,
        scheduledAt: true,
        volumeId: true,
        content: { select: { bodyMarkdown: true } },
      },
    });

    expect(chapters).toHaveLength(5);
    for (const [index, chapter] of chapters.entries()) {
      const n = index + 1;
      expect(chapter.number).toBe(n);
      expect(chapter.title).toBe(`測試第${n}章`);
      expect(chapter.volumeId).toBe(target.volumeId);
      // FR-009：匯入產出一律草稿，且不帶排程時刻
      expect(chapter.status).toBe('draft');
      expect(chapter.publishedAt).toBeNull();
      expect(chapter.scheduledAt).toBeNull();
      // FR-007：與單章路徑同一組淨化。`stripControlChars` 是 `sanitizeBody` 的內層，
      // 兩者輸出逐字相同（等價由 tests/unit/chapterImport-parse.test.ts 鎖死）
      expect(chapter.content?.bodyMarkdown).toBe(stripControlChars(sourceBody(n)));
      expect(chapter.content?.bodyMarkdown).not.toContain('\u0007');
    }

    // **計數與匯入前相同才是正確結果**（FR-013／FR-013a）：`chapterCount`／`wordCount`
    // 只彙總 `status='published'`，而匯入產出全為草稿。
    // 斷言「數字要變大」的話，讓它變綠的唯一作法是改掉 published-only 語意 —— FR-013a 禁止
    const after = await countersOf(target.novelId);
    expect(after).toEqual(before);
    expect(body.chapterCount).toBe(before.chapterCount);
    expect(body.wordCount).toBe(before.wordCount);
  });

  it('把其中 1 章以既有單章發佈路徑發佈後，計數才變動 —— 證明計數沒壞，只是語意如此', async () => {
    const target = await createEmptyVolume('publish');
    const res = await importFiles(target.volumeId, fiveChapters(), IP);
    expect(res.status).toBe(200);

    const before = await countersOf(target.novelId);
    const chapter = await prisma.chapter.findFirstOrThrow({
      where: { novelId: target.novelId, number: 3 },
      select: { id: true, wordCount: true },
    });

    await publishChapter(author.id, { chapterId: chapter.id });

    const after = await countersOf(target.novelId);
    expect(after.chapterCount).toBe(before.chapterCount + 1);
    expect(after.wordCount).toBe(before.wordCount + chapter.wordCount);
  });
});

describe('T025 全有全無（FR-012、SC-004）', () => {
  it('批次中夾一個必然失敗的項目 → 資料庫零新增列、作品計數不變', async () => {
    const target = await createEmptyVolume('allornone');
    const before = await countersOf(target.novelId);

    const files = [
      mdFile('第1章_合法一章.md', '正文一。'),
      // 檔名不符「第N章_標題.md」慣例 → 逐列 error（FR-005a）
      mdFile('隨手記.md', '這不是章節。'),
      mdFile('第2章_合法二章.md', '正文二。'),
    ];

    const res = await importFiles(target.volumeId, files, IP);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    // FR-019：逐檔判定類的錯誤 MUST 指名來源檔
    expect(body.error.message).toContain('隨手記.md');

    expect(await chapterCountOf(target.novelId)).toBe(0);
    expect(
      await prisma.chapterContent.count({ where: { chapter: { novelId: target.novelId } } })
    ).toBe(0);
    expect(await countersOf(target.novelId)).toEqual(before);
  });
});

describe('T026 併發撞號（FR-002b、FR-012）', () => {
  it('預覽後、寫入前由另一連線建立同號章節 → CONFLICT 且整批不落地', async () => {
    const target = await createEmptyVolume('conflict');
    const files = fiveChapters();

    // 「另一連線」在作者按下確認之前插入第 3 章 —— 客戶端手上的預覽因此過期，
    // 伺服器的全量重驗（FR-002b）是唯一會發現這件事的地方
    await prisma.chapter.create({
      data: {
        id: `${TEST_PREFIX}chapter-raced`,
        novelId: target.novelId,
        volumeId: target.volumeId,
        number: 3,
        title: '別人先建的第三章',
        wordCount: 4,
        status: 'draft',
        content: { create: { bodyMarkdown: '插隊的正文。' } },
      },
    });

    const res = await importFiles(target.volumeId, files, IP);
    expect(res.status).toBe(409);

    const body = await res.json();
    expect(body.error.code).toBe('CONFLICT');
    expect(body.error.message).toContain('第 3 章');

    // 整批不落地：資料庫裡只剩插隊的那一章
    expect(await chapterCountOf(target.novelId)).toBe(1);
  });
});

describe('T038 伺服器獨立重驗（FR-002b、FR-019）', () => {
  /**
   * **前端可被繞過**：預覽在瀏覽器端產生，直接打端點就沒有任何預覽跑過。
   * 故這三案不經任何前端判定，驗證伺服器**自己**攔得下來，且回應**逐列指名來源檔** ——
   * 訊息由 `gradePreview` 的判定列產生（該列帶 `filename`），
   * **MUST NOT 由 Zod issue 的陣列索引拼出**：作者的檔案總管裡沒有「第 7 列」這種東西。
   */
  it('檔名不符與標題／正文超長的酬載 → 400，訊息逐列指名出問題的來源檔，零新增列', async () => {
    const target = await createEmptyVolume('reverify400');
    const before = await countersOf(target.novelId);

    const badName = '隨手記.md';
    const longTitle = `第7章_${'長'.repeat(201)}.md`;
    const longBody = '第8章_正文超長.md';
    const files = [
      mdFile('第1章_合法一章.md', '正文一。'),
      mdFile(badName, '這不是章節。'),
      mdFile(longTitle, '標題超長的一章。'),
      mdFile(longBody, 'a'.repeat(100_001)),
    ];

    const res = await importFiles(target.volumeId, files, IP);
    expect(res.status, await res.clone().text()).toBe(400);

    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    // 三個出問題的檔案 MUST 逐一被指名，且各自帶得出是哪一種問題
    expect(body.error.message).toContain(badName);
    expect(body.error.message).toContain(longTitle);
    expect(body.error.message).toContain(longBody);
    expect(body.error.message).toContain('檔名不符');
    expect(body.error.message).toContain('標題不得超過');
    expect(body.error.message).toContain('正文不得超過');
    // 合法的那一檔沒有問題，不該出現在訊息裡
    expect(body.error.message).not.toContain('第1章_合法一章.md');

    expect(await chapterCountOf(target.novelId)).toBe(0);
    expect(
      await prisma.chapterContent.count({ where: { chapter: { novelId: target.novelId } } })
    ).toBe(0);
    expect(await countersOf(target.novelId)).toEqual(before);
  });

  it('與既有章節撞號的酬載 → 409，訊息指名來源檔與撞到的既有章節，零新增列', async () => {
    const target = await createEmptyVolume('reverify409');

    await prisma.chapter.create({
      data: {
        id: `${TEST_PREFIX}chapter-reverify`,
        novelId: target.novelId,
        volumeId: target.volumeId,
        number: 3,
        title: '既有的第三章',
        wordCount: 4,
        status: 'draft',
        content: { create: { bodyMarkdown: '既有的正文。' } },
      },
    });
    const before = await countersOf(target.novelId);

    const res = await importFiles(target.volumeId, fiveChapters(), IP);
    expect(res.status, await res.clone().text()).toBe(409);

    const body = await res.json();
    expect(body.error.code).toBe('CONFLICT');
    // FR-019：衝突屬逐檔判定類，訊息 MUST 指名來源檔，並講得出撞到的是哪一章
    expect(body.error.message).toContain('第3章_測試第3章.md');
    expect(body.error.message).toContain('第 3 章');
    expect(body.error.message).toContain('既有的第三章');
    // 沒撞號的四個檔沒有問題，不該被指名
    expect(body.error.message).not.toContain('第1章_測試第1章.md');

    // 整批不落地：資料庫裡只剩事前建立的那一章
    expect(await chapterCountOf(target.novelId)).toBe(1);
    expect(
      await prisma.chapterContent.count({ where: { chapter: { novelId: target.novelId } } })
    ).toBe(1);
    expect(await countersOf(target.novelId)).toEqual(before);
  });
});

describe('T027 前端逾時但伺服器成功（SC-008 的資料面）', () => {
  it('交易已 commit、章號全數落地；重送同一批次被 CONFLICT 擋下而不產生第二組資料列', async () => {
    const target = await createEmptyVolume('timeout');

    const first = await importFiles(target.volumeId, fiveChapters(), IP);
    expect(first.status).toBe(200);
    expect((await first.json()).created).toBe(5);

    const landed = await prisma.chapter.findMany({
      where: { novelId: target.novelId },
      orderBy: { number: 'asc' },
      select: { number: true },
    });
    expect(landed.map((row) => row.number)).toEqual([1, 2, 3, 4, 5]);

    // 前端逾時後**MUST NOT 自動重試**（FR-004d）。這裡刻意模擬「作者手動重送」：
    // 重送必然整批撞號中止，且不得留下第二組資料列
    const again = await importFiles(target.volumeId, fiveChapters(), IP);
    expect(again.status).toBe(409);
    expect((await again.json()).error.code).toBe('CONFLICT');

    expect(await chapterCountOf(target.novelId)).toBe(5);
    expect(
      await prisma.chapterContent.count({ where: { chapter: { novelId: target.novelId } } })
    ).toBe(5);
  });
});
