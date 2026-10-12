import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testFetch } from '../helpers/client';
import {
  createAuthor,
  createNovelWithChapter,
  cleanupAuthoring,
  type TestNovel,
} from '../helpers/authoring';

/**
 * FR-020 的**可驗證成功條件**（憲章第 IV 條、T043a）。
 *
 * 「閱讀頁改用 `SafeMarkdown` 渲染，但既有排版參數與偏好全部不動」這句話，
 * 如果沒有一個會變紅的檢查，就只是一句話。字級、行高、主題與無干擾模式
 * 全都掛在幾個具體的 hook 上（外層的 `data-reader-font` 屬性、`#reader-content` 容器、
 * `.reader-content` 這個 class）—— 換掉渲染方式時順手改掉容器，
 * 畫面在開發者的預設偏好下看起來完全正常，只有實際調過字級的讀者會發現偏好失效。
 *
 * 另一半是**正文真的被當成 Markdown 渲染**：段落 MUST 為多個 `<p>`，
 * 而不是一整坨 `<pre>` 或單一段落 —— 那是「換了元件但原文沒被解析」的典型症狀。
 */

const IP = '10.65.1.1';

/** 三段正文 + 一個 Markdown 標記，用來同時驗證分段與轉譯 */
const BODY = [
  '第一段：山雨欲來。',
  '',
  '第二段：**風滿樓**。',
  '',
  '第三段：他終於推開了那扇門。',
].join('\n');

let novel: TestNovel;
let html: string;
/**
 * 只取 `<main id="reader-content">…</main>` 這一段。
 *
 * **為何不能拿整份 HTML 做否定斷言**：`ReaderView` 是 client component，
 * 它的 props（含 `bodyMarkdown` 原文）會被序列化進頁面裡的 RSC flight payload。
 * 於是 `**風滿樓**` 這串原文必然出現在整份文件中，即使畫面上渲染的是 `<strong>`。
 * 對整份文件斷言「不含星號」測到的是 payload，不是使用者看到的東西。
 */
function readerContent(): string {
  const start = html.indexOf('id="reader-content"');
  const end = html.indexOf('</main>', start);
  expect(start, '找不到 #reader-content 容器').toBeGreaterThan(-1);
  expect(end, '找不到 </main> 結尾').toBeGreaterThan(start);
  return html.slice(start, end);
}

beforeAll(async () => {
  await cleanupAuthoring();
  const author = await createAuthor('typography');
  novel = await createNovelWithChapter({
    authorId: author.id,
    novelStatus: 'published',
    chapterStatus: 'published',
    bodyMarkdown: BODY,
  });

  const res = await testFetch(`/reader/${novel.novelId}/${novel.chapterId}`, {
    method: 'GET',
    ip: IP,
  });
  expect(res.status, '前置條件失敗：已發佈章節的閱讀頁未回 200').toBe(200);
  html = await res.text();
});

afterAll(async () => {
  await cleanupAuthoring();
});

describe('閱讀頁排版契約在改用 SafeMarkdown 後仍然成立（FR-020）', () => {
  it('外層仍帶 data-reader-font 屬性（字級偏好的掛載點）', () => {
    expect(html).toMatch(/data-reader-font="(sm|md|lg)"/);
  });

  it('正文容器仍為 #reader-content，且仍帶 reader-content class', () => {
    expect(html).toContain('id="reader-content"');
    expect(html).toMatch(/class="[^"]*reader-content[^"]*"/);
  });

  it('無干擾模式的切換仍在（雙擊正文區的處理器所依附的容器未被換掉）', () => {
    // 無干擾模式由雙擊 #reader-content 觸發，退出提示則在啟用後才渲染；
    // 此處驗證的是它所依附的容器與工具列仍然存在
    expect(html).toContain('id="reader-toolbar"');
    expect(html).toContain('aria-label="閱讀工具列"');
  });

  it('字級切換控制項與其 aria-label 仍在', () => {
    expect(html).toMatch(/aria-label="字體大小：(A-|A|A\+)"/);
  });

  it('閱讀進度列與目錄入口仍在（工具列內容未因改渲染而遺失）', () => {
    expect(html).toContain('aria-label="閱讀進度列"');
    expect(html).toContain('aria-label="章節目錄"');
  });
});

describe('正文確實以 Markdown 渲染（而非整段原文塞進單一節點）', () => {
  it('三個段落各自成為一個 <p>', () => {
    const content = readerContent();
    // 純文字的兩段直接驗其緊鄰 <p>；含行內標記的第二段由下一則以 <strong> 驗證
    for (const text of ['山雨欲來', '他終於推開了那扇門']) {
      expect(content).toMatch(new RegExp(`<p[^>]*>[^<]*${text}`));
    }
    // 三段正文 → 至少三個 <p>（章節標題是 <h1>，不計入）
    const paragraphCount = (content.match(/<p[\s>]/g) ?? []).length;
    expect(paragraphCount).toBeGreaterThanOrEqual(3);
  });

  it('Markdown 標記被轉譯（**風滿樓** → <strong>），畫面上 MUST NOT 留下星號', () => {
    const content = readerContent();
    expect(content).toContain('<strong>風滿樓</strong>');
    expect(content).not.toContain('**風滿樓**');
  });

  it('MUST NOT 把整份正文塞進單一 <pre>（那是原文未被解析的典型症狀）', () => {
    expect(readerContent()).not.toMatch(/<pre[^>]*>[^<]*山雨欲來/);
  });
});
