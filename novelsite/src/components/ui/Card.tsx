import React from 'react';
import Image from 'next/image';
import styles from './Card.module.css';
import { Badge, CATEGORY_VARIANT_MAP } from './Badge';

export interface CardProps {
  id: string;
  title: string;
  author: string;
  cover?: string;
  category?: string;
  wordCount?: number;
  updateFreq?: string;
  excerpt?: string;
  rating?: number;
  chapterCount?: number;
  onClick?: () => void;
  className?: string;
  variant?: 'default' | 'compact' | 'featured';
}

function formatWordCount(count: number): string {
  if (count >= 10000) return `${(count / 10000).toFixed(1)}萬字`;
  return `${count}字`;
}

function StarRating({ rating }: { rating: number }) {
  const stars = Math.round(rating);
  return (
    <span className={styles.card__stars} aria-label={`評分 ${rating} 分`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <span
          key={i}
          className={i < stars ? styles['card__star--filled'] : styles['card__star--empty']}
          aria-hidden="true"
        >
          ★
        </span>
      ))}
      <span className={styles.card__rating}>{rating.toFixed(1)}</span>
    </span>
  );
}

export function Card({
  title,
  author,
  cover,
  category,
  wordCount,
  excerpt,
  rating,
  chapterCount,
  onClick,
  className = '',
  variant = 'default',
}: CardProps) {
  const classes = [
    styles.card,
    styles[`card--${variant}`],
    onClick ? styles['card--clickable'] : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <article
      className={classes}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}
    >
      {/* 封面圖 */}
      <div className={styles.card__cover}>
        {cover ? (
          <Image
            src={cover}
            alt={`${title} 封面`}
            fill
            sizes="(max-width: 768px) 100px, 120px"
            style={{ objectFit: 'cover' }}
          />
        ) : (
          <div className={styles.card__cover__placeholder}>
            <span className={styles.card__cover__initials}>{title.charAt(0)}</span>
          </div>
        )}
      </div>

      {/* 內容 */}
      <div className={styles.card__body}>
        {/* 分類標籤 */}
        {category && (
          <Badge
            variant={CATEGORY_VARIANT_MAP[category] ?? 'default'}
            size="sm"
            className={styles.card__badge}
          >
            {category}
          </Badge>
        )}

        <h3 className={styles.card__title}>{title}</h3>

        <p className={styles.card__author}>
          <span className={styles.card__author__label}>作者</span>
          <span>{author}</span>
        </p>

        {excerpt && variant !== 'compact' && <p className={styles.card__excerpt}>{excerpt}</p>}

        <div className={styles.card__meta}>
          {wordCount !== undefined && (
            <span className={styles.card__meta__item}>{formatWordCount(wordCount)}</span>
          )}
          {chapterCount !== undefined && (
            <span className={styles.card__meta__item}>{chapterCount} 章</span>
          )}
          {rating !== undefined && <StarRating rating={rating} />}
        </div>
      </div>
    </article>
  );
}
