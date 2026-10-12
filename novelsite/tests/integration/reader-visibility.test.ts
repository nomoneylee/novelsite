import { describe, it, expect, beforeAll } from 'vitest';
import { testFetch } from '../helpers/client';
import { getAllNovels, getNovelDetail, getChapterContext } from '@/lib/repositories';
import { prisma } from '@/lib/db';

/**
 * US2（2-B）章節可見性（SC-002、FR-014）。
 *
 * 章節可見性只取決於 `Chapter.status`，無任何付費／授權分支：
 *  - 已發佈章節：任何人（含未登入訪客）都能取得 200 與完整正文。
 *  - 未發佈（草稿）章節：對非擁有者回 **404**（不是 403）——不揭露其存在。
 */

/** seed 建立的草稿章節固定 id（FR-012a、contracts/seed-content §5） */
const DRAFT_CHAPTER_ID = 'draft-1';

let novelId: string;
let chapterId: string;
/**
 * 正文的非空行。FEAT-3 起資料層回傳的是 Markdown 原文（`bodyMarkdown`），
 * 段落改由 `<SafeMarkdown>` 在渲染時產生，故此處自原文推導出「應該出現在畫面上的每一行」。
 */
let paragraphs: string[];
/** 草稿章節所屬作品的 id（由 repository 反查，不硬編） */
let draftNovelId: string;

beforeAll(async () => {
  const novels = await getAllNovels();

  for (const novel of novels) {
    const detail = await getNovelDetail(novel.id);
    const chapter = detail?.volumes.flatMap((v) => v.chapters)[0];
    if (!chapter) continue;

    const context = await getChapterContext(novel.id, chapter.id);
    if (!context) continue;

    const lines = context.bodyMarkdown
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;

    novelId = novel.id;
    chapterId = chapter.id;
    paragraphs = lines;
    break;
  }

  if (!novelId) {
    throw new Error('示範資料中找不到任何具備正文的已發佈章節');
  }

  // 草稿章節不會出現在任何公開頁面，故直接查 DB 取其所屬作品（seed 契約保證存在）
  const draft = await prisma.chapter.findUnique({
    where: { id: DRAFT_CHAPTER_ID },
    select: { novelId: true, status: true },
  });
  if (!draft) {
    throw new Error(`seed 未建立 id 為 ${DRAFT_CHAPTER_ID} 的草稿章節（FR-012a）`);
  }
  expect(draft.status).toBe('draft');
  draftNovelId = draft.novelId;
});

describe('已發佈章節：訪客可完整閱讀（SC-002）', () => {
  it('未登入 GET 閱讀頁 → 200', async () => {
    const res = await testFetch(`/reader/${novelId}/${chapterId}`, { ip: '10.70.1.1' });
    expect(res.status).toBe(200);
  });

  it('回應本體含該章完整正文的每一個段落', async () => {
    const res = await testFetch(`/reader/${novelId}/${chapterId}`, { ip: '10.70.1.2' });
    const html = await res.text();

    expect(paragraphs.length).toBeGreaterThan(0);
    for (const paragraph of paragraphs) {
      expect(html).toContain(paragraph);
    }
  });

  it('畫面無鎖頭／付費牆／「示範內容」字樣（H-3 殘留已清除）', async () => {
    const res = await testFetch(`/reader/${novelId}/${chapterId}`, { ip: '10.70.1.3' });
    const html = await res.text();

    for (const forbidden of ['付費章節', '示範內容', '付費牆', '解鎖']) {
      expect(html).not.toContain(forbidden);
    }
  });
});

describe('未發佈章節：對非擁有者回 404 而非 403（FR-014）', () => {
  it('未登入 GET 草稿章節閱讀頁 → 404', async () => {
    const res = await testFetch(`/reader/${draftNovelId}/${DRAFT_CHAPTER_ID}`, { ip: '10.70.2.1' });
    expect(res.status).toBe(404);
  });

  it('getChapterContext 對草稿章節回 null（可見性只看 status，無付費分支）', async () => {
    await expect(getChapterContext(draftNovelId, DRAFT_CHAPTER_ID)).resolves.toBeNull();
  });

  it('公開作品詳情頁的章節目錄不列出草稿章節', async () => {
    const detail = await getNovelDetail(draftNovelId);
    const ids = detail?.volumes.flatMap((v) => v.chapters).map((c) => c.id) ?? [];
    expect(ids).not.toContain(DRAFT_CHAPTER_ID);
  });
});
