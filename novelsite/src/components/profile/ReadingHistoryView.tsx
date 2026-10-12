'use client';

import { useId } from 'react';
import Link from 'next/link';
import { Trash, X } from '@phosphor-icons/react';
import { useReadingHistory } from '@/hooks/useReadingHistory';
import styles from './ReadingHistoryView.module.css';

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('zh-TW', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * FEAT-4 起閱讀歷史改存伺服器：登入者跨裝置同步，未登入者先存本機、登入後自動帶上（FR-017）。
 * 原本那句「本機限定」的主張已不成立，MUST NOT 留在註解或畫面上（FR-018 禁的是主張，不是某一個字串）。
 */
export function ReadingHistoryView() {
  const syncNoteId = useId();
  const { history, clearHistory, removeEntry } = useReadingHistory();

  if (history.length === 0) {
    return (
      <div>
        <p id={syncNoteId} className={styles.localOnlyNote}>
          登入後閱讀紀錄會自動同步至你的帳號
        </p>
        {/* 空狀態（FR-043b 第 8 項）：示範資料不再灌入假的閱讀歷史，
            故「沒有紀錄」是新使用者的正常樣貌 */}
        <div className={styles.empty} aria-describedby={syncNoteId}>
          <p>還沒有任何閱讀紀錄，開始一段新故事吧！</p>
          <Link href="/" className={styles.empty__link}>
            回到首頁探索
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      <p id={syncNoteId} className={styles.localOnlyNote}>
        登入後閱讀紀錄會自動同步至你的帳號
      </p>
      <div className={styles.toolbar}>
        <button type="button" className={styles.clearBtn} onClick={clearHistory}>
          <Trash size={14} />
          清空歷史紀錄
        </button>
      </div>

      <ul className={styles.list} aria-describedby={syncNoteId}>
        {history.map((entry) => (
          <li className={styles.item} key={entry.novelId}>
            <Link
              href={`/reader/${entry.novelId}/${entry.chapterId}`}
              className={styles.item__link}
            >
              <div className={styles.item__cover} style={{ background: entry.coverColor }}>
                <span aria-hidden="true">{entry.novelTitle.charAt(0)}</span>
              </div>
              <div className={styles.item__info}>
                <p className={styles.item__novel}>{entry.novelTitle}</p>
                <p className={styles.item__chapter}>{entry.chapterTitle}</p>
                <p className={styles.item__time}>{formatDateTime(entry.readAt)}</p>
              </div>
            </Link>
            <button
              type="button"
              className={styles.item__remove}
              onClick={() => removeEntry(entry.novelId)}
              aria-label={`移除《${entry.novelTitle}》的閱讀紀錄`}
            >
              <X size={14} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
