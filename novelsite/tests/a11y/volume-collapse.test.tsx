/**
 * a11y 互動狀態層：卷的展開／收合（FEAT-10 T012，FR-002／FR-003／FR-004／FR-005）
 * ==============================================================================
 * 以 React Testing Library 渲染 `NovelManageView`（Client Component），
 * 驗證卷標題列的摺疊控制在**語意**與**預設規則**上成立，並在收合／展開兩個狀態各跑一次 axe。
 *
 * **本檔的假資料產生器 `makeNovel()` 是共用的**：T019（捲動容器）與 T027（批次選取）
 * 都往本檔追加案例，都需要「0 卷／1 卷／多卷／3 章／120 章」各種組合。
 *
 * **MUST NOT 在本檔斷言「120 章出現捲軸／3 章不出現」**：jsdom 沒有 layout
 * （`scrollHeight` 恆為 0），且純 CSS `max-height` 方案下 3 章與 120 章渲染出來的 DOM
 * **完全相同** —— 那樣的斷言兩側都會通過而其實什麼都沒驗（research R-8）。
 * 捲動容器由 `tests/unit/scroll-container-css.test.ts` 斷言 CSS 規則、
 * 由本檔斷言 DOM 結構、由手動驗證實際行為，三段合起來才構成證據鏈。
 *
 * **Server Action MUST 換成替身**：`@/app/author/actions` 會拉進 `server-only` 的服務層，
 * 在 jsdom 條件下載入即擲錯。`next/navigation` 同樣沒有 App Router 的 context。
 * 兩者皆沿用 `tests/a11y/batch-actions.test.tsx` 的寫法。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as axe from 'axe-core';
import { NovelManageView } from '@/components/author/NovelManageView';
import type { AuthorManageChapter, AuthorNovelManage, Category, TagOption } from '@/lib/types';

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

// ─────────────────────────────────────────────────────────────────────────────
// 共用假資料產生器（T012 建立，T019／T027 沿用）
// ─────────────────────────────────────────────────────────────────────────────

interface VolumeSpec {
  /** 該卷的章節數 */
  chapters: number;
  /** 其中前幾章為 `published`（預設 0） */
  published?: number;
  /**
   * 其中幾章為 `admin_suspended`（自尾端取，預設 0）。
   * **這個選項的存在本身就是一條斷言**：FR-002 明訂 `admin_suspended` 計入「草稿」，
   * 而少了它，摘要把第三種狀態算成什麼都測不出來。
   */
  suspended?: number;
  title?: string;
}

/**
 * 依卷／章的數量與狀態組出 `AuthorNovelManage`。
 *
 * 章號在**整部作品內連續**（與真實資料一致：`volume.chapters[].number` 不是卷內序號），
 * 這樣「選取第 N 章〈標題〉」這類可及名稱在多卷情境下才不會重複。
 */
function makeNovel(spec: { volumes: VolumeSpec[] }): AuthorNovelManage {
  let chapterNumber = 0;
  const volumes = spec.volumes.map((volumeSpec, volumeIndex) => {
    const published = volumeSpec.published ?? 0;
    const suspended = volumeSpec.suspended ?? 0;
    const chapters: AuthorManageChapter[] = Array.from(
      { length: volumeSpec.chapters },
      (_, index) => {
        chapterNumber += 1;
        const isPublished = index < published;
        const isSuspended = index >= volumeSpec.chapters - suspended;
        return {
          id: `ch-${chapterNumber}`,
          number: chapterNumber,
          title: `第 ${chapterNumber} 章的標題`,
          status: isSuspended ? 'admin_suspended' : isPublished ? 'published' : 'draft',
          wordCount: 100 + index,
          updatedAt: '2026-09-01',
        };
      }
    );
    return {
      id: `vol-${volumeIndex + 1}`,
      number: volumeIndex + 1,
      title: volumeSpec.title ?? `卷名 ${volumeIndex + 1}`,
      chapters,
    };
  });

  return {
    id: 'novel-1',
    title: '摺疊測試作品',
    excerpt: '摘要',
    description: '簡介',
    categoryId: 'cat-1',
    category: '玄幻',
    coverColor: '#334155',
    status: 'draft',
    serialStatus: 'ongoing',
    tagIds: [],
    wordCount: volumes.reduce((sum, v) => sum + v.chapters.length * 100, 0),
    chapterCount: volumes.reduce((sum, v) => sum + v.chapters.length, 0),
    volumes,
  };
}

function renderNovel(novel: AuthorNovelManage) {
  return render(<NovelManageView novel={novel} categories={CATEGORIES} tags={TAGS} />);
}

/** 第 N 卷的展開／收合控制。可及名稱以「第 N 卷・」起首（卷號、卷名、章數摘要同在其內） */
function volumeToggle(number: number): HTMLElement {
  return screen.getByRole('button', { name: new RegExp(`^第 ${number} 卷・`) });
}

function isExpanded(button: HTMLElement): boolean {
  return button.getAttribute('aria-expanded') === 'true';
}

// ─────────────────────────────────────────────────────────────────────────────
// T012：摺疊控制的語意與預設規則
// ─────────────────────────────────────────────────────────────────────────────

describe('T012 卷的展開／收合（FR-002～FR-005）', () => {
  it('展開控制是原生 <button type="button">，且 aria-expanded 在兩種狀態各自正確（FR-003）', () => {
    renderNovel(makeNovel({ volumes: [{ chapters: 3 }, { chapters: 3 }] }));

    const toggle = volumeToggle(1);
    expect(toggle.tagName).toBe('BUTTON');
    // `type` MUST 是 button —— 預設的 submit 會在任何祖先 <form> 裡送出表單
    expect((toggle as HTMLButtonElement).type).toBe('button');
    // MUST NOT 用 role 覆寫成別的東西（覆寫掉就沒有原生的鍵盤啟動了）
    expect(toggle.getAttribute('role')).toBeNull();

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(volumeToggle(1).getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(volumeToggle(1));
    expect(volumeToggle(1).getAttribute('aria-expanded')).toBe('false');
  });

  /**
   * **鍵盤 Enter／空白鍵（FR-003）以「控制項是原生 `<button>`」承載，而非合成按鍵**。
   *
   * jsdom **不實作鍵盤的 activation behavior**：對一個真正的 `<button>` 送
   * `fireEvent.keyDown(el, { key: 'Enter' })`，jsdom 不會因此派送 `click`。
   * 於是那樣的斷言只有兩種結局 —— 恆紅（正確實作也過不了），
   * 或為了讓它綠而在元件上補一個瀏覽器本來就會做的 `onKeyDown`，
   * 而**那個多餘的處理器反而會讓空白鍵在真實瀏覽器裡觸發兩次**。
   *
   * 真正要防的失效是「用 `<div onClick>` 或 `role="button"` 的 span 做摺疊控制」——
   * 那才是鍵盤使用者按不動的原因，而上一條的 `tagName`／`type`／`role` 三項斷言
   * 正好把它擋掉。實際按鍵行為由 T023 的 E2E（真實瀏覽器）承載。
   */
  it('鍵盤啟動由原生按鈕語意保證：控制項可聚焦且不被 tabindex 排除（FR-003）', () => {
    renderNovel(makeNovel({ volumes: [{ chapters: 3 }, { chapters: 3 }] }));

    const toggle = volumeToggle(1);
    // 負 tabindex 會讓它從 Tab 序列消失 —— 按得到才談得上按 Enter
    expect(toggle.getAttribute('tabindex')).toBeNull();
    toggle.focus();
    expect(document.activeElement).toBe(toggle);
  });

  it('單卷作品預設展開；兩卷以上預設全部收合（FR-004）', () => {
    const single = renderNovel(makeNovel({ volumes: [{ chapters: 3, published: 1 }] }));
    expect(isExpanded(volumeToggle(1))).toBe(true);
    single.unmount();

    renderNovel(makeNovel({ volumes: [{ chapters: 3 }, { chapters: 3 }, { chapters: 3 }] }));
    for (const n of [1, 2, 3]) expect(isExpanded(volumeToggle(n))).toBe(false);
  });

  it('多卷可同時展開，且展開一卷 MUST NOT 收起另一卷（FR-005）', () => {
    renderNovel(makeNovel({ volumes: [{ chapters: 3 }, { chapters: 3 }, { chapters: 3 }] }));

    fireEvent.click(volumeToggle(2));
    fireEvent.click(volumeToggle(3));

    expect(isExpanded(volumeToggle(1))).toBe(false);
    expect(isExpanded(volumeToggle(2))).toBe(true);
    expect(isExpanded(volumeToggle(3))).toBe(true);
  });

  it('收合狀態即顯示卷號、卷名、章節總數與已發佈／草稿數（FR-002）', () => {
    // 40 章：32 已發佈、6 草稿、2 被下架 —— 下架的 MUST 計入草稿，草稿欄因此是 8
    renderNovel(
      makeNovel({ volumes: [{ chapters: 40, published: 32, suspended: 2 }, { chapters: 5 }] })
    );

    const toggle = volumeToggle(1);
    expect(isExpanded(toggle)).toBe(false);
    expect(toggle.textContent).toContain('第 1 卷・卷名 1');
    expect(toggle.textContent).toContain('40 章（已發佈 32・草稿 8）');
  });

  it('0 章的卷顯示「0 章」且不被隱藏（contracts §1.2）', () => {
    renderNovel(makeNovel({ volumes: [{ chapters: 0 }, { chapters: 3 }] }));

    const toggle = volumeToggle(1);
    expect(toggle.textContent).toContain('0 章');
    // 0 章的卷 MUST NOT 出現「（已發佈 0・草稿 0）」這種只會佔位的括號
    expect(toggle.textContent).not.toContain('已發佈');
  });

  it('0 卷時不出現任何摺疊控制，且維持既有的「請先建立第一卷」空狀態（spec Edge Cases）', () => {
    renderNovel(makeNovel({ volumes: [] }));

    expect(screen.queryAllByRole('button', { name: /^第 \d+ 卷・/ })).toEqual([]);
    expect(screen.getByText(/請先於上方/).textContent).toContain('建立第一卷');
  });

  it('展開且有章節時 aria-controls 指向存在的容器；收合時只保證 aria-expanded=false', () => {
    renderNovel(makeNovel({ volumes: [{ chapters: 3 }, { chapters: 3 }] }));

    const collapsed = volumeToggle(1);
    const controls = collapsed.getAttribute('aria-controls');
    expect(controls, 'aria-controls MUST 存在（即使目標尚未渲染）').toBeTruthy();
    /*
      收合時**不**斷言目標存在：章節清單是條件渲染（T016），容器本來就不在 DOM 裡。
      ARIA 容許 aria-expanded="false" 時的懸空 aria-controls，axe 對此回報 incomplete 而非 violation。
    */
    expect(collapsed.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(collapsed);
    expect(
      document.getElementById(controls!),
      '展開後 aria-controls 的目標 MUST 存在'
    ).not.toBeNull();
  });

  it('收合與展開兩個狀態，axe 皆零違規', async () => {
    renderNovel(makeNovel({ volumes: [{ chapters: 4, published: 2 }, { chapters: 3 }] }));

    /*
      斷言對象 MUST 是 violations。axe-core 對 aria-expanded="false" 上的懸空
      aria-controls 回報的是 incomplete（需人工複核）而非 violation ——
      斷言 incomplete 為空會讓收合狀態恆紅，而那是一個合規的狀態。
    */
    expect((await axe.run(document.body, AXE_OPTIONS)).violations).toEqual([]);

    fireEvent.click(volumeToggle(1));
    expect((await axe.run(document.body, AXE_OPTIONS)).violations).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T019：章節清單的捲動容器（DOM 結構層，contracts §2.2／§2.3）
// ─────────────────────────────────────────────────────────────────────────────

describe('T019 章節清單的捲動容器（FR-009／FR-010）', () => {
  /**
   * 本組**只驗 DOM 結構**：容器在不在、包住什麼、帶哪些屬性。
   *
   * **MUST NOT 在這裡斷言「120 章出現捲軸／3 章不出現」**：jsdom 沒有版面計算，
   * 且純 CSS `max-height` 方案下兩者的 DOM 完全相同 —— 那樣的斷言兩側都會通過
   * 而其實什麼都沒驗（research R-8）。CSS 規則由 `tests/unit/scroll-container-css.test.ts`
   * 斷言，門檻兩側的實際行為由 T034 手動驗證，三段合起來才構成證據鏈。
   */
  function expandedContainer(volumeNumber: number): HTMLElement {
    const toggle = volumeToggle(volumeNumber);
    if (!isExpanded(toggle)) fireEvent.click(toggle);
    const id = volumeToggle(volumeNumber).getAttribute('aria-controls')!;
    const container = document.getElementById(id);
    expect(container, '展開後 aria-controls 的目標 MUST 存在').not.toBeNull();
    return container!;
  }

  it('捲動容器包住 <ul>，且容器的 id 就是 aria-controls 指向的那一個', () => {
    renderNovel(makeNovel({ volumes: [{ chapters: 3 }, { chapters: 3 }] }));

    const container = expandedContainer(1);
    // 章節清單 MUST 在容器**之內** —— 容器沒包住它的話，捲的就是整頁
    const list = container.querySelector('ul');
    expect(list, '捲動容器內 MUST 有章節清單 <ul>').not.toBeNull();
    expect(list!.parentElement).toBe(container);
    // 三章都在清單裡（容器沒有意外只包住一部分）
    expect(list!.querySelectorAll('li')).toHaveLength(3);
  });

  it('容器可聚焦且有可辨識名稱（tabIndex=0 與 aria-label，contracts §2.2）', () => {
    renderNovel(makeNovel({ volumes: [{ chapters: 3 }, { chapters: 4 }] }));

    const container = expandedContainer(2);
    /*
      **Chromium 與 WebKit 不會自動讓可捲動的 <div> 可聚焦，Firefox 會**（research R-5）。
      少了 tabIndex 就是在 Firefox 上測全綠、其他瀏覽器的鍵盤使用者完全捲不動 ——
      那 110 章對他們等同不存在，WCAG 2.1.1 直接違反。
    */
    expect(container.getAttribute('tabindex')).toBe('0');
    // 可聚焦但沒有名稱的區域，螢幕閱讀器只會唸「群組」
    expect(container.getAttribute('aria-label')).toBe('第 2 卷的章節清單');
  });

  it('卷標題列、新增章節與批次操作列都 MUST 留在容器之外（FR-009、contracts §2.3）', () => {
    renderNovel(makeNovel({ volumes: [{ chapters: 3 }, { chapters: 3 }] }));

    const container = expandedContainer(1);
    /*
      這三者若被捲走，作者捲到第 80 章時就看不到「全選本卷」也看不到自己在哪一卷 ——
      FR-009 要的正是它們位置不變。作法上它們位於容器之外，因此天然滿足；
      這條斷言擋的是「圖省事把整個卷區塊都設成 overflow: auto」那種寫法。
    */
    expect(container.contains(volumeToggle(1))).toBe(false);
    for (const name of [/新增章節/, /全選/]) {
      const buttons = screen.queryAllByRole('button', { name });
      // 先確認真的找得到 —— 名稱改了而斷言恆真地通過，是這一條最容易的失效方式
      expect(buttons.length, `找不到名稱符合 ${name} 的按鈕`).toBeGreaterThan(0);
      for (const button of buttons) expect(container.contains(button)).toBe(false);
    }
  });

  it('展開且有捲動容器的狀態，axe 零違規', async () => {
    renderNovel(makeNovel({ volumes: [{ chapters: 5, published: 2 }, { chapters: 3 }] }));

    expandedContainer(1);
    expect((await axe.run(document.body, AXE_OPTIONS)).violations).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T027：批次選取的範圍不因摺疊或捲動而改變（contracts §3）
// ─────────────────────────────────────────────────────────────────────────────

describe('T027 批次選取的語意（FR-014～FR-016）', () => {
  /** 第 N 章的核取方塊。可及名稱由 `<label class="sr-only">` 提供（章號＋標題） */
  function chapterCheckbox(chapterNumber: number): HTMLInputElement {
    return screen.getByLabelText(
      `選取第 ${chapterNumber} 章〈第 ${chapterNumber} 章的標題〉`
    ) as HTMLInputElement;
  }

  it('120 章的卷按「全選本卷」選到的是 120 章，不是畫面上看得到的那幾章（FR-014、SC-005）', () => {
    // 單卷 → 預設展開（contracts §5），不必先點開
    renderNovel(makeNovel({ volumes: [{ chapters: 120 }] }));

    fireEvent.click(screen.getByRole('button', { name: '全選本卷' }));

    /*
      **這一條擋的是「把 `chapters` 換成已渲染／可見的子集」**（contracts §3）：
      作者在 120 章的卷按全選並批次發佈時，若只送畫面上那十幾章，
      畫面上不會有任何跡象顯示漏了 100 章 —— 沒有錯誤、沒有警告，就是少發了。
    */
    expect(screen.getByText('已選 120 章')).toBeTruthy();

    /*
      **範圍限定在該卷的捲動容器內**：`getAllByRole('checkbox')` 會連作品資訊表單的
      標籤核取方塊一起撈進來，數出 121 —— 那個 121 與本條要驗的東西毫無關係。
    */
    const container = document.getElementById(volumeToggle(1).getAttribute('aria-controls')!)!;
    const boxes = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    );
    expect(boxes).toHaveLength(120);
    expect(boxes.every((box) => box.checked)).toBe(true);
  });

  it('收合再展開，既有勾選原樣還在（FR-015）', () => {
    renderNovel(makeNovel({ volumes: [{ chapters: 3 }, { chapters: 3 }] }));

    fireEvent.click(volumeToggle(1));
    fireEvent.click(chapterCheckbox(2));
    expect(chapterCheckbox(2).checked).toBe(true);

    // 收合會讓章節清單與該卷的批次操作列一起卸載（T016、contracts §2.2b）
    fireEvent.click(volumeToggle(1));
    expect(screen.queryByLabelText('選取第 2 章〈第 2 章的標題〉')).toBeNull();

    /*
      選取狀態持有於 `NovelManageView` 而非 `ChapterSection` 的捲動容器內（T029），
      因此卸載的是畫面不是資料。這一條紅掉的典型原因是有人在收合時順手
      呼叫了 `onClearSelection()` —— 那會讓作者勾了 80 章、收合看一眼別卷，回來全沒了。
    */
    fireEvent.click(volumeToggle(1));
    expect(chapterCheckbox(2).checked).toBe(true);
  });

  it('於另一卷勾選任一章即清空前一卷的勾選（FR-016，既有不變量）', () => {
    // 章號在整部作品內連續：第 1～3 章屬第 1 卷，第 4～6 章屬第 2 卷
    renderNovel(makeNovel({ volumes: [{ chapters: 3 }, { chapters: 3 }] }));

    fireEvent.click(volumeToggle(1));
    fireEvent.click(volumeToggle(2));

    fireEvent.click(chapterCheckbox(1));
    expect(chapterCheckbox(1).checked).toBe(true);

    fireEvent.click(chapterCheckbox(4));
    // 批次操作限單一卷（伺服器端不變量）：跨卷的識別碼送出去會被整批拒絕
    expect(chapterCheckbox(1).checked).toBe(false);
    expect(chapterCheckbox(4).checked).toBe(true);
  });
});
