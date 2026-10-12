import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getAllNovels, getNovelDetail, getChapterContext } from '@/lib/repositories';
import { prisma } from '@/lib/db';

/**
 * US2（2-B）正文來自資料庫（SC-001）與缺正文列的容錯（Edge Case）。
 *
 * 正文的唯一真相是 `ChapterContent.bodyMarkdown` —— 改 DB 即改畫面，
 * 不再有任何以章節編號生成的假段落（`generateChapterParagraphs` 已刪除，FR-013）。
 *
 * **FEAT-3 的斷言調整（T044）**：`ChapterContext.paragraphs`（切好的段落陣列）
 * 已改為 `bodyMarkdown`（Markdown 原文，FR-017／research R-8）。
 * 資料存取層不再切段 —— 段落是**渲染**的結果，由 `<SafeMarkdown>` 產生；
 * 讓資料層先切一次，等於在讀者端與編輯器預覽之間留下兩條不會一致的路徑。
 * 故本檔改為斷言「原文原封不動地穿過資料層」，段落的呈現則由
 * `reader-typography.test.ts` 在真正的 HTML 上驗證。
 */

let novelId: string;
let chapterId: string;
let originalBody: string;

/** 為「缺 ChapterContent」情境臨時建立的章節，測試結束後刪除 */
const ORPHAN_CHAPTER_ID = 'test-orphan-chapter';
const ORPHAN_CHAPTER_NUMBER = 9999;
let orphanVolumeId: string;

beforeAll(async () => {
  for (const novel of await getAllNovels()) {
    const detail = await getNovelDetail(novel.id);
    const volume = detail?.volumes.find((v) => v.chapters.length > 0);
    const chapter = volume?.chapters[0];
    if (!volume || !chapter) continue;

    const content = await prisma.chapterContent.findUnique({ where: { chapterId: chapter.id } });
    if (!content) continue;

    novelId = novel.id;
    chapterId = chapter.id;
    originalBody = content.bodyMarkdown;
    orphanVolumeId = volume.id;
    break;
  }

  if (!novelId) {
    throw new Error('示範資料中找不到任何具備 ChapterContent 的已發佈章節');
  }
});

afterAll(async () => {
  if (chapterId) {
    await prisma.chapterContent.update({
      where: { chapterId },
      data: { bodyMarkdown: originalBody },
    });
  }
  await prisma.chapter.deleteMany({ where: { id: ORPHAN_CHAPTER_ID } });
});

describe('正文來自資料庫：改 DB 即改內容（SC-001）', () => {
  it('bodyMarkdown 即為 ChapterContent 的原文，逐字元相同（未經任何切分或改寫）', async () => {
    const context = await getChapterContext(novelId, chapterId);
    expect(context).not.toBeNull();
    expect(context!.bodyMarkdown).toBe(originalBody);
  });

  it('直接改寫 ChapterContent.bodyMarkdown → getChapterContext 隨之改變', async () => {
    const before = await getChapterContext(novelId, chapterId);
    expect(before!.bodyMarkdown).not.toContain('這一段是整合測試改寫進資料庫的內容。');

    const rewritten = '這一段是整合測試改寫進資料庫的內容。\n\n第二段仍然來自資料庫。';
    await prisma.chapterContent.update({
      where: { chapterId },
      data: { bodyMarkdown: rewritten },
    });

    const after = await getChapterContext(novelId, chapterId);
    expect(after!.bodyMarkdown).toBe(rewritten);

    await prisma.chapterContent.update({
      where: { chapterId },
      data: { bodyMarkdown: originalBody },
    });
  });

  it('換行與空行原封不動（段落切分屬渲染層的事，資料層 MUST NOT 先做掉）', async () => {
    const withBlankLines = '第一段。\n\n\n第三段前有兩個空行。\n單一換行的下一行。';
    await prisma.chapterContent.update({
      where: { chapterId },
      data: { bodyMarkdown: withBlankLines },
    });

    const context = await getChapterContext(novelId, chapterId);
    expect(context!.bodyMarkdown).toBe(withBlankLines);

    await prisma.chapterContent.update({
      where: { chapterId },
      data: { bodyMarkdown: originalBody },
    });
  });
});

describe('缺 ChapterContent 列：視為無內容，不崩潰（Edge Case）', () => {
  it('已發佈但無正文列的章節 → bodyMarkdown = 空字串', async () => {
    await prisma.chapter.create({
      data: {
        id: ORPHAN_CHAPTER_ID,
        novelId,
        volumeId: orphanVolumeId,
        number: ORPHAN_CHAPTER_NUMBER,
        title: '無正文章節（整合測試）',
        wordCount: 0,
        status: 'published',
        publishedAt: new Date(),
      },
    });

    const context = await getChapterContext(novelId, ORPHAN_CHAPTER_ID);
    expect(context).not.toBeNull();
    expect(context!.bodyMarkdown).toBe('');
  });
});
