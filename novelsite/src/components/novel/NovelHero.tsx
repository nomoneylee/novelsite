'use client';

import React, { useEffect, useId, useRef, useCallback } from 'react';
import Link from 'next/link';
import {
  BookOpen,
  BookmarkSimple,
  Eye,
  Hash,
  TextAlignLeft,
  Clock,
  ShareNetwork,
} from '@phosphor-icons/react';
import { Badge, CATEGORY_VARIANT_MAP } from '@/components/ui/Badge';
import { useBookshelf } from '@/hooks/useBookshelf';
import { showToast } from '@/components/ui/Toast';
import type { NovelDetail, ProgressPoint } from '@/lib/types';
import styles from './NovelHero.module.css';

interface NovelHeroProps {
  novel: NovelDetail;
  /**
   * 續讀點（FR-011）。由伺服器端經服務層取得後傳入，**不經** `GET /api/reading-progress`
   * （contracts/reader-state-api.md §2）—— 詳情頁本來就是伺服器渲染，
   * 讓它先送一份空殼再由客戶端補一次請求，等於為了一行字多一次往返。
   */
  resume?: ProgressPoint | null;
}

function formatNumber(n: number): string {
  if (n >= 100000000) return `${(n / 100000000).toFixed(1)}億`;
  if (n >= 10000) return `${(n / 10000).toFixed(0)}萬`;
  return n.toString();
}

function formatWordCount(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}萬字`;
  return `${n}字`;
}

const STATUS_LABEL: Record<NovelDetail['status'], string> = {
  ongoing: '連載中',
  completed: '已完結',
  hiatus: '暫停更新',
};

const STATUS_CLASS: Record<NovelDetail['status'], string> = {
  ongoing: styles['status--ongoing'],
  completed: styles['status--completed'],
  hiatus: styles['status--hiatus'],
};

export function NovelHero({ novel, resume }: NovelHeroProps) {
  const heroRef = useRef<HTMLDivElement>(null);
  const shelfSyncNoteId = useId();
  const { isInShelf, toggle: toggleShelf } = useBookshelf(novel.id);

  // GSAP 入場動畫
  useEffect(() => {
    let ctx: { revert(): void } | undefined;

    (async () => {
      const { gsap } = await import('@/lib/gsap');
      if (!heroRef.current) return;
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
            gsap.from('[data-hero-item]', {
              opacity: 0,
              y: isReduced ? 0 : 16,
              duration: isReduced ? 0 : 0.5,
              stagger: isReduced ? 0 : 0.08,
              ease: 'expo.out',
              clearProps: 'opacity,transform',
            });
          }
        );
      }, heroRef.current);
    })();

    return () => ctx?.revert();
  }, [novel.id]);

  // 書架切換
  const handleShelf = useCallback(() => {
    toggleShelf();
    if (isInShelf) {
      showToast(`《${novel.title}》已從書架移除`, 'info');
    } else {
      showToast(`《${novel.title}》已加入書架 ❤️`, 'success');
    }
  }, [toggleShelf, isInShelf, novel.title]);

  // 分享功能（Web Share API + Clipboard 降級）
  const handleShare = useCallback(async () => {
    const url = typeof window !== 'undefined' ? window.location.href : '';
    const shareData = {
      title: `《${novel.title}》 - NovelSite`,
      text: `推薦一本好書：《${novel.title}》${novel.excerpt.slice(0, 60)}…`,
      url,
    };

    try {
      if (navigator.share && navigator.canShare?.(shareData)) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(url);
        showToast('連結已複製到剪貼簿', 'success');
      }
    } catch {
      // 使用者取消不顯示錯誤
    }
  }, [novel.title, novel.excerpt]);

  const fullStars = Math.floor(novel.rating);
  const hasHalf = novel.rating - fullStars >= 0.5;

  return (
    <section className={styles.hero} ref={heroRef} id="novel-hero" data-hero-backdrop>
      <div className={styles.hero__bg} style={{ background: novel.coverColor }} aria-hidden="true">
        <div className={styles.hero__bg__overlay} />
      </div>

      <div className={`container ${styles.hero__content}`}>
        <div className={styles.hero__cover} data-hero-item aria-label={`${novel.title} 封面`}>
          <div className={styles.hero__cover__inner} style={{ background: novel.coverColor }}>
            <span className={styles.hero__cover__initial}>{novel.title.charAt(0)}</span>
          </div>
          <span className={`${styles.hero__status} ${STATUS_CLASS[novel.status]}`}>
            {STATUS_LABEL[novel.status]}
          </span>
        </div>

        <div className={styles.hero__info}>
          <div className={styles.hero__tags} data-hero-item>
            <Badge variant={CATEGORY_VARIANT_MAP[novel.category] ?? 'default'} size="md">
              {novel.category}
            </Badge>
            {novel.tags?.slice(0, 3).map((tag) => (
              <Badge key={tag} variant="default" size="sm">
                {tag}
              </Badge>
            ))}
          </div>

          <h1 className={styles.hero__title} data-hero-item>
            {novel.title}
          </h1>

          <p className={styles.hero__author} data-hero-item>
            <span className={styles.hero__author__label}>作者</span>
            <span className={styles.hero__author__name}>{novel.author}</span>
          </p>

          <div
            className={styles.hero__rating}
            data-hero-item
            aria-label={`評分 ${novel.rating} 分`}
          >
            {Array.from({ length: 5 }).map((_, i) => {
              let cls = styles.star__empty;
              if (i < fullStars) cls = styles.star__filled;
              else if (i === fullStars && hasHalf) cls = styles.star__half;
              return (
                <span key={i} className={cls} aria-hidden="true">
                  ★
                </span>
              );
            })}
            <strong className={styles.hero__rating__score}>{novel.rating.toFixed(1)}</strong>
            <span className={styles.hero__rating__count}>分</span>
          </div>

          <div className={styles.hero__meta} data-hero-item>
            <span className={styles.hero__meta__item} title="總瀏覽">
              <Eye size={14} />
              {formatNumber(novel.totalViews)}
            </span>
            <span className={styles.hero__meta__item} title="字數">
              <TextAlignLeft size={14} />
              {formatWordCount(novel.wordCount)}
            </span>
            <span className={styles.hero__meta__item} title="章節">
              <Hash size={14} />
              {novel.chapterCount} 章
            </span>
            <span className={styles.hero__meta__item} title="收藏">
              <BookmarkSimple size={14} />
              {formatNumber(novel.favoriteCount)} 收藏
            </span>
            {novel.updateFreq && (
              <span className={styles.hero__meta__item} title="更新頻率">
                <Clock size={14} />
                {novel.updateFreq}
              </span>
            )}
          </div>

          <div className={styles.hero__actions} data-hero-item>
            {resume ? (
              /* 續讀入口（FR-011）。`?resume=1` 使閱讀頁在正文渲染完成後把捲動位置
                 還原至記錄的百分比 —— 顯示入口與回到位置是兩件事，
                 只做前者會交出一個按下去卻停在章節開頭的功能 */
              <Link
                href={`/reader/${novel.id}/${resume.chapterId}?resume=1`}
                className={styles.hero__btn__primary}
                id="resume-reading-btn"
              >
                <BookOpen size={20} />
                繼續閱讀・第 {resume.chapterNumber} 章
              </Link>
            ) : (
              <Link
                href={`/reader/${novel.id}/${novel.firstChapterId}`}
                className={styles.hero__btn__primary}
                id="read-now-btn"
              >
                <BookOpen size={20} />
                立即閱讀
              </Link>
            )}
            <button
              className={`${styles.hero__btn__secondary} ${isInShelf ? styles['hero__btn__secondary--active'] : ''}`}
              id="add-shelf-btn"
              type="button"
              onClick={handleShelf}
              aria-pressed={isInShelf}
              aria-label={isInShelf ? `從書架移除《${novel.title}》` : `加入書架《${novel.title}》`}
              aria-describedby={shelfSyncNoteId}
            >
              {isInShelf ? (
                <BookmarkSimple size={20} weight="fill" />
              ) : (
                <BookmarkSimple size={20} />
              )}
              {isInShelf ? '已入書架' : '加入書架'}
            </button>
            {/* FEAT-4 起書架改存伺服器：登入者跨裝置同步，未登入者先存本機、
                登入後由 `useReaderStateMerge` 自動帶上（FR-017）。
                原本那句「本機限定」的主張已不成立，MUST NOT 留在註解或畫面上（FR-018 禁的是主張，不是某一個字串） */}
            <span id={shelfSyncNoteId} className="sr-only">
              登入後書架會自動同步至你的帳號
            </span>
            <button
              className={styles.hero__btn__icon}
              id="share-btn"
              type="button"
              onClick={handleShare}
              aria-label="分享此作品"
            >
              <ShareNetwork size={20} />
            </button>
          </div>

          <div className={styles.hero__author__bio} data-hero-item>
            <div className={styles.hero__author__avatar} aria-hidden="true">
              {novel.author.charAt(0)}
            </div>
            <div>
              <p className={styles.hero__author__bio__name}>{novel.author}</p>
              <p className={styles.hero__author__bio__text}>{novel.authorBio}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
