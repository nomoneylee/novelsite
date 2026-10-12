'use client';

import React, { useEffect, useRef } from 'react';
import Link from 'next/link';
import { CaretRight } from '@phosphor-icons/react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { NovelCard } from '@/components/novel/NovelCard';
import type { Novel } from '@/lib/types';
import styles from './NewBooksSection.module.css';

gsap.registerPlugin(ScrollTrigger);

interface NewBooksSectionProps {
  novels: Novel[];
}

export function NewBooksSection({ novels }: NewBooksSectionProps) {
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!sectionRef.current) return;
    const mm = gsap.matchMedia();

    mm.add('(prefers-reduced-motion: no-preference)', () => {
      // 標題入場
      gsap.from(sectionRef.current!.querySelector('[data-section-header]'), {
        opacity: 0,
        y: 20,
        duration: 0.5,
        ease: 'power1.out',
        clearProps: 'opacity,transform',
        scrollTrigger: {
          trigger: sectionRef.current,
          start: 'top 85%',
          once: true,
        },
      });

      /*
        卡片入場：位移掛在「網格容器」、透明度才逐張錯開。
        ==================================================
        原本用 `ScrollTrigger.batch('[data-novel-card]')` 逐張卡片位移 24px 並錯開
        70ms。動畫進行中的每一影格裡，同一列的卡片會停在不同的垂直位置
        （第一張已就位、後面幾張還低 24px），看起來就是「最左邊那張比同列其他張高
        一點」。觸發時機受捲動位置與載入時序影響而不固定，所以時有時無。

        順帶修掉兩件事：
          - batch 的選擇器是**全域**的，會掃到本區段以外的 `[data-novel-card]`；
            改用 sectionRef 之下的網格後只動本區段的卡片。
          - 原本沒有 clearProps，GSAP 留下的行內 transform 會蓋掉
            `.card:hover` 的 translateY(-6px)，動畫跑完後卡片就再也不會浮起。
      */
      const grid = sectionRef.current!.querySelector('[data-novel-grid]');
      // 空狀態沒有網格（下方以文案取代），此時不需要卡片入場動畫
      if (!grid) return;
      const cards = grid.querySelectorAll('[data-novel-card]');

      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: grid,
          start: 'top 90%',
          once: true,
        },
      });

      tl.from(
        grid,
        {
          y: 24,
          duration: 0.5,
          ease: 'power1.out',
          clearProps: 'transform',
        },
        0
      );

      tl.from(
        cards,
        {
          opacity: 0,
          duration: 0.5,
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
      ref={sectionRef}
      className={styles.section}
      aria-label="新書推薦"
      id="new-books-section"
    >
      <div className={styles.section__inner}>
        {/* 標題列 */}
        <div className={styles.section__header} data-section-header>
          <div>
            <h2 className={styles.section__title}>新書推薦</h2>
            <p className={styles.section__subtitle}>每日精選優質新作，不錯過任何精彩故事</p>
          </div>
          <Link href="/new-releases" className={styles.section__more} id="new-books-view-all">
            查看全部
            <CaretRight size={14} weight="bold" />
          </Link>
        </div>

        {/* 空狀態：全新資料庫或近期無新書上架時，此區只會剩下標題。
            MUST NOT 以任何示範作品填充（FR-043a） */}
        {novels.length === 0 ? (
          <p className={styles.section__empty}>目前還沒有新書上架，有作者發佈作品之後就會出現。</p>
        ) : (
          /* 卡片網格 */
          <div className={styles.section__grid} data-novel-grid>
            {novels.map((novel) => (
              <NovelCard key={novel.id} novel={novel} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
