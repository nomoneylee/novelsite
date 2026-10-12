'use client';

import Link from 'next/link';
import { BookOpen, Star, Fire } from '@phosphor-icons/react';
import { Badge, CATEGORY_VARIANT_MAP } from '@/components/ui/Badge';
import type { Novel } from '@/lib/types';
import styles from './NovelCard.module.css';

function formatWordCount(count: number): string {
  if (count >= 10000) return `${(count / 10000).toFixed(0)}萬字`;
  return `${count}字`;
}

interface NovelCardProps {
  novel: Novel;
}

/** 共用小說卡片：新書區、書庫總覽頁、搜尋結果頁共用 */
export function NovelCard({ novel }: NovelCardProps) {
  return (
    <Link
      href={`/novels/${novel.id}`}
      className={styles.card}
      id={`novel-card-${novel.id}`}
      data-novel-card
      aria-label={`${novel.title}，作者：${novel.author}，評分 ${novel.rating.toFixed(1)}`}
    >
      {/* 封面 */}
      <div
        className={styles.card__cover}
        style={{ background: novel.coverColor }}
        aria-hidden="true"
      >
        <span className={styles.card__cover__initial}>{novel.title.charAt(0)}</span>
        {novel.isNew && (
          <span className={styles.card__new__badge} aria-label="新書">
            NEW
          </span>
        )}
      </div>

      {/* 內容 */}
      <div className={styles.card__body}>
        {/* 分類標籤 */}
        <Badge variant={CATEGORY_VARIANT_MAP[novel.category] ?? 'default'} size="sm">
          {novel.category}
        </Badge>

        <h3 className={styles.card__title}>{novel.title}</h3>
        <p className={styles.card__author}>{novel.author}</p>

        <p className={styles.card__excerpt}>{novel.excerpt}</p>

        {/* 標籤 */}
        {novel.tags && (
          <div className={styles.card__tags}>
            {novel.tags.slice(0, 3).map((tag) => (
              <span key={tag} className={styles.card__tag}>
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* 底部資訊 */}
        <div className={styles.card__footer}>
          <span className={styles.card__stat}>
            <Star size={13} weight="fill" className={styles.card__stat__icon} />
            {novel.rating.toFixed(1)}
          </span>
          <span className={styles.card__stat}>
            <BookOpen size={13} className={styles.card__stat__icon} />
            {novel.chapterCount} 章
          </span>
          <span className={styles.card__stat}>{formatWordCount(novel.wordCount)}</span>
        </div>

        {/* 更新頻率 */}
        {novel.updateFreq && (
          <div className={styles.card__update}>
            <Fire size={12} weight="fill" />
            {novel.updateFreq}
          </div>
        )}
      </div>
    </Link>
  );
}
