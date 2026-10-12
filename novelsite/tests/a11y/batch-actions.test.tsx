/**
 * a11y 互動狀態層：卷內批次操作（FEAT-8 T046，FR-030／FR-031／FR-032／FR-016）
 * ==========================================================================
 * 以 React Testing Library 渲染 `NovelManageView`（Client Component），
 * 在**選取前、全選後、刪除確認開啟時**三個狀態各跑一次 axe，並補三項 axe 掃不到的斷言：
 *
 *   (a) 核取方塊的可及名稱含**章號與標題**（FR-030）
 *   (b) 選取數的變動落在 `aria-live` 區域**之內**（FR-031）
 *   (c) 刪除警語（含已發佈章節數）是對話框 `aria-describedby` 目標的一部分（FR-032）
 *
 * **為什麼是 `NovelManageView` 而不是只渲染 `BatchActionBar`**：核取方塊在前者、
 * 選取狀態也在前者，(a) 與 (b) 在後者的單獨渲染下根本不存在。
 *
 * **為什麼這三項 axe 掃不到**：axe 查得到「核取方塊有沒有名稱」，
 * 查不到那個名稱**分不分得出是哪一章**；查得到 `aria-live` 屬性存在，
 * 查不到選取數**有沒有真的寫在那個區域裡**；查得到對話框有 `aria-describedby`，
 * 查不到它指到的那段文字**有沒有講出「其中 M 章已發佈」**。
 * 而這三件事正是批次 UI 特有的風險（spec 無障礙節前言）。
 *
 * **Server Action MUST 換成替身**：`@/app/author/actions` 會拉進 `server-only` 的服務層，
 * 在 jsdom 條件下載入即擲錯 —— 那與受測的無障礙行為毫無關係。
 * `next/navigation` 同樣沒有 App Router 的 context。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as axe from 'axe-core';
import { NovelManageView } from '@/components/author/NovelManageView';
import type { AuthorNovelManage, Category, TagOption } from '@/lib/types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

/** 本檔不送出任何一次寫入；替身只需存在，回傳成功即可 */
vi.mock('@/app/author/actions', () => {
  const ok = vi.fn(async () => ({ success: true as const, data: {} }));
  return {
    updateNovelAction: ok,
    publishNovelAction: ok,
    deleteNovelAction: ok,
    createVolumeAction: ok,
    updateVolumeAction: ok,
    deleteVolumeAction: ok,
    createChapterAction: ok,
    reorderChaptersAction: ok,
    deleteChapterAction: ok,
    publishChaptersAction: ok,
    deleteChaptersAction: ok,
  };
});

afterEach(cleanup);

const AXE_OPTIONS: axe.RunOptions = {
  rules: {
    // jsdom 無版面計算（research R-7）
    'color-contrast': { enabled: false },
    // 本檔只渲染單一元件片段，無頁面層 landmark；完整頁面由 tests/a11y/pages.test.ts 驗證
    region: { enabled: false },
  },
};

const CATEGORIES: Category[] = [
  {
    id: 'cat-1',
    label: '玄幻',
    emoji: '🗡',
    description: '玄幻分類',
    color: '#1e293b',
    bgColor: '#f1f5f9',
  },
];
const TAGS: TagOption[] = [{ id: 'tag-1', name: '熱血' }];

/** 一卷四章：兩草稿（其一正文為空）、兩已發佈 —— 三項斷言各自需要的狀態一次備齊 */
const NOVEL: AuthorNovelManage = {
  id: 'novel-1',
  title: '批次測試作品',
  excerpt: '摘要',
  description: '簡介',
  categoryId: 'cat-1',
  category: '玄幻',
  coverColor: '#334155',
  status: 'draft',
  serialStatus: 'ongoing',
  tagIds: [],
  wordCount: 300,
  chapterCount: 2,
  volumes: [
    {
      id: 'vol-1',
      number: 1,
      title: '第一卷',
      chapters: [
        {
          id: 'ch-1',
          number: 1,
          title: '破曉',
          status: 'published',
          wordCount: 150,
          updatedAt: '2026-08-01',
        },
        {
          id: 'ch-2',
          number: 2,
          title: '長夜',
          status: 'published',
          wordCount: 150,
          updatedAt: '2026-08-02',
        },
        {
          id: 'ch-3',
          number: 3,
          title: '孤城',
          status: 'draft',
          wordCount: 0,
          updatedAt: '2026-08-03',
        },
        {
          id: 'ch-4',
          number: 4,
          title: '歸途',
          status: 'draft',
          wordCount: 120,
          updatedAt: '2026-08-04',
        },
      ],
    },
  ],
};

function renderView() {
  return render(<NovelManageView novel={NOVEL} categories={CATEGORIES} tags={TAGS} />);
}

/** 找出「已選 N 章」那一行，回傳它與它所屬的即時區域（找不到即回 `null`） */
function selectionCountLine(): { line: HTMLElement; live: HTMLElement | null } {
  const line = screen.getByText(/^已選 \d+ 章$/);
  return { line, live: line.closest('[aria-live]') };
}

describe('T046 卷內批次操作的無障礙（FR-030／FR-031／FR-032）', () => {
  it('選取前、全選後、刪除確認開啟時，axe 皆零違規', async () => {
    renderView();

    expect((await axe.run(document.body, AXE_OPTIONS)).violations).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: '全選本卷' }));
    expect((await axe.run(document.body, AXE_OPTIONS)).violations).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: '批次刪除' }));
    expect(screen.getByRole('dialog')).not.toBeNull();
    expect((await axe.run(document.body, AXE_OPTIONS)).violations).toEqual([]);
  });

  it('(a) 每個核取方塊的可及名稱含章號與標題（FR-030）', () => {
    renderView();

    // 一排只叫「選取」的核取方塊，對讀螢幕的作者等於一排無法區分的核取方塊
    for (const [number, title] of [
      [1, '破曉'],
      [2, '長夜'],
      [3, '孤城'],
      [4, '歸途'],
    ] as const) {
      const box = screen.getByRole('checkbox', { name: `選取第 ${number} 章〈${title}〉` });
      expect((box as HTMLInputElement).type).toBe('checkbox');
    }
  });

  it('(b) 選取數的變動落在 aria-live 區域之內（FR-031）', () => {
    renderView();

    const before = selectionCountLine();
    expect(before.line.textContent).toBe('已選 0 章');
    // 屬性存在還不夠 —— 要的是**那個數字真的寫在該區域裡**，
    // 寫在區域外的話，螢幕閱讀器不會在選取變動時讀出任何東西
    expect(before.live, '選取數不在任何 aria-live 區域內').not.toBeNull();
    expect(before.live?.getAttribute('aria-live')).toBe('polite');

    fireEvent.click(screen.getByRole('checkbox', { name: '選取第 3 章〈孤城〉' }));
    expect(selectionCountLine().line.textContent).toBe('已選 1 章');

    fireEvent.click(screen.getByRole('button', { name: '只選草稿' }));
    const afterDrafts = selectionCountLine();
    expect(afterDrafts.line.textContent).toBe('已選 2 章');
    expect(afterDrafts.live).toBe(before.live);

    fireEvent.click(screen.getByRole('button', { name: '全選本卷' }));
    expect(selectionCountLine().line.textContent).toBe('已選 4 章');

    fireEvent.click(screen.getByRole('button', { name: '清除選取' }));
    expect(selectionCountLine().line.textContent).toBe('已選 0 章');
  });

  it('(c) 刪除警語（含已發佈章節數）是 aria-describedby 目標的一部分（FR-032／FR-016）', () => {
    renderView();

    fireEvent.click(screen.getByRole('button', { name: '全選本卷' }));
    fireEvent.click(screen.getByRole('button', { name: '批次刪除' }));

    const dialog = screen.getByRole('dialog');
    const describedBy = dialog.getAttribute('aria-describedby');
    expect(describedBy, '刪除確認沒有 aria-describedby').toBeTruthy();

    const description = describedBy!
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ');

    // 聽不到這句話，這道加強確認對讀螢幕的作者就等於不存在
    expect(description).toContain('其中 2 章已發佈');
    expect(description).toContain('刪除後無法復原');
  });
});
