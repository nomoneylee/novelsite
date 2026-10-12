/**
 * 建議清單的鍵盤操作與請求節流（FR-031、US2 AC5、contracts/search-api.md §4）。
 *
 * combobox 的價值全在**看不見的那一半**：`aria-activedescendant` 有沒有跟著高亮走、
 * `Esc` 之後焦點還在不在輸入框。這些在畫面上一模一樣，只有輔助技術與這份測試分得出來。
 *
 * `fetch` 與 `next/navigation` 皆以 `vi.mock`／stub 取代 —— 本檔驗的是元件的行為，
 * 不是後端的回應；`vitest.a11y.config.mts` 也沒有 react-server 解析條件，
 * 真的載入服務層會在 import 階段就擲錯（見 `register-form.test.tsx` 的同一則說明）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SearchView } from '@/components/search/SearchView';
import { SUGGEST_DEBOUNCE_MS } from '@/lib/validation/search';

const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn() }),
}));

const SUGGESTIONS = [
  { id: 'novel-a', title: '劍影行紀', author: '墨衍' },
  { id: 'novel-b', title: '劍影殘章', author: '南簫詞' },
];

let fetchMock: ReturnType<typeof vi.fn>;

function renderView() {
  return render(
    <SearchView
      query=""
      category=""
      categories={[
        { id: 'cat-1', label: '玄幻', emoji: '🗡', description: '', color: '', bgColor: '' },
      ]}
      initialItems={[]}
      initialCursor={null}
    />
  );
}

/** 讓防抖計時器到期並沖掉 fetch 的 microtask（狀態更新一律包在 act 內） */
async function flushDebounce(extraMs = 0) {
  await act(async () => {
    vi.advanceTimersByTime(SUGGEST_DEBOUNCE_MS + extraMs);
    await Promise.resolve();
    await Promise.resolve();
  });
}

/**
 * MUST 以無障礙名稱指名。`<select>`（分類篩選）的隱含角色**也是 combobox**，
 * 只用角色查會同時命中兩個 —— 而那個歧義正好證明了輸入框需要一個 label。
 */
function input(): HTMLInputElement {
  return screen.getByRole('combobox', { name: '全站搜尋' }) as HTMLInputElement;
}

/**
 * 建議選項 MUST 自建議清單內取。分類篩選 `<select>` 的 `<option>` 隱含角色同樣是
 * `option`，全域查會把兩者混在一起，斷言的筆數就變成兩個無關清單的總和。
 */
function options(): HTMLElement[] {
  const listbox = screen.getByRole('listbox', { name: '搜尋建議' });
  return Array.from(listbox.querySelectorAll('[role="option"]')) as HTMLElement[];
}

beforeEach(() => {
  vi.useFakeTimers();
  push.mockReset();
  fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ data: SUGGESTIONS }),
  }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('觸發條件與防抖（FR-031）', () => {
  it('1 字元不發請求', async () => {
    renderView();
    fireEvent.change(input(), { target: { value: '劍' } });
    await flushDebounce();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(input().getAttribute('aria-expanded')).toBe('false');
  });

  it('2 字元才發請求，且網址帶 suggest=1', async () => {
    renderView();
    fireEvent.change(input(), { target: { value: '劍影' } });
    await flushDebounce();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('suggest=1');
    expect(String(fetchMock.mock.calls[0][0])).toContain(encodeURIComponent('劍影'));
  });

  it('300ms 內連續輸入只發一次請求（防抖）', async () => {
    renderView();

    for (const value of ['劍影', '劍影行', '劍影行紀']) {
      fireEvent.change(input(), { target: { value } });
      await act(async () => {
        vi.advanceTimersByTime(SUGGEST_DEBOUNCE_MS - 100);
      });
    }
    await flushDebounce();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain(encodeURIComponent('劍影行紀'));
  });

  it('刪回 1 字元後清單關閉', async () => {
    renderView();
    fireEvent.change(input(), { target: { value: '劍影' } });
    await flushDebounce();
    expect(input().getAttribute('aria-expanded')).toBe('true');

    fireEvent.change(input(), { target: { value: '劍' } });
    await flushDebounce();
    expect(input().getAttribute('aria-expanded')).toBe('false');
  });
});

describe('鍵盤操作與 aria 狀態', () => {
  async function openList() {
    renderView();
    fireEvent.change(input(), { target: { value: '劍影' } });
    await flushDebounce();
  }

  it('↓／↑ 移動高亮，`aria-activedescendant` 同步指向該選項', async () => {
    await openList();
    const opts = options();
    expect(opts).toHaveLength(2);
    // 尚未選取任何一項時 MUST NOT 指向任何 id
    expect(input().getAttribute('aria-activedescendant')).toBeNull();

    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(input().getAttribute('aria-activedescendant')).toBe(opts[0].id);
    expect(opts[0].getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(input().getAttribute('aria-activedescendant')).toBe(opts[1].id);

    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    expect(input().getAttribute('aria-activedescendant')).toBe(opts[0].id);
  });

  it('↑／↓ 在頭尾繞回，不會卡在邊界', async () => {
    await openList();
    const opts = options();

    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    expect(input().getAttribute('aria-activedescendant')).toBe(opts[1].id);

    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(input().getAttribute('aria-activedescendant')).toBe(opts[0].id);
  });

  it('`aria-controls` 指向真正存在的 listbox', async () => {
    await openList();
    const controls = input().getAttribute('aria-controls');

    expect(controls).toBeTruthy();
    expect(document.getElementById(controls!)?.getAttribute('role')).toBe('listbox');
  });

  it('Enter 導向高亮中的建議 `/novels/{id}`', async () => {
    await openList();
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.submit(input().closest('form')!);

    expect(push).toHaveBeenCalledWith(`/novels/${SUGGESTIONS[1].id}`);
  });

  it('未選中任何建議時 Enter 送出完整搜尋', async () => {
    await openList();
    fireEvent.submit(input().closest('form')!);

    expect(push).toHaveBeenCalledWith(`/search?q=${encodeURIComponent('劍影')}`);
  });

  it('Esc 關閉清單，且焦點留在輸入框', async () => {
    await openList();
    input().focus();

    fireEvent.keyDown(input(), { key: 'Escape' });

    expect(input().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(input());
    expect(push).not.toHaveBeenCalled();
  });

  it('點選建議導向該作品', async () => {
    await openList();
    fireEvent.mouseDown(options()[0]);

    expect(push).toHaveBeenCalledWith(`/novels/${SUGGESTIONS[0].id}`);
  });
});
