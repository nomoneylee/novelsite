'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { MagnifyingGlass, BookOpen, ArrowRight } from '@phosphor-icons/react';
import { Tabs, TabList, Tab, TabPanel } from '@/components/ui/Tabs';
import type { Volume } from '@/lib/types';
import styles from './ChapterList.module.css';

interface ChapterListProps {
  novelId: string;
  volumes: Volume[];
  latestChapterId: string;
  firstChapterId: string;
}

function formatWordCount(n: number): string {
  return `${n.toLocaleString()} 字`;
}

export function ChapterList({
  novelId,
  volumes,
  latestChapterId,
  firstChapterId,
}: ChapterListProps) {
  const [activeVolume, setActiveVolume] = useState(volumes[0]?.id ?? '');
  const [searchQuery, setSearchQuery] = useState('');

  const currentVolume = useMemo(
    () => volumes.find((v) => v.id === activeVolume),
    [volumes, activeVolume]
  );

  const filteredChapters = useMemo(() => {
    if (!currentVolume) return [];
    if (!searchQuery.trim()) return currentVolume.chapters;
    const q = searchQuery.toLowerCase();
    return currentVolume.chapters.filter(
      (ch) => ch.title.toLowerCase().includes(q) || ch.number.toString().includes(q)
    );
  }, [currentVolume, searchQuery]);

  // 計算跨捲的總章節數統計
  const totalChapters = volumes.reduce((acc, v) => acc + v.chapters.length, 0);

  if (volumes.length === 0) {
    return (
      <div className={styles.empty} id="chapter-list">
        <BookOpen size={40} />
        <p>章節整理中，敬請期待</p>
      </div>
    );
  }

  return (
    <section className={styles.list} id="chapter-list">
      {/* 標題列 */}
      <div className={styles.list__header}>
        <h2 className={styles.list__title}>章節目錄</h2>
        <div className={styles.list__header__meta}>
          <span className={styles.list__count}>共 {totalChapters} 章</span>
          {/* 捷徑按鈕 */}
          <Link
            href={`/reader/${novelId}/${firstChapterId}`}
            className={styles.list__shortcut}
            id="read-from-start-btn"
          >
            從頭閱讀
          </Link>
          <Link
            href={`/reader/${novelId}/${latestChapterId}`}
            className={`${styles.list__shortcut} ${styles['list__shortcut--accent']}`}
            id="read-latest-btn"
          >
            最新章節 <ArrowRight size={14} />
          </Link>
        </div>
      </div>

      {/* 搜尋框 */}
      <div className={styles.list__search}>
        <MagnifyingGlass className={styles.list__search__icon} size={16} />
        <input
          className={styles.list__search__input}
          type="search"
          placeholder="搜尋章節名稱或編號…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          id="chapter-search-input"
          aria-label="搜尋章節"
        />
      </div>

      {/* 分捲 Tabs（多捲時才顯示） */}
      {volumes.length > 1 && !searchQuery && (
        <Tabs value={activeVolume} onChange={setActiveVolume} variant="pills">
          <TabList className={styles.list__tablist}>
            {volumes.map((vol) => (
              <Tab key={vol.id} value={vol.id}>
                {vol.title}
              </Tab>
            ))}
          </TabList>

          {volumes.map((vol) => (
            <TabPanel key={vol.id} value={vol.id}>
              <ChapterGrid novelId={novelId} chapters={vol.chapters} />
            </TabPanel>
          ))}
        </Tabs>
      )}

      {/* 搜尋結果或單捲模式 */}
      {(volumes.length === 1 || searchQuery) && (
        <>
          {searchQuery && (
            <p className={styles.list__search__result}>
              搜尋「{searchQuery}」找到 {filteredChapters.length} 章
            </p>
          )}
          <ChapterGrid novelId={novelId} chapters={filteredChapters} />
        </>
      )}
    </section>
  );
}

// ─── 章節格格子（內部元件） ────────────────────────────────
interface ChapterGridProps {
  novelId: string;
  chapters: Volume['chapters'];
}

function ChapterGrid({ novelId, chapters }: ChapterGridProps) {
  if (chapters.length === 0) {
    return <p className={styles.grid__empty}>找不到相關章節</p>;
  }

  return (
    <div className={styles.grid}>
      {chapters.map((ch) => (
        <Link
          key={ch.id}
          href={`/reader/${novelId}/${ch.id}`}
          className={`${styles.grid__item} ${ch.isLatest ? styles['grid__item--latest'] : ''}`}
          id={`chapter-${ch.id}`}
        >
          <div className={styles.grid__item__header}>
            <span className={styles.grid__item__num}>第 {ch.number} 章</span>
            {ch.isLatest && <span className={styles.grid__item__badge}>最新</span>}
          </div>
          <p className={styles.grid__item__title}>{ch.title}</p>
          <div className={styles.grid__item__meta}>
            <span>{formatWordCount(ch.wordCount)}</span>
            <span>{ch.publishedAt}</span>
          </div>
        </Link>
      ))}
    </div>
  );
}
