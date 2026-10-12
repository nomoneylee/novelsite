'use client';

import { useCallback, useId, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BellSimple, Check } from '@phosphor-icons/react';
import { showToast } from '@/components/ui/Toast';
import type { NotificationItem } from '@/lib/types';
import { apiUrl } from '@/lib/apiUrl';
import styles from './NotificationCenter.module.css';

/**
 * 通知中心（FEAT-4 4-D / T137，contracts/analytics-scheduling-api.md §3）
 * ========================================================================
 * 列表、未讀篩選、標記已讀（單筆與全部）、空狀態（FR-043b 第 6 項）。
 *
 * **標記已讀後 MUST 呼叫 `router.refresh()`**：未讀數住在版面的 `SessionProvider`，
 * 由伺服器隨頁面一起送出。只改本地狀態的話，導覽列上的數字會維持舊值，
 * 換一頁之後又跳回來 —— 而使用者會以為自己剛剛的操作沒有生效。
 *
 * **未讀以文字標示**（FR-064）：`aria-label` 帶「未讀」二字，
 * 視覺上另有一個看得見的「未讀」標記 —— MUST NOT 只靠顏色區分。
 */

interface NotificationCenterProps {
  items: NotificationItem[];
  /** 目前是否為「只看未讀」（由查詢字串決定，非客戶端狀態） */
  unreadOnly: boolean;
  unreadCount: number;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-TW', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** 追更通知的一句話。缺欄位時退回可理解的文字，MUST NOT 假設酬載六欄恆在 */
function describe(item: NotificationItem): string {
  const { novelTitle, chapterCount, latestChapterTitle } = item.payload;
  const title = novelTitle ?? '你收藏的作品';
  if (chapterCount && chapterCount > 1) {
    return `《${title}》更新了 ${chapterCount} 章，最新為「${latestChapterTitle ?? '新章節'}」`;
  }
  return `《${title}》更新了「${latestChapterTitle ?? '新章節'}」`;
}

/** 通知指向的閱讀位置；資訊不足時退回作品頁或首頁 */
function hrefOf(item: NotificationItem): string {
  const { novelId, latestChapterId } = item.payload;
  if (novelId && latestChapterId) return `/reader/${novelId}/${latestChapterId}`;
  if (novelId) return `/novels/${novelId}`;
  return '/';
}

export function NotificationCenter({ items, unreadOnly, unreadCount }: NotificationCenterProps) {
  const router = useRouter();
  const filterLabelId = useId();
  const [pending, startTransition] = useTransition();
  // 已在本次互動中送出請求的通知：避免連點兩次送出兩個請求
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(() => {
    // 版面（未讀數）與列表都要重取 —— 兩者的來源都是伺服器
    startTransition(() => router.refresh());
  }, [router]);

  const markOne = useCallback(
    async (id: string) => {
      setBusy(id);
      try {
        const res = await fetch(apiUrl(`/api/notifications/${id}`), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ read: true }),
        });
        if (!res.ok) throw new Error(String(res.status));
        refresh();
      } catch {
        showToast('標記已讀失敗，請稍後再試', 'error');
      } finally {
        setBusy(null);
      }
    },
    [refresh]
  );

  const markAll = useCallback(async () => {
    setBusy('all');
    try {
      const res = await fetch(apiUrl('/api/notifications'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(String(res.status));
      showToast('已將全部通知標記為已讀', 'info');
      refresh();
    } catch {
      showToast('標記已讀失敗，請稍後再試', 'error');
    } finally {
      setBusy(null);
    }
  }, [refresh]);

  return (
    <div className={styles.wrapper}>
      <div className={styles.toolbar}>
        <div className={styles.filters} role="group" aria-labelledby={filterLabelId}>
          <span id={filterLabelId} className={styles.filters__label}>
            篩選
          </span>
          <Link
            href="/profile/notifications"
            className={`${styles.filter} ${unreadOnly ? '' : styles['filter--active']}`}
            aria-current={unreadOnly ? undefined : 'true'}
          >
            全部
          </Link>
          <Link
            href="/profile/notifications?unread=1"
            className={`${styles.filter} ${unreadOnly ? styles['filter--active'] : ''}`}
            aria-current={unreadOnly ? 'true' : undefined}
          >
            未讀（{unreadCount}）
          </Link>
        </div>

        <button
          type="button"
          className={styles.markAll}
          onClick={markAll}
          disabled={unreadCount === 0 || busy !== null || pending}
        >
          <Check size={14} />
          全部標記為已讀
        </button>
      </div>

      {items.length === 0 ? (
        /* 空狀態（FR-043b 第 6 項）：示範資料不建立任何通知，故這是新帳號的正常樣貌 */
        <div className={styles.empty}>
          <BellSimple size={32} aria-hidden="true" />
          <p>{unreadOnly ? '沒有未讀通知' : '還沒有任何通知'}</p>
          <p className={styles.empty__hint}>把喜歡的作品加入書架，作者更新時就會通知你。</p>
        </div>
      ) : (
        <ul className={styles.list}>
          {items.map((item) => {
            const unread = item.readAt === null;
            return (
              <li
                key={item.id}
                className={`${styles.item} ${unread ? styles['item--unread'] : ''}`}
              >
                <Link href={hrefOf(item)} className={styles.item__link}>
                  {/* 未讀以**文字**標示，非只靠顏色（FR-064、契約 §5） */}
                  <span className={styles.item__state}>{unread ? '未讀' : '已讀'}</span>
                  <span className={styles.item__text}>{describe(item)}</span>
                  <time className={styles.item__time} dateTime={item.createdAt}>
                    {formatDateTime(item.createdAt)}
                  </time>
                </Link>

                {unread && (
                  <button
                    type="button"
                    className={styles.item__mark}
                    onClick={() => markOne(item.id)}
                    disabled={busy !== null || pending}
                    aria-label={`將這則未讀通知標記為已讀：${describe(item)}`}
                  >
                    <Check size={14} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
