import { describe, it, expect, afterEach, vi } from 'vitest';
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as axe from 'axe-core';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { TagManagementTable } from '@/components/admin/TagManagementTable';
import { AuditLogTable } from '@/components/admin/AuditLogTable';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/app/admin/tags/actions', () => ({
  createTagAction: vi.fn(),
  renameTagAction: vi.fn(),
  mergeTagsAction: vi.fn(),
  deleteTagAction: vi.fn(),
}));

vi.mock('@/app/admin/audit/actions', () => ({
  listAuditLogsAction: vi.fn(),
}));

afterEach(cleanup);

function ConfirmDialogHarness() {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setIsOpen(true)}>觸發對話框</button>
      <ConfirmDialog
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        onConfirm={() => setIsOpen(false)}
        title="確認下架作品"
        message="下架後讀者將無法瀏覽此作品。"
        requireReason={true}
      />
    </div>
  );
}

describe('FEAT-9 / 009-admin-dashboard T053: 管理後台無障礙 (a11y) 規範審查', () => {
  describe('ConfirmDialog: WCAG AA 對話框焦點、屬性與 label 關聯', () => {
    it('對話框具備 role="dialog"、aria-modal="true" 與 aria-labelledby 關聯', () => {
      render(<ConfirmDialogHarness />);
      fireEvent.click(screen.getByText('觸發對話框'));

      const dialog = screen.getByRole('dialog');
      expect(dialog).not.toBeNull();
      expect(dialog.getAttribute('aria-modal')).toBe('true');

      const titleId = dialog.getAttribute('aria-labelledby');
      expect(titleId).toBeTruthy();
      expect(document.getElementById(titleId!)?.textContent).toContain('確認下架作品');

      const descId = dialog.getAttribute('aria-describedby');
      expect(descId).toBeTruthy();
      expect(document.getElementById(descId!)?.textContent).toContain('下架後讀者將無法瀏覽');
    });

    it('理由輸入框與 label 具備程式化 id/htmlFor 關聯 (useId)', () => {
      render(<ConfirmDialogHarness />);
      fireEvent.click(screen.getByText('觸發對話框'));

      const textarea = screen.getByRole('textbox', { name: /操作理由/ });
      expect(textarea).not.toBeNull();
      expect(textarea.getAttribute('id')).toBeTruthy();
    });

    it('關閉對話框後，焦點自動歸還至原觸發元素', async () => {
      render(<ConfirmDialogHarness />);
      const trigger = screen.getByText('觸發對話框');
      trigger.focus();
      expect(document.activeElement).toBe(trigger);

      fireEvent.click(trigger);
      await new Promise((resolve) => setTimeout(resolve, 60));

      // 關閉對話框
      fireEvent.click(screen.getByText('取消'));
      expect(document.activeElement).toBe(trigger);
    });

    it('ConfirmDialog 的 axe 規則檢查零違規', async () => {
      render(<ConfirmDialogHarness />);
      fireEvent.click(screen.getByText('觸發對話框'));

      const results = await axe.run(document.body, {
        rules: {
          'color-contrast': { enabled: false },
          region: { enabled: false },
        },
      });
      expect(results.violations).toEqual([]);
    });
  });

  describe('TagManagementTable: 表單控制項 label 關聯與對話框語意', () => {
    it('搜尋框具備 accessible label，新增標籤彈窗表單有完整 id/htmlFor 關聯', () => {
      render(
        <TagManagementTable
          initialTags={[{ id: 'tag-1', name: '玄幻奇幻', slug: 'fantasy', novelCount: 5 }]}
        />
      );

      /*
        UI 重構（2026-09-06）後改為**可見 label**，不再用 aria-label：
        placeholder 與 aria-label 都在使用者開始打字後給不出「這格是什麼」的提示。
        斷言跟著改成可見文字，而 `getByLabelText` 依然證明 label 與控制項有關聯。
      */
      const searchInput = screen.getByLabelText('搜尋');
      expect(searchInput).not.toBeNull();
      expect(screen.getByLabelText('排序依據')).not.toBeNull();
      expect(screen.getByLabelText('排序順序')).not.toBeNull();

      // 開啟新增彈窗
      fireEvent.click(screen.getByText('新增標籤'));

      // 驗證標籤名稱與代稱欄位有正確的 label 關聯
      const nameInput = screen.getByLabelText('標籤名稱');
      const slugInput = screen.getByLabelText(/代稱 \(Slug/);
      expect(nameInput).not.toBeNull();
      expect(slugInput).not.toBeNull();
      expect(nameInput.getAttribute('id')).toBeTruthy();
      expect(slugInput.getAttribute('id')).toBeTruthy();
    });
  });

  describe('AuditLogTable: 篩選輸入項 label 關聯', () => {
    it('所有篩選輸入框均具備 accessible label', () => {
      render(<AuditLogTable initialLogs={[]} totalCount={0} />);

      // 同上：重構後為可見 label（動作別／對象類型／起日／訖日）
      expect(screen.getByLabelText('動作別')).not.toBeNull();
      expect(screen.getByLabelText('對象類型')).not.toBeNull();
      expect(screen.getByLabelText('起日')).not.toBeNull();
      expect(screen.getByLabelText('訖日')).not.toBeNull();
    });
  });
});
