'use client';

import { useId } from 'react';
import Link from 'next/link';
import { X } from '@phosphor-icons/react';
import { useBookshelfIds } from '@/hooks/useBookshelfIds';
import type { Novel } from '@/lib/types';
import styles from './BookshelfView.module.css';

interface BookshelfViewProps {
  allNovels: Novel[];
}

/**
 * FEAT-4 起書架改存伺服器：登入者跨裝置同步，未登入者先存本機、登入後自動帶上（FR-017）。
 * 原本那句「本機限定」的主張已不成立，MUST NOT 留在註解或畫面上（FR-018 禁的是主張，不是某一個字串）。
 */
export function BookshelfView({ allNovels }: BookshelfViewProps) {
  const syncNoteId = useId();
  const { ids, remove } = useBookshelfIds();
  const shelved = allNovels.filter((n) => ids.includes(n.id));

  if (shelved.length === 0) {
    return (
      <div>
        <p id={syncNoteId} className={styles.localOnlyNote}>
          登入後書架會自動同步至你的帳號
        </p>
        {/* 空狀態（FR-043b 第 7 項）：示範環境的預設樣貌就是這裡，
            故它是主要路徑而非邊角情境，MUST 給得出下一步 */}
        <div className={styles.empty} aria-describedby={syncNoteId}>
          <p>書架目前是空的，去書庫挑幾本喜歡的作品吧！</p>
          <Link href="/ranking" className={styles.empty__link}>
            前往排行榜探索
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <p id={syncNoteId} className={styles.localOnlyNote}>
        登入後書架會自動同步至你的帳號
      </p>
      <div className={styles.grid} aria-describedby={syncNoteId}>
        {shelved.map((novel) => (
          <div className={styles.item} key={novel.id}>
            <Link href={`/novels/${novel.id}`} className={styles.item__link}>
              <div className={styles.item__cover} style={{ background: novel.coverColor }}>
                <span aria-hidden="true">{novel.title.charAt(0)}</span>
              </div>
              <p className={styles.item__title}>{novel.title}</p>
              <p className={styles.item__author}>{novel.author}</p>
            </Link>
            <button
              type="button"
              className={styles.item__remove}
              onClick={() => remove(novel.id)}
              aria-label={`從書架移除《${novel.title}》`}
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
