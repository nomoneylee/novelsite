'use client';

import React, { useEffect, useRef } from 'react';
import Link from 'next/link';
import { Badge, CATEGORY_VARIANT_MAP } from '@/components/ui/Badge';
import type { Novel } from '@/lib/types';
import styles from './RelatedNovels.module.css';

interface RelatedNovelsProps {
  novels: Novel[];
}

function formatWordCount(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}萬字`;
  return `${n}字`;
}

export function RelatedNovels({ novels }: RelatedNovelsProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (novels.length === 0) return;
    let ctx: { revert(): void } | undefined;

    (async () => {
      const { gsap } = await import('@/lib/gsap');
      if (!ref.current) return;
      ctx = gsap.context(() => {
        const mm = gsap.matchMedia();
        mm.add(
          {
            prefersMotion: '(prefers-reduced-motion: no-preference)',
            isReduced: '(prefers-reduced-motion: reduce)',
          },
          (context) => {
            const { isReduced } = context.conditions as {
              isReduced: boolean;
              prefersMotion: boolean;
            };
            /*
              位移掛在「網格容器」、透明度才逐張錯開。
              ==========================================
              逐張卡片各自位移 + stagger 時，動畫進行中的每一影格裡，同一列的
              卡片會停在不同的垂直位置（第一張已就位、後面幾張還低 12px），
              看起來就是「最左邊那張比同列其他張高一點」。容器整體位移則不會 ——
              同一列的卡片在每一影格的垂直位置都相同。
            */
            const tl = gsap.timeline({
              scrollTrigger: {
                trigger: ref.current,
                start: 'top 90%',
                once: true,
              },
            });

            tl.from(
              '[data-related-grid]',
              {
                y: isReduced ? 0 : 12,
                duration: isReduced ? 0 : 0.35,
                ease: 'power1.out',
                clearProps: 'transform',
              },
              0
            );

            tl.from(
              '[data-related-card]',
              {
                opacity: 0,
                duration: isReduced ? 0 : 0.35,
                stagger: isReduced ? 0 : 0.08,
                ease: 'power1.out',
                clearProps: 'opacity',
              },
              0
            );
          }
        );
      }, ref.current);
    })();

    return () => ctx?.revert();
  }, [novels.length]);

  if (novels.length === 0) return null;

  return (
    <section className={styles.section} id="related-novels" ref={ref}>
      <h2 className={styles.section__title}>相關推薦</h2>
      <div className={styles.grid} data-related-grid>
        {novels.map((novel) => (
          <Link
            key={novel.id}
            href={`/novels/${novel.id}`}
            className={styles.card}
            data-related-card
            id={`related-${novel.id}`}
          >
            <div className={styles.card__cover}>
              <div
                className={styles.card__cover__inner}
                style={{ background: novel.coverColor }}
                aria-label={`${novel.title} 封面`}
              >
                <span className={styles.card__cover__initial}>{novel.title.charAt(0)}</span>
              </div>
            </div>

            <div className={styles.card__body}>
              {novel.category && (
                <Badge variant={CATEGORY_VARIANT_MAP[novel.category] ?? 'default'} size="sm">
                  {novel.category}
                </Badge>
              )}
              <h3 className={styles.card__title}>{novel.title}</h3>
              <p className={styles.card__author}>{novel.author}</p>
              <div className={styles.card__meta}>
                <span className={styles.card__rating}>★ {novel.rating.toFixed(1)}</span>
                <span>{formatWordCount(novel.wordCount)}</span>
              </div>
              <p className={styles.card__excerpt}>{novel.excerpt}</p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
