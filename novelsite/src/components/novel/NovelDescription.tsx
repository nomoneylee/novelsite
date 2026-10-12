'use client';

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { CaretDown, CaretUp } from '@phosphor-icons/react';
import styles from './NovelDescription.module.css';

interface NovelDescriptionProps {
  description: string;
}

const COLLAPSED_LINES = 4;

export function NovelDescription({ description }: NovelDescriptionProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isClamped, setIsClamped] = useState(false);

  // 偵測是否有被截斷（需要展開按鈕）
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    // 比較捲動高度與顯示高度
    const check = () => {
      setIsClamped(el.scrollHeight > el.clientHeight + 4);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [description]);

  // GSAP 展開/收合動畫
  const toggle = useCallback(async () => {
    const el = contentRef.current;
    if (!el) return;
    const { gsap } = await import('@/lib/gsap');

    if (!isExpanded) {
      const fullHeight = el.scrollHeight;
      gsap.fromTo(
        el,
        { height: el.clientHeight },
        {
          height: fullHeight,
          duration: 0.4,
          ease: 'power2.inOut',
          onComplete: () => {
            el.style.height = 'auto';
            el.style.webkitLineClamp = 'unset';
            el.style.overflow = 'visible';
          },
        }
      );
    } else {
      const currentHeight = el.clientHeight;
      // 先記住目前高度
      el.style.height = `${currentHeight}px`;
      el.style.overflow = 'hidden';
      // 計算 collapsed 高度
      const lineHeight = parseFloat(getComputedStyle(el).lineHeight);
      const collapsedH = lineHeight * COLLAPSED_LINES;
      gsap.to(el, {
        height: collapsedH,
        duration: 0.4,
        ease: 'power2.inOut',
        onComplete: () => {
          el.style.height = '';
          el.style.webkitLineClamp = `${COLLAPSED_LINES}`;
          el.style.overflow = '';
        },
      });
    }

    setIsExpanded((v) => !v);
  }, [isExpanded]);

  const paragraphs = description.split('\n').filter(Boolean);

  return (
    <div className={styles.desc} id="novel-description">
      <h2 className={styles.desc__title}>作品簡介</h2>

      <div
        ref={contentRef}
        className={`${styles.desc__content} ${isExpanded ? styles['desc__content--expanded'] : ''}`}
        style={
          !isExpanded
            ? {
                WebkitLineClamp: COLLAPSED_LINES,
                display: '-webkit-box',
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }
            : {}
        }
      >
        {paragraphs.map((para, i) => (
          <p key={i} className={styles.desc__para}>
            {para}
          </p>
        ))}
      </div>

      {(isClamped || isExpanded) && (
        <button className={styles.desc__toggle} onClick={toggle} id="desc-toggle-btn">
          {isExpanded ? (
            <>
              收起簡介 <CaretUp size={14} />
            </>
          ) : (
            <>
              展開全文 <CaretDown size={14} />
            </>
          )}
        </button>
      )}
    </div>
  );
}
