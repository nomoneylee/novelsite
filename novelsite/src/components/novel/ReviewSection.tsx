'use client';

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ThumbsUp, Star, SortAscending, PencilSimple, Trash } from '@phosphor-icons/react';
import { SafeMarkdown } from '@/components/ui/SafeMarkdown';
import { useSessionUser } from '@/components/SessionProvider';
import { MAX_LENGTH } from '@/lib/validation/common';
import type { ReviewItem } from '@/lib/types';
import { apiUrl } from '@/lib/apiUrl';
import styles from './ReviewSection.module.css';

/**
 * 讀者評論區（FEAT-4 4-B / T075）
 * =================================
 * 三件事與 4-B 之前不同：
 *
 * 1. **排序由伺服器承擔**（`?sort=hot|latest`，FR-023a）。原本的
 *    `useMemo(() => [...reviews].sort(...))` 只排得動當前這一頁，
 *    切到「最新」時看到的其實是「第一頁裡最新的 20 則」。
 * 2. **首屏只有第一頁**，其餘按「載入更多」向端點取（游標分頁，FR-023a）。
 * 3. **原本的評分分佈長條圖已移除**：它要的是每一顆星各有幾則，而首屏只拿得到
 *    第一頁 —— 以一頁的分佈畫出「全作品的分佈」，畫面上就是一組沒有來源的數字
 *    （FR-043a 的同一條理由）。平均分與評分人數改由伺服器的累計值直接顯示。
 *
 * 寫入後一律 `router.refresh()`：平均分與評分人數是**伺服器**算出來的真值，
 * 前端自己加一減一等於在客戶端維護第二套真相（FR-038a、SC-019）。
 */

type SortMode = 'hot' | 'latest';

interface ReviewSectionProps {
  novelId: string;
  initialItems: ReviewItem[];
  initialCursor: string | null;
  /** 伺服器端的累計值；MUST NOT 由當前頁面的項目推算 */
  totalRating: number;
  totalCount: number;
}

function StarRow({ rating, size = 16 }: { rating: number; size?: number }) {
  return (
    <span className={styles.stars} aria-label={`${rating} 星`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <span
          key={i}
          className={i < rating ? styles.star__on : styles.star__off}
          style={{ fontSize: size }}
        >
          ★
        </span>
      ))}
    </span>
  );
}

/** 可鍵盤操作的評分輸入。單選按鈕群組，而非一排看起來像星星的 `<div>` */
function RatingInput({
  value,
  onChange,
  name,
}: {
  value: number;
  onChange: (rating: number) => void;
  name: string;
}) {
  return (
    <fieldset className={styles.form__rating}>
      <legend className={styles.form__legend}>評分</legend>
      {[1, 2, 3, 4, 5].map((star) => (
        <label key={star} className={styles.form__star}>
          <input
            type="radio"
            name={name}
            value={star}
            checked={value === star}
            onChange={() => onChange(star)}
          />
          <span aria-hidden="true" className={value >= star ? styles.star__on : styles.star__off}>
            ★
          </span>
          <span className="sr-only">{star} 星</span>
        </label>
      ))}
    </fieldset>
  );
}

function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

async function send(path: string, method: string, body?: unknown): Promise<Response> {
  return fetch(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

async function messageOf(res: Response, fallback: string): Promise<string> {
  try {
    const json = (await res.json()) as { error?: { message?: string } };
    return json.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

export function ReviewSection({
  novelId,
  initialItems,
  initialCursor,
  totalRating,
  totalCount,
}: ReviewSectionProps) {
  const router = useRouter();
  const isLoggedIn = useSessionUser() !== null;
  const ratingInputName = useId();
  const listRef = useRef<HTMLDivElement>(null);

  const [sortMode, setSortMode] = useState<SortMode>('hot');
  const [items, setItems] = useState<ReviewItem[]>(initialItems);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [rating, setRating] = useState(5);
  const [content, setContent] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  const mine = items.find((item) => item.mine) ?? null;

  /** 取一頁。`append` 為 false 時整份換掉（切換排序），為 true 時接在後面（載入更多） */
  const loadPage = useCallback(
    async (sort: SortMode, from: string | null, append: boolean) => {
      setBusy(true);
      setError(null);
      try {
        const qs = `?sort=${sort}${from ? `&cursor=${encodeURIComponent(from)}` : ''}`;
        const res = await fetch(apiUrl(`/api/novels/${novelId}/reviews${qs}`));
        if (!res.ok) {
          setError(await messageOf(res, '載入評論失敗，請稍後再試'));
          return;
        }
        const page = (await res.json()) as { items: ReviewItem[]; nextCursor: string | null };
        setItems((prev) => (append ? [...prev, ...page.items] : page.items));
        setCursor(page.nextCursor);
      } catch {
        setError('載入評論失敗，請稍後再試');
      } finally {
        setBusy(false);
      }
    },
    [novelId]
  );

  const changeSort = (next: SortMode) => {
    if (next === sortMode) return;
    setSortMode(next);
    void loadPage(next, null, false);
  };

  /** 寫入之後：列表回到第一頁的當前排序，並讓伺服器重算的平均分與人數重新渲染 */
  const afterWrite = useCallback(async () => {
    await loadPage(sortMode, null, false);
    router.refresh();
  }, [loadPage, router, sortMode]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = editingId
        ? await send(apiUrl(`/api/reviews/${editingId}`), 'PATCH', { rating, content })
        : await send(apiUrl(`/api/novels/${novelId}/reviews`), 'POST', { rating, content });
      if (!res.ok) {
        setError(await messageOf(res, '送出失敗，請稍後再試'));
        return;
      }
      setContent('');
      setEditingId(null);
      await afterWrite();
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (item: ReviewItem) => {
    setEditingId(item.id);
    setRating(item.rating);
    setContent(item.content);
  };

  const removeReview = async (item: ReviewItem) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await send(apiUrl(`/api/reviews/${item.id}`), 'DELETE');
      if (!res.ok) {
        setError(await messageOf(res, '刪除失敗，請稍後再試'));
        return;
      }
      if (editingId === item.id) {
        setEditingId(null);
        setContent('');
      }
      await afterWrite();
    } finally {
      setBusy(false);
    }
  };

  const toggleLike = async (item: ReviewItem) => {
    const res = await send(
      apiUrl(`/api/reviews/${item.id}/like`),
      item.likedByMe ? 'DELETE' : 'POST'
    );
    if (!res.ok) {
      setError(await messageOf(res, '操作失敗，請稍後再試'));
      return;
    }
    // 回應帶回的是伺服器當下的真值，故直接採用而非自行加減（FR-024 的冪等回應）
    const next = (await res.json()) as { likeCount: number; likedByMe: boolean };
    setItems((prev) =>
      prev.map((row) =>
        row.id === item.id ? { ...row, likeCount: next.likeCount, likedByMe: next.likedByMe } : row
      )
    );
  };

  useEffect(() => {
    let ctx: { revert(): void } | undefined;
    (async () => {
      const { gsap } = await import('@/lib/gsap');
      if (!listRef.current) return;
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
            gsap.from('[data-review-card]', {
              opacity: 0,
              y: isReduced ? 0 : 16,
              duration: isReduced ? 0 : 0.4,
              stagger: isReduced ? 0 : 0.07,
              ease: 'power1.out',
              scrollTrigger: {
                trigger: listRef.current,
                start: 'top 85%',
                once: true,
              },
              clearProps: 'opacity,transform',
            });
          }
        );
      }, listRef.current);
    })();
    return () => {
      ctx?.revert();
    };
  }, [items]);

  const fullStars = Math.round(totalRating);

  return (
    <section className={styles.section} id="review-section">
      <h2 className={styles.section__title}>讀者評論</h2>

      <div className={styles.overview}>
        <div className={styles.overview__score}>
          <strong className={styles.overview__big}>{totalRating.toFixed(1)}</strong>
          <StarRow rating={fullStars} size={20} />
          <span className={styles.overview__total}>共 {totalCount.toLocaleString()} 則評論</span>
        </div>
      </div>

      <div className={styles.sort__row}>
        <SortAscending size={16} className={styles.sort__icon} />
        <button
          type="button"
          className={`${styles.sort__btn} ${sortMode === 'hot' ? styles['sort__btn--active'] : ''}`}
          onClick={() => changeSort('hot')}
          aria-pressed={sortMode === 'hot'}
          id="sort-hot-btn"
        >
          最熱
        </button>
        <button
          type="button"
          className={`${styles.sort__btn} ${sortMode === 'latest' ? styles['sort__btn--active'] : ''}`}
          onClick={() => changeSort('latest')}
          aria-pressed={sortMode === 'latest'}
          id="sort-latest-btn"
        >
          最新
        </button>
      </div>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <div ref={listRef} className={styles.list}>
        {items.length === 0 ? (
          <p className={styles.empty}>還沒有人評論這部作品，成為第一個留下想法的人。</p>
        ) : (
          items.map((review) => (
            <article
              key={review.id}
              className={styles.card}
              data-review-card
              id={`review-${review.id}`}
            >
              <div
                className={styles.card__avatar}
                style={{ background: review.user.avatarColor }}
                aria-hidden="true"
              >
                {review.user.name.charAt(0)}
              </div>

              <div className={styles.card__body}>
                <div className={styles.card__header}>
                  <span className={styles.card__author}>{review.user.name}</span>
                  <StarRow rating={review.rating} size={13} />
                  <time className={styles.card__date} dateTime={review.createdAt}>
                    {formatDate(review.createdAt)}
                  </time>
                </div>

                <SafeMarkdown className={styles.card__content}>{review.content}</SafeMarkdown>

                <div className={styles.card__footer}>
                  <button
                    type="button"
                    className={styles.card__like}
                    aria-pressed={review.likedByMe}
                    aria-label={`讚 ${review.likeCount}`}
                    onClick={() => void toggleLike(review)}
                    disabled={!isLoggedIn}
                    id={`like-${review.id}`}
                  >
                    <ThumbsUp size={14} weight={review.likedByMe ? 'fill' : 'regular'} />
                    <span>{review.likeCount}</span>
                  </button>

                  {review.mine && (
                    <>
                      <button
                        type="button"
                        className={styles.card__action}
                        onClick={() => startEdit(review)}
                      >
                        <PencilSimple size={14} /> 編輯
                      </button>
                      <button
                        type="button"
                        className={styles.card__action}
                        onClick={() => void removeReview(review)}
                        disabled={busy}
                      >
                        <Trash size={14} /> 刪除
                      </button>
                    </>
                  )}
                </div>
              </div>
            </article>
          ))
        )}
      </div>

      {cursor && (
        <button
          type="button"
          className={styles.more}
          onClick={() => void loadPage(sortMode, cursor, true)}
          disabled={busy}
        >
          載入更多評論
        </button>
      )}

      {isLoggedIn ? (
        <form className={styles.form} onSubmit={submit}>
          <h3 className={styles.form__title}>
            {editingId ? '編輯我的評論' : mine ? '你已評論過這部作品' : '寫下你的評論'}
          </h3>
          <RatingInput value={rating} onChange={setRating} name={ratingInputName} />
          <label className={styles.form__label} htmlFor="review-content">
            評論內容
          </label>
          <textarea
            id="review-content"
            className={styles.form__textarea}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            maxLength={MAX_LENGTH.reviewContent}
            rows={4}
            placeholder="說說這部作品給你的感受"
          />
          <div className={styles.form__actions}>
            {/* 一人一評（FR-021）：已有評論且不在編輯狀態時，送出必然回 409，
                故引導按「編輯」而非讓使用者撞上一次錯誤 */}
            <button
              type="submit"
              className={styles.write__btn}
              disabled={busy || content.trim().length === 0 || (mine !== null && !editingId)}
            >
              {editingId ? '儲存修改' : '送出評論'}
            </button>
            {editingId && (
              <button
                type="button"
                className={styles.card__action}
                onClick={() => {
                  setEditingId(null);
                  setContent('');
                }}
              >
                取消
              </button>
            )}
          </div>
        </form>
      ) : (
        <div className={styles.write__cta}>
          <Star size={18} />
          <span>閱讀後留下您的書評，幫助更多讀者發現好書</span>
          <Link href="/auth/login" className={styles.write__btn} id="write-review-btn">
            登入後評論
          </Link>
        </div>
      )}
    </section>
  );
}
