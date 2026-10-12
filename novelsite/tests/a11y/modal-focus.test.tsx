import { describe, it, expect, afterEach } from 'vitest';
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Modal } from '@/components/ui/Modal';

/**
 * 對話框的焦點行為（FEAT-8 T013，FR-032）
 * ========================================
 * 本檔驗的是**兩項新增行為**：關閉後把焦點歸還原觸發元素、`Tab` 循環鎖在對話框內。
 * 既有的 `role="dialog"`／`aria-modal`／ESC 關閉／開啟時焦點移入**不重做**。
 *
 * **本檔可直接 import `Modal`**：它是 Client Component，相依只有 React 與 CSS module。
 *
 * **為什麼要斷言而不是「看起來會動」**：這兩件事在畫面上完全看不出來 ——
 * 焦點沒歸還的症狀是鍵盤使用者關掉對話框後得從頭 Tab 一遍，
 * 焦點逸出的症狀是 Tab 到一半跑去操作背景頁面。滑鼠使用者兩者都遇不到。
 */

afterEach(cleanup);

/** 觸發按鈕 ＋ 對話框：對話框內放三個可聚焦元素（關閉鈕、兩個 footer 按鈕） */
function Harness() {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setIsOpen(true)}>開啟對話框</button>
      <Modal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title="確認批次發佈"
        footer={
          <>
            <button>取消</button>
            <button>確認發佈</button>
          </>
        }
      >
        <p>將發佈第 1–10 章</p>
      </Modal>
    </div>
  );
}

/** 對話框根節點（`role="dialog"`） */
function dialog(): HTMLElement {
  return screen.getByRole('dialog');
}

describe('T013 Modal 焦點：開啟時移入對話框', () => {
  it('開啟後焦點在對話框根節點上', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('開啟對話框'));

    // 焦點移入排在 `requestAnimationFrame` 內，等它跑完一輪
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    expect(document.activeElement).toBe(dialog());
  });
});

describe('T013 Modal 焦點：關閉後歸還原觸發控制項（FR-032）', () => {
  it('以 ESC 關閉後，焦點回到按下的那顆按鈕', async () => {
    render(<Harness />);
    const trigger = screen.getByText('開啟對話框');
    trigger.focus();
    fireEvent.click(trigger);

    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    expect(document.activeElement).not.toBe(trigger);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('以關閉鈕關閉後，焦點同樣回到原觸發控制項', async () => {
    render(<Harness />);
    const trigger = screen.getByText('開啟對話框');
    trigger.focus();
    fireEvent.click(trigger);

    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    fireEvent.click(screen.getByLabelText('關閉對話框'));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

describe('T013 Modal 焦點：Tab 鎖在對話框內（FR-032）', () => {
  it('自最後一個可聚焦元素按 Tab 回到第一個', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('開啟對話框'));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

    const focusables = Array.from(
      dialog().querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    );
    expect(focusables.length).toBeGreaterThan(1);

    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
  });

  it('自第一個可聚焦元素按 Shift+Tab 回到最後一個', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('開啟對話框'));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

    const focusables = Array.from(
      dialog().querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    );
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    first.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('焦點若已在對話框外，Tab MUST 把它拉回對話框內（MUST NOT 逸出）', async () => {
    render(<Harness />);
    const trigger = screen.getByText('開啟對話框');
    fireEvent.click(trigger);
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

    // 模擬焦點跑到背景頁面的控制項上
    trigger.focus();
    expect(dialog().contains(document.activeElement)).toBe(false);

    fireEvent.keyDown(document, { key: 'Tab' });
    expect(dialog().contains(document.activeElement)).toBe(true);
  });
});
