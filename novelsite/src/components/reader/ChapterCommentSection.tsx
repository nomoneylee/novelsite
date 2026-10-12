'use client';

import React, { useCallback, useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { ArrowBendUpLeft, Trash } from '@phosphor-icons/react';
import { SafeMarkdown } from '@/components/ui/SafeMarkdown';
import { useSessionUser } from '@/components/SessionProvider';
import { MAX_LENGTH } from '@/lib/validation/common';
import type { CommentNode, CommentThread } from '@/lib/types';
import { apiUrl } from '@/lib/apiUrl';
import styles from './ChapterCommentSection.module.css';

/**
 * 章末留言區（FEAT-4 4-B / T077）
 * =================================
 * **兩層樓中樓**：頂層留言與掛在其下的回覆，層級以 `role="list"`／`listitem` 的
 * 巢狀結構表達，而非靠縮排的視覺效果 —— 讀螢幕的人看不到縮排。
 * 回覆以 `aria-describedby` 指向它回覆的那一則，使「這是在回誰」在無障礙樹中成立。
 *
 * **墓碑以文字明示**（FR-027）：`content` 由伺服器置換為「此留言已刪除」，
 * 發言者資訊不隨回應送出。前端不另外加工 —— 原文不在回應裡，才是真的刪掉了。
 *
 * **本元件 MUST NOT 產生任何留言按讚控制項**：`Comment.likeCount` 本階段無後端
 * （spec Out of Scope），畫上去就是一個按了不會有事的假控制項（FR-065）。
 *
 * 未登入可讀不可寫（FR-026、US2 AC7）：整個留言區照常呈現，只有送出入口引導登入。
 */

interface Props {
  chapterId: string;
}

interface Page {
  items: CommentThread[];
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

function formatTime(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ');
}

export function ChapterCommentSection({ chapterId }: Props) {
  const headingId = useId();
  const isLoggedIn = useSessionUser() !== null;

  const [items, setItems] = useState<CommentThread[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [content, setContent] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);

  /**
   * 取一頁。**只回結果、不碰 state** —— 首次載入由 effect 觸發，
   * 而在 effect 內同步 `setState` 會造成連鎖 render（`react-hooks/set-state-in-effect`）。
   * 把「取數」與「套用」分開之後，effect 內的 setState 一律落在 await 之後。
   */
  const fetchPage = useCallback(
    async (from: string | null): Promise<Page | string> => {
      try {
        const qs = from ? `?cursor=${encodeURIComponent(from)}` : '';
        const res = await fetch(apiUrl(`/api/chapters/${chapterId}/comments${qs}`));
        if (!res.ok) return await messageOf(res, '載入留言失敗，請稍後再試');
        return (await res.json()) as Page;
      } catch {
        return '載入留言失敗，請稍後再試';
      }
    },
    [chapterId]
  );

  const applyPage = useCallback((result: Page | string, append: boolean) => {
    if (typeof result === 'string') {
      setError(result);
      return;
    }
    setItems((prev) => (append ? [...prev, ...result.items] : result.items));
    setCursor(result.nextCursor);
  }, []);

  /** 使用者觸發的載入（載入更多、寫入後重讀）：這一條才需要 busy 指示 */
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
      // 章節切換時舊請求可能後到；不擋下就會用上一章的留言蓋掉這一章的
      if (cancelled) return;
      applyPage(result, false);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [applyPage, fetchPage]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || content.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(apiUrl(`/api/chapters/${chapterId}/comments`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, ...(replyTo ? { parentId: replyTo } : {}) }),
      });
      if (!res.ok) {
        setError(await messageOf(res, '送出失敗，請稍後再試'));
        return;
      }
      setContent('');
      setReplyTo(null);
      await load(null, false);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (comment: CommentNode) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(apiUrl(`/api/comments/${comment.id}`), { method: 'DELETE' });
      if (!res.ok) {
        setError(await messageOf(res, '刪除失敗，請稍後再試'));
        return;
      }
      await load(null, false);
    } finally {
      setBusy(false);
    }
  };

  const renderComment = (comment: CommentNode, describedBy?: string) => {
    const tombstone = comment.user === null;
    return (
      <article
        className={`${styles.comment} ${tombstone ? styles['comment--tombstone'] : ''}`}
        id={`comment-${comment.id}`}
        aria-describedby={describedBy}
      >
        <div className={styles.comment__header}>
          {tombstone ? (
            <span className={styles.comment__author}>已刪除的留言</span>
          ) : (
            <>
              <span
                className={styles.comment__avatar}
                style={{ background: comment.user?.avatarColor }}
                aria-hidden="true"
              >
                {comment.user?.name.charAt(0)}
              </span>
              <span className={styles.comment__author}>{comment.user?.name}</span>
            </>
          )}
          <time className={styles.comment__time} dateTime={comment.createdAt}>
            {formatTime(comment.createdAt)}
          </time>
        </div>

        {tombstone ? (
          <p className={styles.comment__body}>{comment.content}</p>
        ) : (
          <SafeMarkdown className={styles.comment__body}>{comment.content}</SafeMarkdown>
        )}

        <div className={styles.comment__actions}>
          {isLoggedIn && comment.canReply && (
            <button
              type="button"
              className={styles.comment__action}
              onClick={() => setReplyTo((prev) => (prev === comment.id ? null : comment.id))}
              aria-pressed={replyTo === comment.id}
            >
              <ArrowBendUpLeft size={14} /> 回覆
            </button>
          )}
          {comment.canDelete && (
            <button
              type="button"
              className={styles.comment__action}
              onClick={() => void remove(comment)}
              disabled={busy}
            >
              <Trash size={14} /> 刪除
            </button>
          )}
        </div>
      </article>
    );
  };

  return (
    <section className={styles.section} aria-labelledby={headingId} id="chapter-comments">
      <h2 className={styles.section__title} id={headingId}>
        章末留言
      </h2>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {loaded && items.length === 0 ? (
        <p className={styles.empty}>這一章還沒有留言，說說你的想法。</p>
      ) : (
        <ul className={styles.list} role="list">
          {items.map((thread) => (
            <li key={thread.id} className={styles.item}>
              {renderComment(thread)}

              {thread.replies.length > 0 && (
                <ul className={styles.replies} role="list">
                  {thread.replies.map((reply) => (
                    <li key={reply.id} className={styles.item}>
                      {/* 回覆以 aria-describedby 指向它回覆的那一則：
                          層級不能只靠縮排表達，讀螢幕的人看不到縮排 */}
                      {renderComment(reply, `comment-${thread.id}`)}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      {cursor && (
        <button
          type="button"
          className={styles.more}
          onClick={() => void load(cursor, true)}
          disabled={busy}
        >
          載入更多留言
        </button>
      )}

      {isLoggedIn ? (
        <form className={styles.form} onSubmit={submit}>
          <label className={styles.form__label} htmlFor="chapter-comment-input">
            {replyTo ? '回覆留言' : '發表留言'}
          </label>
          <textarea
            id="chapter-comment-input"
            className={styles.form__textarea}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            maxLength={MAX_LENGTH.commentContent}
            rows={3}
            placeholder="讀完這一章的想法"
          />
          <div className={styles.form__actions}>
            <button
              type="submit"
              className={styles.form__submit}
              disabled={busy || content.trim().length === 0}
            >
              送出
            </button>
            {replyTo && (
              <button
                type="button"
                className={styles.comment__action}
                onClick={() => setReplyTo(null)}
              >
                取消回覆
              </button>
            )}
          </div>
        </form>
      ) : (
        <p className={styles.cta}>
          <Link href="/auth/login">登入</Link> 後即可留言；未登入仍可閱讀全部留言。
        </p>
      )}
    </section>
  );
}
