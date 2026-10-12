'use client';

import React, { useEffect, useRef } from 'react';
import Link from 'next/link';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import type { Category } from '@/lib/types';
import styles from './CategoryNav.module.css';

gsap.registerPlugin(ScrollTrigger);

interface CategoryNavProps {
  categories: Category[];
}

export function CategoryNav({ categories }: CategoryNavProps) {
  const containerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const grid = containerRef.current.querySelector('[data-cat-grid]');
    if (!grid) return;
    const items = grid.querySelectorAll('[data-cat-item]');
    const mm = gsap.matchMedia();

    mm.add('(prefers-reduced-motion: no-preference)', () => {
      /*
        位移掛在「網格容器」、透明度才逐張錯開。
        ==========================================
        逐張卡片各自位移 + stagger 時，動畫進行中的每一影格裡，同一列的卡片
        會停在不同的垂直位置（第一張已就位、後面幾張還低 16px）——
        看起來就是「最左邊那一格比同列其他格高一點」。入場動畫由捲動觸發，
        觸發時機受捲動位置、字型與圖片載入影響而不固定，所以時有時無，
        重新載入後又正常。

        容器整體位移時，同一列的卡片在每一影格的垂直位置都相同，
        錯開的只剩透明度，入場的層次感仍在。

        clearProps：GSAP 會把 transform／opacity 寫成行內樣式並留著，
        行內樣式蓋過 CSS，`.catNav__item:hover` 的 translateY(-4px) 會永久失效。
      */
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: containerRef.current,
          start: 'top 88%',
          once: true,
        },
      });

      tl.from(
        grid,
        {
          y: 16,
          duration: 0.45,
          ease: 'power1.out',
          clearProps: 'transform',
        },
        0
      );

      tl.from(
        items,
        {
          opacity: 0,
          duration: 0.45,
          ease: 'power1.out',
          stagger: 0.07,
          clearProps: 'opacity',
        },
        0
      );
    });

    return () => mm.revert();
  }, []);

  return (
    <section
      ref={containerRef}
      className={styles.catNav}
      aria-label="分類快捷導航"
      id="category-nav"
    >
      <div className={styles.catNav__inner}>
        <div className={styles.catNav__header}>
          <h2 className={styles.catNav__title}>探索分類</h2>
          <p className={styles.catNav__sub}>選擇您喜愛的小說類型</p>
        </div>

        {/* 空狀態：分類為參考資料，正常情況下不會為空；
            真的為空時代表分類尚未建立，此處明說而非留一片空白 */}
        {categories.length === 0 && <p className={styles.catNav__empty}>分類尚未建立。</p>}

        <div className={styles.catNav__grid} data-cat-grid>
          {categories.map((cat) => (
            <Link
              key={cat.id}
              href={`/categories/${cat.id}`}
              className={styles.catNav__item}
              data-cat-item
              id={`category-${cat.id}`}
              aria-label={`${cat.label}分類：${cat.description}`}
              style={
                {
                  '--cat-color': cat.color,
                  '--cat-bg': cat.bgColor,
                } as React.CSSProperties
              }
            >
              <span className={styles.catNav__item__emoji} aria-hidden="true">
                {cat.emoji}
              </span>
              <span className={styles.catNav__item__label}>{cat.label}</span>
              <span className={styles.catNav__item__desc}>{cat.description}</span>
              <div className={styles.catNav__item__indicator} aria-hidden="true" />
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
