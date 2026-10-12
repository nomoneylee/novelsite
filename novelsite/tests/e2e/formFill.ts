import { expect, type Page } from '@playwright/test';

/**
 * 認證表單的填寫（FEAT-4 T150）
 * ==============================
 * 登入／註冊表單是**受控元件**（`value` 綁在 React state），而 `fill()` 只動 DOM。
 * 若填值早於 hydration 完成，React 掛上來之後那一格的 state 仍是空字串；
 * 接著任何一次重繪（例如填下一格觸發的 `setState`）就會把它寫回 `value=""`。
 *
 * 實測的症狀極具誤導性：WebKit 上讀者流的重新登入一步，
 * **Email 被清空、密碼還在**（Email 填在 hydration 之前，密碼填在之後），
 * 送出後得到「Email 或密碼不正確」—— 錯誤訊息指著憑證，真正的原因是時序。
 * Chromium 與 Firefox 只是比較不容易撞上，不是不會，故這裡不做引擎分支。
 *
 * 兩道防線：
 *   1. `waitForHydration()`：等 React 真的接管表單再開始填
 *   2. 填完**全部欄位之後**再一次驗證每一格 —— 逐格填完就驗會漏掉
 *      「後一格的重繪清掉前一格」這個真正發生的情況，整組重試才擋得住
 */

/**
 * 等 React 接管表單。
 *
 * 判準是 React 在它 hydrate 過的 DOM 節點上掛的內部屬性（`__reactFiber$…`／
 * `__reactProps$…`）—— 那是「這個節點已經有 React 在管」的直接證據。
 * 以固定的 `waitForTimeout` 代替只是在猜一個數字，而猜錯的那天症狀會是憑證錯誤。
 */
async function waitForHydration(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const form = document.querySelector('form');
    return !!form && Object.keys(form).some((key) => key.startsWith('__react'));
  });
}

export interface FillFormOptions {
  /** 是否一併勾選表單內唯一的核取方塊（註冊頁的服務條款） */
  checkbox?: boolean;
}

export async function fillForm(
  page: Page,
  fields: Record<string, string>,
  options: FillFormOptions = {}
): Promise<void> {
  await waitForHydration(page);

  const entries = Object.entries(fields);
  await expect(async () => {
    for (const [label, value] of entries) {
      await page.getByLabel(label).fill(value);
    }
    if (options.checkbox) await page.getByRole('checkbox').check();

    for (const [label, value] of entries) {
      await expect(page.getByLabel(label)).toHaveValue(value, { timeout: 1000 });
    }
    if (options.checkbox) {
      await expect(page.getByRole('checkbox')).toBeChecked({ timeout: 1000 });
    }
  }).toPass({ timeout: 15_000 });
}
