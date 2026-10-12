'use client';

import React, { useRef, useEffect } from 'react';
import Link from 'next/link';
import { CaretUp, CaretDown, Minus, Sparkle } from '@phosphor-icons/react';
import { RANKING_PERIODS } from '@/lib/types';
import type { RankingEntryView, RankingItem, RankingPeriod, Category } from '@/lib/types';
import styles from './RankingPageView.module.css';

/**
 * 排行榜頁（FEAT-4 4-D / T141）。
 *
 * **榜單內容一律由伺服器給定**：週期與分類是**查詢字串**（`?period=&categoryId=`），
 * 切換即換頁 —— 先前的作法是把三個週期的全站榜一次送到瀏覽器、由客戶端狀態切換，
 * 並以「分類 label 過濾後重新編號」偽造分類榜。那個編號與資料庫裡的名次不是同一件事，
 * 而畫面上長得一模一樣（FR-047、research R-10）。
 *
 * 查詢字串經 `validation/notification.ts` 的 `rankingQuerySchema` 驗證，
 * **非法值回退預設而非 400**：這是一個可被分享、可被手改的網址，而本頁沒有任何輸入。
 */

interface RankingPageViewProps {
  items: RankingEntryView[];
  categories: Category[];
  period: RankingPeriod;
  /** `'all'` 或 `Category.id` */
  categoryId: string;
}

const PERIOD_LABEL: Record<RankingPeriod, string> = {
  weekly: '週榜',
  monthly: '月榜',
  alltime: '總榜',
};

/** 保持查詢字串完整：只改其中一格時，另一格 MUST 被帶著走，否則切分類會把週期打回預設 */
function hrefFor(period: RankingPeriod, categoryId: string): string {
  const query = new URLSearchParams({ period, categoryId });
  return `/ranking?${query.toString()}`;
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <span className={`${styles.rank} ${styles['rank--gold']}`}>🥇</span>;
  if (rank === 2) return <span className={`${styles.rank} ${styles['rank--silver']}`}>🥈</span>;
  if (rank === 3) return <span className={`${styles.rank} ${styles['rank--bronze']}`}>🥉</span>;
  return <span className={styles.rank__num}>{rank.toString().padStart(2, '0')}</span>;
}

function ChangeIndicator({ change, count }: { change?: RankingItem['change']; count?: number }) {
  if (change === 'up') {
    return (
      <span className={`${styles.change} ${styles['change--up']}`}>
        <CaretUp size={11} weight="bold" />
        {count}
      </span>
    );
  }
  if (change === 'down') {
    return (
      <span className={`${styles.change} ${styles['change--down']}`}>
        <CaretDown size={11} weight="bold" />
        {count}
      </span>
    );
  }
  if (change === 'new') {
    return (
      <span className={`${styles.change} ${styles['change--new']}`}>
        <Sparkle size={11} weight="fill" />
        新進榜
      </span>
    );
  }
  return (
    <span className={`${styles.change} ${styles['change--same']}`}>
      <Minus size={11} weight="bold" />
    </span>
  );
}

function formatViews(n?: number): string {
  if (!n) return '—';
  if (n >= 100000000) return `${(n / 100000000).toFixed(1)}億`;
  if (n >= 10000) return `${(n / 10000).toFixed(0)}萬`;
  return n.toString();
}

export function RankingPageView({ items, categories, period, categoryId }: RankingPageViewProps) {
  const listRef = useRef<HTMLOListElement>(null);

  // GSAP Timeline：切換榜單時重新播放入場動畫
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { gsap, withReducedMotion } = await import('@/lib/gsap');
      if (cancelled || !listRef.current) return;
      const targets = listRef.current.querySelectorAll('[data-rank-row]');
      withReducedMotion(({ isReduced }) => {
        const tl = gsap.timeline();
        tl.from(targets, {
          opacity: 0,
          y: isReduced ? 0 : 14,
          duration: isReduced ? 0 : 0.35,
          stagger: isReduced ? 0 : 0.04,
          ease: 'power1.out',
          clearProps: 'opacity,transform',
        });
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [period, categoryId]);

  return (
    <div className={styles.view}>
      {/* 週/月/總榜切換：每一個都是網址，故可被分享、可被鍵盤逐一走訪 */}
      <nav className={styles.periodTabs} aria-label="排行榜週期">
        {RANKING_PERIODS.map((p) => (
          <Link
            key={p}
            href={hrefFor(p, categoryId)}
            className={`${styles.periodTab} ${p === period ? styles['periodTab--active'] : ''}`}
            aria-current={p === period ? 'page' : undefined}
          >
            {PERIOD_LABEL[p]}
          </Link>
        ))}
      </nav>

      {/* 分類篩選 */}
      <nav className={styles.categoryFilter} aria-label="依分類篩選排行榜">
        <Link
          href={hrefFor(period, 'all')}
          className={`${styles.categoryChip} ${categoryId === 'all' ? styles['categoryChip--active'] : ''}`}
          aria-current={categoryId === 'all' ? 'page' : undefined}
        >
          全部分類
        </Link>
        {categories.map((cat) => (
          <Link
            key={cat.id}
            href={hrefFor(period, cat.id)}
            className={`${styles.categoryChip} ${categoryId === cat.id ? styles['categoryChip--active'] : ''}`}
            aria-current={categoryId === cat.id ? 'page' : undefined}
          >
            <span aria-hidden="true">{cat.emoji}</span> {cat.label}
          </Link>
        ))}
      </nav>

      {/* 榜單列表。空榜是**正常狀態**（FR-043b 第 2 項）：排行由重算產生，
          尚未重算過、或該組合的統計為空時就是空的，MUST NOT 以假資料填充 */}
      {items.length === 0 ? (
        <p className={styles.empty}>
          此榜單目前尚無上榜作品 —— 排行由每日重算產生，有閱讀與互動之後就會出現。
        </p>
      ) : (
        <ol className={styles.list} ref={listRef}>
          {items.map((item) => (
            <li key={item.novel.id} data-rank-row>
              <Link
                href={`/novels/${item.novel.id}`}
                className={`${styles.row} ${item.rank <= 3 ? styles['row--top'] : ''}`}
                id={`ranking-item-${item.rank}`}
              >
                <div className={styles.row__rank}>
                  <RankBadge rank={item.rank} />
                </div>

                <div
                  className={styles.row__cover}
                  style={{ background: item.novel.coverColor }}
                  aria-hidden="true"
                >
                  <span className={styles.row__cover__initial}>{item.novel.title.charAt(0)}</span>
                </div>

                <div className={styles.row__info}>
                  <p className={styles.row__title}>{item.novel.title}</p>
                  <p className={styles.row__meta}>
                    <span>{item.novel.author}</span>
                    <span className={styles.row__sep}>·</span>
                    <span className={styles.row__category}>{item.novel.category}</span>
                    <span className={styles.row__sep}>·</span>
                    <span>{formatViews(item.novel.weeklyViews)} 熱度</span>
                  </p>
                </div>

                <div className={styles.row__change}>
                  <ChangeIndicator change={item.change} count={item.changeCount} />
                </div>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
