import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testFetch } from '../helpers/client';
import {
  createAuthor,
  createNovelWithChapter,
  cleanupAuthoring,
  type TestAuthor,
  type TestNovel,
} from '../helpers/authoring';

/**
 * `arch.md` §10.3 案例 12／SC-003：作者寫進正文的 HTML MUST NOT 成為讀者端的可執行節點。
 *
 * 斷言的對象是**送到瀏覽器的 HTML 字串**，不是元件的回傳值 —— 淨化只要有一條路徑漏掉
 * （例如某天有人為了「支援自訂排版」加上 `rehype-raw`），元件測試可能照樣綠燈，
 * 而真正決定會不會被執行的是這段 HTML。
 */

const IP = '10.62.1.1';

/** 涵蓋三種常見注入形狀：腳本節點、事件處理器屬性、javascript: 協定連結 */
const HOSTILE_BODY = [
  '第一段正常正文。',
  '',
  '<script>alert(1)</script>',
  '',
  '<img src=x onerror="alert(2)">',
  '',
  '[看似無害的連結](javascript:alert(3))',
  '',
  '最後一段正常正文。',
].join('\n');

let author: TestAuthor;
let novel: TestNovel;
let html: string;

beforeAll(async () => {
  await cleanupAuthoring();
  author = await createAuthor('sanitize');
  novel = await createNovelWithChapter({
    authorId: author.id,
    novelStatus: 'published',
    chapterStatus: 'published',
    bodyMarkdown: HOSTILE_BODY,
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

describe('讀者端正文的淨化（案例 12、SC-003）', () => {
  it('正文的合法內容確實有渲染出來（否則以下的「沒有腳本」是廢話）', () => {
    expect(html).toContain('第一段正常正文。');
    expect(html).toContain('最後一段正常正文。');
  });

  /**
   * 判準是「有沒有變成可執行的節點」。
   *
   * **實測後修正的一個預期**：初版斷言注入的標記會「以逸出後的純文字呈現」
   * （預期輸出含 `&lt;script&gt;`），實際上不會 —— `react-markdown` 在未啟用
   * `rehype-raw` 時**直接丟棄**原始 HTML 節點，連逸出後的文字都不留。
   * 那比逸出更嚴格，安全性上沒有問題；但它是一個**作者可見的行為**
   * （寫進正文的 HTML 會整段消失），故記錄在此而非默默改掉斷言。
   *
   * 以下斷言只涵蓋不可協商的部分：這些片段都不得成為真正的節點或屬性。
   */
  it('正文中的 <script> MUST NOT 成為可執行節點', () => {
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toMatch(/<script[^>]*>\s*alert\(1\)/);
  });

  it('事件處理器屬性 MUST NOT 成為真正的屬性', () => {
    expect(html).not.toContain('onerror="alert(2)"');
    expect(html).not.toContain('onerror=alert(2)');
  });

  it('javascript: 協定 MUST NOT 出現在 href 屬性中', () => {
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain("href='javascript:");
  });

  it('原始 HTML 於渲染區塊內整段消失（react-markdown 未啟用 rehype-raw 的既定行為）', () => {
    const start = html.indexOf('id="reader-content"');
    const content = html.slice(start, html.indexOf('</main>', start));
    expect(content).not.toContain('<img');
    expect(content).not.toContain('alert(');
  });
});
