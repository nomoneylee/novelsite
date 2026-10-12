/**
 * 自測試伺服器 fetch HTML → jsdom → axe.run()（FR-054、SC-013）。
 * 本檔與整個 tests/a11y/ MUST NOT import 任何 src/** 伺服器端模組 —— a11y 設定檔不含
 * react-server 解析條件，import 'server-only' 會在載入階段主動擲錯（見 vitest.a11y.config.mts）。
 * 可引用的只有 tests/helpers/client.ts（純 HTTP）。
 */
import * as axe from 'axe-core';
import type { AxeResults } from 'axe-core';
import { baseUrl } from '../helpers/client';

export type { AxeResults };

/**
 * MUST 斷言回應為 200 —— 受保護頁面在未帶憑證時回的是 302／登入頁 HTML，若默默跟隨轉址
 * 或直接把登入頁餵進 axe.run()，測試會恆綠卻什麼都沒驗到（見 tasks.md T073）。
 * 停用 color-contrast —— jsdom 無版面計算（research.md R-7）。
 */
export async function auditPage(path: string, opts?: { cookie?: string }): Promise<AxeResults> {
  const res = await fetch(`${baseUrl()}${path}`, {
    headers: opts?.cookie ? { Cookie: opts.cookie } : undefined,
    redirect: 'manual',
  });
  if (res.status !== 200) {
    throw new Error(
      `auditPage(${path}) 預期 200，實得 ${res.status} —— 可能是未帶有效憑證而被轉址至登入頁`
    );
  }

  const html = await res.text();

  // axe.run() 內部部分檢查（如 document-title）讀取的是**環境ambient 的 global document**，
  // 不是傳入的 context 節點本身 —— 若改以 DOMParser 建立獨立 Document 傳給 axe.run()，
  // 這類檢查仍會讀到 jsdom 預設的空白 document 而恆假陽性違規。故改以 document.write()
  // 把抓到的 HTML 灌入 vitest jsdom 環境本身既有的 global document，而非另建一份。
  document.open();
  document.write(html);
  document.close();

  return axe.run(document, {
    rules: {
      'color-contrast': { enabled: false },
    },
  });
}
