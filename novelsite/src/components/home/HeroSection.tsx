'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { CaretLeft, CaretRight, BookOpen, Heart, Star } from '@phosphor-icons/react';
import type { Novel } from '@/lib/types';
import styles from './HeroSection.module.css';

gsap.registerPlugin(ScrollTrigger);

function formatViews(views: number): string {
  if (views >= 10000) return `${(views / 10000).toFixed(1)}萬`;
  return `${views}`;
}

interface HeroSectionProps {
  novels: Novel[];
}

export function HeroSection({ novels }: HeroSectionProps) {
  const [current, setCurrent] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  const bgRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const novel = novels[current];

  // ─── 換頁動畫 ───
  const goTo = useCallback(
    (idx: number) => {
      if (isAnimating || idx === current) return;
      setIsAnimating(true);

      const mm = gsap.matchMedia();
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        if (!contentRef.current) return;
        gsap.to(contentRef.current, {
          opacity: 0,
          y: 12,
          duration: 0.25,
          ease: 'power2.in',
          onComplete: () => {
            setCurrent(idx);
            gsap.fromTo(
              contentRef.current,
              { opacity: 0, y: 24 },
              {
                opacity: 1,
                y: 0,
                duration: 0.6,
                ease: 'expo.out',
                onComplete: () => setIsAnimating(false),
              }
            );
          },
        });
      });

      mm.add('(prefers-reduced-motion: reduce)', () => {
        setCurrent(idx);
        setIsAnimating(false);
      });
    },
    [current, isAnimating]
  );

  // ─── 自動輪播 ───
  useEffect(() => {
    const start = () => {
      timerRef.current = setInterval(() => {
        setCurrent((c) => (c + 1) % novels.length);
      }, 5000);
    };
    start();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [novels.length]);

  // ─── 入場動畫 ───
  useEffect(() => {
    if (!contentRef.current) return;
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.from(contentRef.current!.querySelectorAll('[data-hero-anim]'), {
        opacity: 0,
        y: 32,
        duration: 0.8,
        ease: 'expo.out',
        stagger: 0.1,
        delay: 0.2,
      });
    });
    return () => mm.revert();
  }, []);

  // ─── ScrollTrigger 視差 ───
  useEffect(() => {
    if (!bgRef.current || !sectionRef.current) return;
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.to(bgRef.current!, {
        yPercent: 25,
        ease: 'none',
        scrollTrigger: {
          trigger: sectionRef.current!,
          start: 'top top',
          end: 'bottom top',
          scrub: 1,
        },
      });
    });
    return () => mm.revert();
  }, []);

  const prev = () => goTo((current - 1 + novels.length) % novels.length);
  const next = () => goTo((current + 1) % novels.length);

  // 無精選作品時整段不渲染（全新資料庫、或精選作品全數下架）。
  // MUST 置於全部 Hook 之後 —— 提前 return 會改變 Hook 呼叫順序。
  if (!novel) return null;

  return (
    <section
      ref={sectionRef}
      className={styles.hero}
      aria-label="精選作品輪播"
      id="hero-section"
      data-hero-backdrop
    >
      {/* 背景漸層（視差元素）*/}
      <div
        ref={bgRef}
        className={styles.hero__bg}
        style={{ background: novel.coverColor }}
        aria-hidden="true"
      />
      {/* 覆蓋層 */}
      <div className={styles.hero__overlay} aria-hidden="true" />

      {/* 主內容 */}
      <div ref={contentRef} className={styles.hero__content}>
        <div className={styles.hero__inner}>
          {/* 左側文字 */}
          <div className={styles.hero__text}>
            <div className={styles.hero__badge} data-hero-anim>
              <span className={styles.hero__badge__dot} aria-hidden="true" />
              精選作品
            </div>

            <h1 className={styles.hero__title} data-hero-anim>
              {novel.title}
            </h1>

            <p className={styles.hero__author} data-hero-anim>
              <span className={styles.hero__author__label}>作者</span>
              {novel.author}
            </p>

            <p className={styles.hero__excerpt} data-hero-anim>
              {novel.excerpt}
            </p>

            {/* 標籤 */}
            {novel.tags && (
              <div className={styles.hero__tags} data-hero-anim>
                {novel.tags.slice(0, 4).map((tag) => (
                  <span key={tag} className={styles.hero__tag}>
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {/* 數據 */}
            <div className={styles.hero__stats} data-hero-anim>
              <div className={styles.hero__stat}>
                <BookOpen size={16} weight="fill" />
                <span>{novel.chapterCount} 章</span>
              </div>
              <div className={styles.hero__stat}>
                <Star size={16} weight="fill" />
                <span>{novel.rating.toFixed(1)}</span>
              </div>
              {novel.weeklyViews && (
                <div className={styles.hero__stat}>
                  <span className={styles.hero__stat__label}>週閱讀</span>
                  <span>{formatViews(novel.weeklyViews)}</span>
                </div>
              )}
            </div>

            {/* CTA 按鈕 */}
            <div className={styles.hero__actions} data-hero-anim>
              <Link
                href={`/novels/${novel.id}`}
                className={styles.hero__btn__primary}
                id={`hero-read-btn-${novel.id}`}
              >
                <BookOpen size={18} weight="fill" />
                立即閱讀
              </Link>
              <button
                className={styles.hero__btn__ghost}
                id={`hero-bookmark-btn-${novel.id}`}
                type="button"
                aria-label={`加入書架：${novel.title}`}
              >
                <Heart size={18} />
                加入書架
              </button>
            </div>
          </div>

          {/* 右側封面預覽（圓形漸層卡）*/}
          <div className={styles.hero__cover__wrap} data-hero-anim aria-hidden="true">
            <div className={styles.hero__cover} style={{ background: novel.coverColor }}>
              <span className={styles.hero__cover__initial}>{novel.title.charAt(0)}</span>
              <div className={styles.hero__cover__glow} />
            </div>
            <div className={styles.hero__cover__badge}>
              <Star size={14} weight="fill" />
              {novel.rating.toFixed(1)}
            </div>
          </div>
        </div>
      </div>

      {/* 底部：Dot 導航 + 箭頭 */}
      <div className={styles.hero__controls}>
        {/* 上一張 */}
        <button
          className={styles.hero__arrow}
          onClick={prev}
          aria-label="上一部作品"
          id="hero-prev-btn"
          type="button"
        >
          <CaretLeft size={20} weight="bold" />
        </button>

        {/* Dots */}
        <div className={styles.hero__dots} role="tablist" aria-label="輪播導覽">
          {novels.map((n, idx) => (
            <button
              key={n.id}
              className={[styles.hero__dot, idx === current ? styles['hero__dot--active'] : '']
                .filter(Boolean)
                .join(' ')}
              onClick={() => goTo(idx)}
              role="tab"
              aria-selected={idx === current}
              aria-label={`第 ${idx + 1} 部：${n.title}`}
              id={`hero-dot-${idx}`}
              type="button"
            />
          ))}
        </div>

        {/* 下一張 */}
        <button
          className={styles.hero__arrow}
          onClick={next}
          aria-label="下一部作品"
          id="hero-next-btn"
          type="button"
        >
          <CaretRight size={20} weight="bold" />
        </button>
      </div>

      {/* 捲動提示 */}
      <div className={styles.hero__scroll__hint} aria-hidden="true">
        <div className={styles.hero__scroll__line} />
        <span>向下捲動</span>
      </div>
    </section>
  );
}
