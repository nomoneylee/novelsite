'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { EyeSlash, Eye } from '@phosphor-icons/react';
import { SafeMarkdown } from '@/components/ui/SafeMarkdown';
import type { AuthorCommentItem } from '@/lib/types';
import { apiUrl } from '@/lib/apiUrl';
import styles from './AuthorCommentList.module.css';

/**
 * 作者的留言管理（FEAT-4 4-B / T079）
 * =====================================
 * 作者能做的只有一件事：**隱藏或取消隱藏**（FR-031）。
 * 這裡沒有、也 MUST NOT 有任何可編輯留言內容的入口 —— 端點的入參裡沒有 `content`，
 * 服務層的簽章裡也沒有，前端再多畫一個輸入框也送不出去，而畫了就是在承諾做不到的事。
 *
 * 被隱藏的留言在讀者端完全不顯示（含留言作者本人，FR-030），故本列表以
 * `hidden` 狀態明示，讓作者看得出自己隱藏過哪幾則。
 */

interface Page {
  items: AuthorCommentItem[];
  nextCursor: string | null;
}

async function messageOf(res: Response, fallback: string): Promise<string> {
  try {
    const json = (await res.json()) as { error?: { message?: string } };
    return json.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

export function AuthorCommentList() {
  const [items, setItems] = useState<AuthorCommentItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * 取一頁。**只回結果、不碰 state** —— 首次載入由 effect 觸發，
   * 而在 effect 內同步 `setState` 會造成連鎖 render（`react-hooks/set-state-in-effect`）。
   */
  const fetchPage = useCallback(async (from: string | null): Promise<Page | string> => {
    try {
      const qs = from ? `?cursor=${encodeURIComponent(from)}` : '';
      const res = await fetch(apiUrl(`/api/author/comments${qs}`));
      if (!res.ok) return await messageOf(res, '載入留言失敗，請稍後再試');
      return (await res.json()) as Page;
    } catch {
      return '載入留言失敗，請稍後再試';
    }
  }, []);

  const applyPage = useCallback((result: Page | string, append: boolean) => {
    if (typeof result === 'string') {
      setError(result);
      return;
    }
    setItems((prev) => (append ? [...prev, ...result.items] : result.items));
    setCursor(result.nextCursor);
  }, []);

  const load = useCallback(
    async (from: string | null, append: boolean) => {
      setBusy(true);
      setError(null);
      applyPage(await fetchPage(from), append);
      setBusy(false);
    },
    [applyPage, fetchPage]
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await fetchPage(null);
      if (cancelled) return;
      applyPage(result, false);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [applyPage, fetchPage]);

  const toggleHidden = async (item: AuthorCommentItem) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(apiUrl(`/api/author/comments/${item.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hidden: !item.hidden }),
      });
      if (!res.ok) {
        setError(await messageOf(res, '操作失敗，請稍後再試'));
        return;
      }
      setItems((prev) =>
        prev.map((row) => (row.id === item.id ? { ...row, hidden: !row.hidden } : row))
      );
    } finally {
      setBusy(false);
    }
  };

  if (loaded && items.length === 0) {
    return <p className={styles.empty}>你的作品下還沒有任何留言。</p>;
  }

  return (
    <div className={styles.wrap}>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <ul className={styles.list} role="list">
        {items.map((item) => (
          <li key={item.id} className={styles.item}>
            <article
              className={`${styles.card} ${item.hidden ? styles['card--hidden'] : ''}`}
              id={`author-comment-${item.id}`}
            >
              <div className={styles.card__header}>
                <span
                  className={styles.card__avatar}
                  style={{ background: item.user.avatarColor }}
                  aria-hidden="true"
                >
                  {item.user.name.charAt(0)}
                </span>
                <span className={styles.card__author}>{item.user.name}</span>
                {item.hidden && <span className={styles.card__badge}>已隱藏</span>}
                <time className={styles.card__time} dateTime={item.createdAt}>
                  {item.createdAt.slice(0, 10)}
                </time>
              </div>

              <p className={styles.card__where}>
                <Link href={`/novels/${item.novelId}`}>{item.novelTitle}</Link>
                {' · '}
                <Link href={`/reader/${item.novelId}/${item.chapterId}`}>{item.chapterTitle}</Link>
              </p>

              <SafeMarkdown className={styles.card__body}>{item.content}</SafeMarkdown>

              <div className={styles.card__actions}>
                <button
                  type="button"
                  className={styles.card__action}
                  onClick={() => void toggleHidden(item)}
                  disabled={busy}
                  aria-pressed={item.hidden}
                >
                  {item.hidden ? <Eye size={14} /> : <EyeSlash size={14} />}
                  {item.hidden ? '取消隱藏' : '隱藏這則留言'}
                </button>
              </div>
            </article>
          </li>
        ))}
      </ul>

      {cursor && (
        <button
          type="button"
          className={styles.more}
          onClick={() => void load(cursor, true)}
          disabled={busy}
        >
          載入更多
        </button>
      )}
    </div>
  );
}
