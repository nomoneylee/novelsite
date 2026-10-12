/**
 * 隱私權頁的個資權利行使位址（FEAT-5 T040a，FR-024／SC-011 的隱私權頁那一項）
 * ==========================================================================
 * 隱私權頁的「你的權利」段落是**法遵**管道而非一般功能入口：
 * 政策白紙黑字宣告了查閱／更正／刪除權，而行使該權利的入口若只是一個指向表單的連結，
 * 權利在實務上就沒有出口。故該處 MUST 直接列出可實際收信的位址（FR-024）。
 *
 * **本檔屬 5-A（US2），MUST NOT 併入 5-C 的 `contact-entry-points.test.ts`**
 * （`/speckit-analyze` 第三輪，2026-08-09）：它斷言的實作由 **T041** 交付，
 * 放在 5-C 會讓 5-C 隱性依賴 5-A —— 而三刀在基礎層之後是完全平行的，
 * **5-C 若先合併，該斷言交付即紅，且紅燈與 5-C 的實作進度無關**。
 *
 * 本檔專屬位址前綴：`10.118.*`
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { env } from '@/lib/env';
import { testFetch } from '../helpers/client';

let privacyHtml: string;

beforeAll(async () => {
  const res = await testFetch('/privacy', { ip: '10.118.1.1' });
  expect(res.status).toBe(200);
  privacyHtml = await res.text();
});

describe('GET /privacy 的個資權利行使管道（FR-024）', () => {
  it('HTML 含 CONTACT_EMAIL 的 mailto: 位址', () => {
    expect(privacyHtml).toContain(`mailto:${env.CONTACT_EMAIL}`);
  });

  /**
   * `mailto:` 只是連結的 href，**位址本身也要看得到**：
   * 一個寫著「聯絡我們」而 href 是 mailto 的連結，在列印出來的政策上、
   * 或在不支援 mailto 的環境裡，讀者拿不到任何可用的資訊。
   */
  it('位址明文出現在頁面上（不只藏在 href 裡）', () => {
    const withoutHref = privacyHtml.replace(/href="mailto:[^"]*"/g, '');
    expect(withoutHref).toContain(env.CONTACT_EMAIL);
  });

  /**
   * FR-024 要求的是**在既有連結之外**追加位址，不是取代它。
   * 表單接通後（5-C）它仍是多數使用者較順手的路徑。
   */
  it('既有的 /contact 連結仍在（新位址是追加，不是取代）', () => {
    expect(privacyHtml).toMatch(/href="\/contact"/);
  });
});
