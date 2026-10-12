'use client';

import React, { useCallback, useEffect, useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MagnifyingGlass } from '@phosphor-icons/react';
import { NovelCard } from '@/components/novel/NovelCard';
import type { Category, Novel, NovelSuggestion } from '@/lib/types';
import {
  DEFAULT_SEARCH_LIMIT,
  SUGGEST_DEBOUNCE_MS,
  SUGGEST_MIN_CHARS,
} from '@/lib/validation/search';
import { apiUrl } from '@/lib/apiUrl';
import styles from './SearchView.module.css';

interface SearchViewProps {
  query: string;
  category: string;
  categories: Category[];
  /** 首屏結果，由 Server Component 呼叫 `searchService` 算好（可分享、可重載） */
  initialItems: Novel[];
  initialCursor: string | null;
}

/**
 * 搜尋頁互動（FR-030a、FR-030b、FR-031）。
 *
 * 三件事分屬不同層，**刻意不合併**：
 *  - **首屏**由 Server Component 算好傳入 —— 網址帶著關鍵字重新整理仍是同一個畫面。
 *  - **載入更多**才走 `/api/search` 的游標分頁，每頁 20 筆。
 *  - **關鍵字與分類寫進網址**；本元件在頁面上以 `key` 綁定兩者，
 *    任一變動即整個重新掛載 —— 游標因而必然回到第一頁（FR-030b），
 *    不需要在各處記得「這裡也要清掉游標」。
 *
 * 建議清單以 combobox 模式實作（contracts/search-api.md §4）：
 * id 一律由 `useId()` 產生，MUST NOT 用 `Math.random()` —— 伺服器與用戶端會產生不同的值，
 * hydration 就對不起來。
 */
export function SearchView({
  query,
  category,
  categories,
  initialItems,
  initialCursor,
}: SearchViewProps) {
  const router = useRouter();
  const inputId = useId();
  const listboxId = useId();
  const categoryId = useId();

  const [input, setInput] = useState(query);
  const [items, setItems] = useState<Novel[]>(initialItems);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  /**
   * 建議清單的狀態刻意**連同它屬於哪個關鍵字一起存**。
   * 只存 items 的話，使用者刪字時舊清單會殘留在畫面上一小段時間，
   * 而那段時間裡的建議指向的是使用者已經改掉的查詢。
   */
  const [suggestState, setSuggestState] = useState<{ term: string; items: NovelSuggestion[] }>({
    term: '',
    items: [],
  });
  /** 使用者以 Esc 關掉清單的那個關鍵字；關鍵字一變就自動失效，不需要另外清除 */
  const [dismissedTerm, setDismissedTerm] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);

  const term = input.trim();
  const eligible = term.length >= SUGGEST_MIN_CHARS;
  const suggestions = suggestState.term === term ? suggestState.items : [];
  const open = eligible && dismissedTerm !== term && suggestions.length > 0;
  const active = open && activeIndex < suggestions.length ? activeIndex : -1;

  const buildHref = useCallback((q: string, cat: string) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (cat) params.set('category', cat);
    const qs = params.toString();
    return qs ? `/search?${qs}` : '/search';
  }, []);

  // ── 即時建議：2 字元觸發、300ms 防抖（FR-031） ──
  useEffect(() => {
    // 未達觸發長度時**什麼都不做**：清單的顯示與否由 `open` 於渲染時推導，
    // 在 effect 內同步 setState 只會多繞一輪渲染（react-hooks/set-state-in-effect）
    if (!eligible) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(apiUrl(`/api/search?q=${encodeURIComponent(term)}&suggest=1`));
        if (!res.ok || cancelled) return;
        const json: { data: NovelSuggestion[] } = await res.json();
        if (cancelled) return;
        setSuggestState({ term, items: json.data });
        setActiveIndex(-1);
      } catch {
        // 建議只是輔助，失敗時安靜地不顯示 —— 為此擋住輸入框才是真正的問題
      }
    }, SUGGEST_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [term, eligible]);

  const closeSuggestions = () => {
    setDismissedTerm(term);
    setActiveIndex(-1);
  };

  const submitSearch = () => {
    closeSuggestions();
    router.push(buildHref(term, category));
  };

  const gotoSuggestion = (item: NovelSuggestion) => {
    closeSuggestions();
    router.push(`/novels/${item.id}`);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // 高亮中的建議優先；沒有高亮就送出完整搜尋（FR-031）
    if (active >= 0 && suggestions[active]) {
      gotoSuggestion(suggestions[active]);
      return;
    }
    submitSearch();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      // 焦點刻意留在輸入框：使用者按 Esc 是要關清單，不是要離開搜尋
      closeSuggestions();
      return;
    }
    if (!open || suggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    }
  };

  const handleCategoryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    // 分類變動即改寫網址並回到第一頁（FR-030b）
    router.push(buildHref(query, e.target.value));
  };

  const loadMore = async () => {
    if (!cursor || loadingMore) return;

    setLoadingMore(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams({
        q: query,
        cursor,
        limit: String(DEFAULT_SEARCH_LIMIT),
      });
      if (category) params.set('category', category);

      const res = await fetch(apiUrl(`/api/search?${params.toString()}`));
      if (!res.ok) throw new Error(`狀態碼 ${res.status}`);

      const json: { data: Novel[]; meta: { nextCursor: string | null } } = await res.json();
      setItems((prev) => [...prev, ...json.data]);
      setCursor(json.meta.nextCursor);
    } catch {
      setLoadError('載入更多作品時發生問題，請再試一次。');
    } finally {
      setLoadingMore(false);
    }
  };

  const hasCondition = Boolean(query || category);
  const activeOptionId = active >= 0 ? `${listboxId}-option-${active}` : undefined;

  return (
    <div className={styles.view}>
      <form className={styles.searchBar} onSubmit={handleSubmit} role="search">
        <MagnifyingGlass size={20} className={styles.searchBar__icon} aria-hidden="true" />
        <label className={styles.srOnly} htmlFor={inputId}>
          全站搜尋
        </label>
        <input
          id={inputId}
          type="text"
          className={styles.searchBar__input}
          placeholder="搜尋書名、作者、標籤或分類…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          {...(activeOptionId ? { 'aria-activedescendant': activeOptionId } : {})}
          autoComplete="off"
          autoFocus
        />
        <button type="submit" className={styles.searchBar__submit}>
          搜尋
        </button>

        <ul
          id={listboxId}
          role="listbox"
          aria-label="搜尋建議"
          className={styles.suggestions}
          hidden={!open}
        >
          {suggestions.map((item, index) => (
            <li
              key={item.id}
              id={`${listboxId}-option-${index}`}
              role="option"
              aria-selected={index === active}
              className={
                index === active
                  ? `${styles.suggestion} ${styles['suggestion--active']}`
                  : styles.suggestion
              }
              // onMouseDown 而非 onClick：onClick 會晚於輸入框的 blur，清單那時已經關掉了
              onMouseDown={(e) => {
                e.preventDefault();
                gotoSuggestion(item);
              }}
            >
              <span className={styles.suggestion__title}>{item.title}</span>
              <span className={styles.suggestion__author}>{item.author}</span>
            </li>
          ))}
        </ul>
      </form>

      <div className={styles.filters}>
        <label htmlFor={categoryId} className={styles.filters__label}>
          分類
        </label>
        <select
          id={categoryId}
          className={styles.filters__select}
          value={category}
          onChange={handleCategoryChange}
        >
          <option value="">全部分類</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      {hasCondition ? (
        items.length > 0 ? (
          <>
            {/*
              視覺上隱藏的區段標題：卡片標題是 `<h3>`，少了這一層，頁面的標題階層
              會從 `<h1>` 直接跳到 `<h3>`（axe `heading-order`）。
              以螢幕閱讀器瀏覽標題清單的使用者，靠的正是這個層級關係。
            */}
            <h2 className={styles.srOnly}>搜尋結果</h2>
            <p className={styles.resultCount}>
              已顯示 <strong>{items.length}</strong> 部作品
              {cursor ? '，可載入更多' : ''}
            </p>
            <div className={styles.grid}>
              {items.map((novel) => (
                <NovelCard key={novel.id} novel={novel} />
              ))}
            </div>

            {loadError ? (
              <p className={styles.loadError} role="alert">
                {loadError}
              </p>
            ) : null}

            {cursor ? (
              <button
                type="button"
                className={styles.loadMore}
                onClick={loadMore}
                disabled={loadingMore}
              >
                {loadingMore ? '載入中…' : '載入更多'}
              </button>
            ) : null}
          </>
        ) : (
          <p className={styles.empty}>找不到符合條件的作品，試試其他關鍵字或分類。</p>
        )
      ) : (
        <p className={styles.empty}>輸入關鍵字或選擇分類開始搜尋全站作品。</p>
      )}
    </div>
  );
}
