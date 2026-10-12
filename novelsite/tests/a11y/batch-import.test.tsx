/**
 * a11y 互動狀態層：批次匯入面板（FEAT-7 T046，FR-054 第 3 條、FR-004a）
 * =====================================================================
 * 以 React Testing Library 渲染 `BatchImportPanel`（Client Component），選檔 → 預覽 →
 * 確認送出，於**兩個狀態**各跑一次 axe：預覽列出之後、送出之後。
 *
 * **本檔可直接 import 受測元件**：它的相依（`chapterImport/parse`、`validation/*`）
 * 依 FR-002c 一律不帶 `server-only`，這正是「前後端共用同一份判定」的副產物。
 * 需要替換的只有 `next/navigation`（a11y 環境沒有 App Router 的 context）。
 *
 * **`XMLHttpRequest` MUST 換成替身**：元件以 XHR 上傳（`fetch` 沒有上傳進度事件，
 * research R-6），而 jsdom 的 XHR 會真的去連線 —— 那會讓本檔的結果取決於當下有沒有伺服器。
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as axe from 'axe-core';
import { BatchImportPanel } from '@/components/author/BatchImportPanel';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

/** 送出用的 XHR 替身：只記錄有沒有被送出，不連線 */
class FakeXhr {
  static sent = 0;
  status = 0;
  responseText = '';
  timeout = 0;
  upload = { onprogress: null as unknown, onload: null as unknown };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  open(): void {}
  send(): void {
    FakeXhr.sent += 1;
  }
}

beforeEach(() => {
  FakeXhr.sent = 0;
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const VOLUME = { id: 'vol-1', number: 1, title: '第一卷' };

/**
 * **jsdom 25 的 `File` 缺 `arrayBuffer()`**，而元件的 `readFile()` 正是靠它取原始位元組
 * （`decodeUtf8Strict` 要的是位元組，不是字串）。就地補上該方法，**而不改用 Node 的
 * `File`** —— 後者過不了 jsdom `FormData.append` 的 `Blob` 型別檢查，症狀會變成送出時擲錯，
 * 而那與受測的無障礙行為毫無關係。
 */
function mdFile(filename: string, body: string): File {
  const bytes = new TextEncoder().encode(body);
  const file = new File([bytes], filename, { type: 'text/markdown' });
  Object.defineProperty(file, 'arrayBuffer', {
    value: async (): Promise<ArrayBuffer> => bytes.buffer as ArrayBuffer,
  });
  return file;
}

/**
 * `HTMLInputElement.files` 是唯讀的，且本專案未安裝 `@testing-library/user-event`；
 * 故以 array-like 直接覆寫（元件讀的是 `Array.from(fileList)`）。
 */
function setFiles(input: HTMLInputElement, files: File[]): void {
  const list: Record<number, File> & { length: number; item(index: number): File | null } = {
    length: files.length,
    item: (index: number) => files[index] ?? null,
  };
  files.forEach((file, index) => {
    list[index] = file;
  });
  Object.defineProperty(input, 'files', { value: list, configurable: true });
}

const AXE_OPTIONS: axe.RunOptions = {
  rules: {
    // jsdom 無版面計算（research R-7）
    'color-contrast': { enabled: false },
    // 本檔只渲染單一元件片段，無頁面層 landmark；完整頁面由 tests/a11y/pages.test.ts 驗證
    region: { enabled: false },
  },
};

async function pickThreeChapters(): Promise<void> {
  const input = screen.getByLabelText('選擇章節檔（可多選）') as HTMLInputElement;
  setFiles(
    input,
    [1, 2, 3].map((n) => mdFile(`第${n}章_測試第${n}章.md`, `第 ${n} 章的正文。`))
  );
  fireEvent.change(input);

  await waitFor(() => {
    expect(screen.getByText('可匯入 3 章')).not.toBeNull();
  });
}

describe('T046 批次匯入面板的無障礙與焦點（FR-054 第 3 條、FR-004a）', () => {
  it('選檔並列出預覽後，axe 檢查零違規', async () => {
    render(<BatchImportPanel volume={VOLUME} existingChapters={[]} />);
    await pickThreeChapters();

    const results = await axe.run(document.body, AXE_OPTIONS);
    expect(results.violations).toEqual([]);
  });

  it('確認送出後：送出鈕停用、焦點未掉回 <body>、axe 仍零違規', async () => {
    render(<BatchImportPanel volume={VOLUME} existingChapters={[]} />);
    await pickThreeChapters();

    const submit = screen.getByRole('button', { name: '確認匯入' });
    submit.focus();
    fireEvent.click(submit);

    // FR-004a：作業期間送出控制項停用，避免重複送出
    await waitFor(() => {
      expect((submit as HTMLButtonElement).disabled).toBe(true);
    });
    expect(FakeXhr.sent).toBe(1);

    // **焦點 MUST NOT 掉回 <body>**：停用一個正被聚焦的元素就會發生這件事，
    // 而鍵盤使用者得從頭 Tab 一遍才找得回作業進度
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.textContent).toContain('可匯入 3 章');

    const results = await axe.run(document.body, AXE_OPTIONS);
    expect(results.violations).toEqual([]);
  });
});
