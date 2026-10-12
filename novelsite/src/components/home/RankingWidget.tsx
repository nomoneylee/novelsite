'use client';

import React, { useEffect, useRef } from 'react';
import Link from 'next/link';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { CaretUp, CaretDown, Minus, Star, Sparkle } from '@phosphor-icons/react';
import type { RankingItem } from '@/lib/types';
import styles from './RankingWidget.module.css';

gsap.registerPlugin(ScrollTrigger);

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <span className={`${styles.badge} ${styles['badge--gold']}`}>🥇</span>;
  if (rank === 2) return <span className={`${styles.badge} ${styles['badge--silver']}`}>🥈</span>;
  if (rank === 3) return <span className={`${styles.badge} ${styles['badge--bronze']}`}>🥉</span>;
  return <span className={styles.badge__num}>{rank.toString().padStart(2, '0')}</span>;
}

function ChangeIndicator({ change, count }: { change?: RankingItem['change']; count?: number }) {
  if (change === 'up') {
    return (
      <span className={`${styles.change} ${styles['change--up']}`}>
        <CaretUp size={10} weight="bold" />
        {count}
      </span>
    );
  }
  if (change === 'down') {
    return (
      <span className={`${styles.change} ${styles['change--down']}`}>
        <CaretDown size={10} weight="bold" />
        {count}
      </span>
    );
  }
  if (change === 'new') {
    return (
      <span className={`${styles.change} ${styles['change--new']}`}>
        <Sparkle size={10} weight="fill" />新
      </span>
    );
  }
  return (
    <span className={`${styles.change} ${styles['change--same']}`}>
      <Minus size={10} weight="bold" />
    </span>
  );
}

interface RankingWidgetProps {
  items: RankingItem[];
}

export function RankingWidget({ items }: RankingWidgetProps) {
  const containerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const mm = gsap.matchMedia();

    mm.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.from(containerRef.current!.querySelectorAll('[data-rank-item]'), {
        opacity: 0,
        x: -16,
        duration: 0.45,
        ease: 'power1.out',
        stagger: 0.05,
        scrollTrigger: {
          trigger: containerRef.current,
          start: 'top 85%',
          once: true,
        },
      });
    });

    return () => mm.revert();
  }, []);

  return (
    <aside
      ref={containerRef}
      className={styles.widget}
      aria-label="本週熱門排行榜"
      id="ranking-widget"
    >
      {/* 標題 */}
      <div className={styles.widget__header}>
        <div className={styles.widget__header__left}>
          <Star size={18} weight="fill" className={styles.widget__header__icon} />
          <h2 className={styles.widget__title}>本週熱門</h2>
        </div>
        <Link href="/ranking" className={styles.widget__more} id="ranking-more-btn">
          完整榜單 →
        </Link>
      </div>

      {/* 空狀態（FR-043b 第 3 項）：排行由每日重算產生，尚未重算或統計為空時即為空榜。
          MUST NOT 以任何寫死的名次填充 —— 那正是 4-D 之前的作法（FR-043a） */}
      {items.length === 0 ? (
        <p className={styles.widget__empty}>尚未產生本週排行，有閱讀與互動之後就會出現。</p>
      ) : (
        /* 榜單 */
        <ol className={styles.widget__list}>
          {items.map((item) => (
            <li key={item.novel.id} className={styles.item} data-rank-item>
              <Link
                href={`/novels/${item.novel.id}`}
                className={styles.item__link}
                id={`rank-item-${item.rank}`}
              >
                {/* 排名 */}
                <div className={styles.item__rank}>
                  <RankBadge rank={item.rank} />
                </div>

                {/* 封面小圖 */}
                <div
                  className={styles.item__cover}
                  style={{ background: item.novel.coverColor }}
                  aria-hidden="true"
                >
                  <span className={styles.item__cover__initial}>{item.novel.title.charAt(0)}</span>
                </div>

                {/* 資訊 */}
                <div className={styles.item__info}>
                  <p className={styles.item__title}>{item.novel.title}</p>
                  <p className={styles.item__meta}>
                    <span className={styles.item__author}>{item.novel.author}</span>
                    <span className={styles.item__sep}>·</span>
                    <span className={styles.item__category}>{item.novel.category}</span>
                  </p>
                </div>

                {/* 變化指示 */}
                <div className={styles.item__change}>
                  <ChangeIndicator change={item.change} count={item.changeCount} />
                </div>
              </Link>
            </li>
          ))}
        </ol>
      )}

      {/* 底部 CTA */}
      <div className={styles.widget__footer}>
        <Link href="/ranking" className={styles.widget__footer__btn} id="ranking-full-btn">
          查看完整排行榜
        </Link>
      </div>
    </aside>
  );
}
