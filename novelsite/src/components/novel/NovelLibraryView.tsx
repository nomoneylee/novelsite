'use client';

import React, { useMemo, useState } from 'react';
import { MagnifyingGlass } from '@phosphor-icons/react';
import { NovelCard } from '@/components/novel/NovelCard';
import type { Novel, Category } from '@/lib/types';
import styles from './NovelLibraryView.module.css';

interface NovelLibraryViewProps {
  novels: Novel[];
  categories: Category[];
}

type SortKey = 'rating' | 'wordCount' | 'chapterCount' | 'weeklyViews';

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'rating', label: '評分最高' },
  { key: 'weeklyViews', label: '人氣最高' },
  { key: 'wordCount', label: '字數最多' },
  { key: 'chapterCount', label: '章節最多' },
];

const PAGE_SIZE = 6;

export function NovelLibraryView({ novels, categories }: NovelLibraryViewProps) {
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('rating');
  const [keyword, setKeyword] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    const result = novels.filter((n) => {
      if (activeCategory && n.category !== activeCategory) return false;
      if (q) {
        const haystack = [n.title, n.author, n.category, ...(n.tags ?? [])].join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });

    return [...result].sort((a, b) => (b[sortKey] ?? 0) - (a[sortKey] ?? 0));
  }, [novels, activeCategory, sortKey, keyword]);

  // 篩選條件變動時，重置分頁到第一頁
  const resetPaging = () => setVisibleCount(PAGE_SIZE);

  const visible = filtered.slice(0, visibleCount);
  const hasMore = visibleCount < filtered.length;

  return (
    <div className={styles.view}>
      {/* 工具列：搜尋 + 排序 */}
      <div className={styles.toolbar}>
        <div className={styles.search}>
          <MagnifyingGlass size={18} className={styles.search__icon} />
          <input
            type="search"
            className={styles.search__input}
            placeholder="在書庫中搜尋書名、作者或標籤…"
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value);
              resetPaging();
            }}
            aria-label="書庫關鍵字搜尋"
          />
        </div>

        <label className={styles.sort}>
          <span className={styles.sort__label}>排序</span>
          <select
            className={styles.sort__select}
            value={sortKey}
            onChange={(e) => {
              setSortKey(e.target.value as SortKey);
              resetPaging();
            }}
            aria-label="排序方式"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.key} value={opt.key}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* 分類篩選 */}
      <div className={styles.categoryFilter} role="group" aria-label="依分類篩選">
        <button
          type="button"
          className={`${styles.categoryChip} ${activeCategory === null ? styles['categoryChip--active'] : ''}`}
          onClick={() => {
            setActiveCategory(null);
            resetPaging();
          }}
        >
          全部分類
        </button>
        {categories.map((cat) => (
          <button
            key={cat.id}
            type="button"
            className={`${styles.categoryChip} ${activeCategory === cat.label ? styles['categoryChip--active'] : ''}`}
            onClick={() => {
              setActiveCategory(cat.label);
              resetPaging();
            }}
          >
            <span aria-hidden="true">{cat.emoji}</span> {cat.label}
          </button>
        ))}
      </div>

      {/* 結果統計 */}
      <p className={styles.resultCount}>
        共 <strong>{filtered.length}</strong> 部作品
      </p>

      {/* 卡片網格 */}
      {filtered.length === 0 ? (
        <p className={styles.empty}>找不到符合條件的作品，試試調整篩選或關鍵字。</p>
      ) : (
        <>
          <div className={styles.grid}>
            {visible.map((novel) => (
              <NovelCard key={novel.id} novel={novel} />
            ))}
          </div>

          {hasMore && (
            <div className={styles.loadMore}>
              <button
                type="button"
                className={styles.loadMore__btn}
                onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
              >
                載入更多（剩 {filtered.length - visibleCount} 部）
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
