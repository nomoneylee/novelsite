/**
 * 站上四個導向聯絡管道的入口（FEAT-5 T054a，SC-011）
 * ==================================================
 * 頁尾／說明頁／關於頁／隱私權頁都寫著「聯絡我們」，而在本階段之前它們全部指向一個
 * **送出鈕永遠停用**的表單。交付後這四條路都通了 —— 但其中**只有隱私權頁有實作任務**，
 * 其餘三個是「US3 完成後自然成立」。
 * **沒有東西把關的自然成立，下一次改版就會斷掉**，而斷掉的症狀是使用者按了連結、
 * 填了表單、然後訊息哪裡也沒去。
 *
 * **隱私權頁的 `mailto:` 斷言不在本檔**（`/speckit-analyze` 第三輪，2026-08-09）：
 * 那一項由 US2 的 `T041` 交付，寫在這裡會使 US3 隱性依賴 US2 ——
 * 見 `tests/integration/privacy-contact-email.test.ts`。**本檔只依賴 T054，不依賴 T041**。
 *
 * 本檔專屬位址前綴：`10.122.*`
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { testFetch } from '../helpers/client';

/** 四個入口：頁尾出現在每一頁，故以首頁取樣 */
const ENTRY_PAGES = [
  { path: '/', label: '頁尾（以首頁取樣）' },
  { path: '/help', label: '說明頁' },
  { path: '/about', label: '關於頁' },
  { path: '/privacy', label: '隱私權頁' },
] as const;

const html: Record<string, string> = {};

beforeAll(async () => {
  for (const [index, page] of ENTRY_PAGES.entries()) {
    const res = await testFetch(page.path, { ip: `10.122.1.${index + 1}` });
    expect(res.status, `${page.path} 沒有回 200`).toBe(200);
    html[page.path] = await res.text();
  }
});

describe('SC-011：四個入口皆連得到 /contact', () => {
  it.each(ENTRY_PAGES)('$label（$path）的 HTML 含 /contact 連結', ({ path }) => {
    expect(html[path]).toMatch(/href="\/contact"/);
  });
});

describe('SC-011：/contact 真的可用（入口 MUST NOT 導向假象）', () => {
  let contactHtml: string;

  beforeAll(async () => {
    const res = await testFetch('/contact', { ip: '10.122.2.1' });
    expect(res.status).toBe(200);
    contactHtml = await res.text();
  });

  /**
   * **送出鈕非 `disabled` 是這一節的重點**：頁面回 200 只證明它渲染得出來，
   * 而在本階段之前它就是一個 200 的頁面配一顆永遠按不下去的按鈕。
   */
  it('送出鈕非 disabled', () => {
    const submitButton = /<button[^>]*type="submit"[^>]*>/.exec(contactHtml)?.[0];
    expect(submitButton, '/contact 沒有渲染出送出鈕').toBeDefined();
    expect(submitButton).not.toMatch(/\bdisabled\b/);
  });

  it('已失效的「功能開發中」文案不再出現', () => {
    expect(contactHtml).not.toContain('尚無法送出訊息');
  });

  /**
   * honeypot 欄位**必須真的被渲染**（contracts §1.4）：
   * 表單不送這個欄位，伺服器端那條判定就永遠收不到值，
   * **FR-018 的濫用防護實際等於不存在** —— 而單元與 route 的測試只驗得到伺服器端那一半。
   */
  it('honeypot 欄位 website 已渲染且不會被鍵盤走訪', () => {
    const honeypot = /<input[^>]*name="website"[^>]*>/.exec(contactHtml)?.[0];
    expect(honeypot, '表單沒有渲染 honeypot 欄位 —— 伺服器端的判定永遠收不到值').toBeDefined();
    expect(honeypot).toMatch(/tabindex="-1"/i);
    expect(honeypot).toMatch(/autocomplete="off"/i);
  });
});
