'use client';

import React, { useMemo, useState } from 'react';
import { NovelCard } from '@/components/novel/NovelCard';
import type { Novel } from '@/lib/types';
import styles from './CategoryNovelGrid.module.css';

interface CategoryNovelGridProps {
  novels: Novel[];
}

type SortKey = 'rating' | 'weeklyViews' | 'wordCount' | 'chapterCount';

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'rating', label: '評分最高' },
  { key: 'weeklyViews', label: '人氣最高' },
  { key: 'wordCount', label: '字數最多' },
  { key: 'chapterCount', label: '章節最多' },
];

/** 分類詳情頁的作品網格（僅排序，分類已由路由決定） */
export function CategoryNovelGrid({ novels }: CategoryNovelGridProps) {
  const [sortKey, setSortKey] = useState<SortKey>('weeklyViews');

  const sorted = useMemo(
    () => [...novels].sort((a, b) => (b[sortKey] ?? 0) - (a[sortKey] ?? 0)),
    [novels, sortKey]
  );

  if (novels.length === 0) {
    return <p className={styles.empty}>此分類目前尚無作品，敬請期待。</p>;
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <p className={styles.count}>
          共 <strong>{novels.length}</strong> 部作品
        </p>
        <label className={styles.sort}>
          <span className={styles.sort__label}>排序</span>
          <select
            className={styles.sort__select}
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
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

      <div className={styles.grid}>
        {sorted.map((novel) => (
          <NovelCard key={novel.id} novel={novel} />
        ))}
      </div>
    </div>
  );
}
