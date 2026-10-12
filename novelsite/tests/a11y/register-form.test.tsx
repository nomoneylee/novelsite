/**
 * a11y 互動狀態層：以 React Testing Library 渲染 RegisterForm（Client Component），
 * 觸發「未勾選條款送出」後跑 axe.run()，確認錯誤訊息與欄位程式化關聯（FR-054 第 3 條）。
 *
 * MUST 以 vi.mock('@/app/auth/actions') 替換 Server Action 模組（第五輪修正）：
 * RegisterForm → registerAction → authService → repositories/users 這條鏈路帶
 * import 'server-only'，而 a11y 設定檔不能加 react-server 解析條件（見 vitest.a11y.config.mts）—
 * 不 mock 則本檔在 import 階段就擲錯；即使不擲錯，實際載入資料存取客戶端對一個純檢查表單
 * 錯誤關聯的測試而言也是無謂成本。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as axe from 'axe-core';
import { RegisterForm } from '@/components/auth/RegisterForm';

const registerAction = vi.fn();

vi.mock('@/app/auth/actions', () => ({
  registerAction: (input: unknown) => registerAction(input),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  registerAction.mockReset();
});

describe('RegisterForm 未勾選條款送出時的錯誤關聯與無障礙（FR-054 第 3 條）', () => {
  it('acceptTerms 錯誤訊息與勾選框有程式化關聯，axe 檢查零違規', async () => {
    registerAction.mockResolvedValue({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: '輸入格式不正確',
        fields: { acceptTerms: '請先閱讀並同意服務條款與隱私權政策' },
      },
    });

    render(<RegisterForm />);

    fireEvent.change(screen.getByLabelText('暱稱'), { target: { value: '測試使用者' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText('密碼'), { target: { value: 'Abcd1234' } });
    fireEvent.click(screen.getByRole('button', { name: '註冊' }));

    // 專案未安裝 @testing-library/jest-dom，MUST NOT 使用其自訂 matcher
    // （toBeInTheDocument／toHaveAttribute／toHaveTextContent），一律以原生 DOM API 斷言。
    await waitFor(() => {
      expect(screen.getByText('請先閱讀並同意服務條款與隱私權政策')).not.toBeNull();
    });

    const checkbox = screen.getByRole('checkbox');
    expect(checkbox.getAttribute('aria-invalid')).toBe('true');
    const describedBy = checkbox.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toContain(
      '請先閱讀並同意服務條款與隱私權政策'
    );

    const results = await axe.run(document.body, {
      rules: {
        'color-contrast': { enabled: false },
        // 本測試只渲染 RegisterForm 片段（無 <header>/<main> 版面 landmark），
        // 'region' 規則檢查「頁面全部內容都在 landmark 內」對單一元件片段沒有意義 ——
        // 完整頁面的 landmark 結構由 T074 的頁面層測試（fetch 真實 HTML）驗證。
        region: { enabled: false },
      },
    });
    expect(results.violations).toEqual([]);
  });
});
