'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PencilSimple, Eye, Heart, ChatCircle } from '@phosphor-icons/react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { updateNovelAction } from '@/app/author/actions';
import type { AuthorWorkSummary, NovelStatus } from '@/lib/types';
import styles from './AuthorWorkList.module.css';

const STATUS_LABEL: Record<NovelStatus, string> = {
  published: '已上架',
  draft: '草稿',
  hiatus: '暫停連載',
  admin_suspended: '違規下架',
};

const STATUS_VARIANT: Record<NovelStatus, 'success' | 'warning' | 'info' | 'error'> = {
  published: 'success',
  draft: 'warning',
  hiatus: 'info',
  admin_suspended: 'error',
};

function formatNumber(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}萬`;
  return n.toString();
}

type ActionFailure = { success: false; error: { message: string } };

function isFailure(result: unknown): result is ActionFailure {
  return (
    typeof result === 'object' &&
    result !== null &&
    (result as { success?: boolean }).success === false
  );
}

interface AuthorWorkListProps {
  novels: AuthorWorkSummary[];
}

/**
 * 作者的作品列表（FR-014）。
 *
 * 資料來源已改為**登入者本人**的作品（頁面層以 `session.uid` 查詢），
 * 故 FEAT-1 時期那句宣告本頁只是展示的標示已一併移除 —— 它不再屬實。
 * 此處 MUST NOT 逐字引述當時的原文（FEAT-4 T151 的全站文案掃描以字串為判準，
 * 引述與真正的殘留在掃描眼中一模一樣；為引述開一個例外，下一段真的殘留下來的
 * 文案也會躲進同一個例外）。
 *
 * 連載狀態切換接上真實寫入：先前這個按鈕會用 `setState` 改本地畫面並跳出
 * 「已暫停連載」的提示，重新整理就打回原形。那比一般的假成功更糟 ——
 * 作者會以為作品真的暫停了（FR-036、FR-042）。
 *
 * **連載狀態（`serialStatus`）與上下架（`status`）互相獨立**：這裡只切前者，
 * 上下架與刪除留在作品管理頁，因為那兩個動作需要更明確的後果說明與確認。
 */
export function AuthorWorkList({ novels }: AuthorWorkListProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const toggleSerialStatus = (novel: AuthorWorkSummary) => {
    const next = novel.status === 'hiatus' ? 'ongoing' : 'hiatus';
    setMessage(null);
    startTransition(async () => {
      const result = await updateNovelAction({ novelId: novel.id, serialStatus: next });
      if (isFailure(result)) {
        setMessage(result.error.message);
        return;
      }
      setMessage(
        next === 'hiatus' ? `《${novel.title}》已暫停連載` : `《${novel.title}》已恢復連載`
      );
      router.refresh();
    });
  };

  if (novels.length === 0) {
    return (
      <div className={styles.wrapper}>
        <p className={styles.demoNote}>
          你還沒有任何作品。到<Link href="/author/create">「新增作品」</Link>建立第一部，
          之後就能在這裡管理分卷、章節與上架狀態。
        </p>
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      <p className={styles.demoNote} role="status" aria-live="polite">
        {message}
      </p>

      <div className={styles.table} role="table" aria-label="作品管理列表">
        <div className={styles.table__head} role="row">
          <span role="columnheader">作品</span>
          <span role="columnheader">狀態</span>
          <span role="columnheader">章節數</span>
          <span role="columnheader">總瀏覽</span>
          <span role="columnheader">收藏 / 留言</span>
          <span role="columnheader">最後更新</span>
          <span role="columnheader">操作</span>
        </div>

        {novels.map((novel) => (
          <div className={styles.table__row} role="row" key={novel.id}>
            <div className={styles.novel} role="cell">
              <div className={styles.novel__cover} style={{ background: novel.coverColor }}>
                <span aria-hidden="true">{novel.title.charAt(0)}</span>
              </div>
              <div>
                {/* 作品項目連至作品管理頁（FR-014） */}
                <Link href={`/author/novels/${novel.id}`} className={styles.novel__title}>
                  {novel.title}
                </Link>
                <p className={styles.novel__category}>{novel.category}</p>
              </div>
            </div>

            <div role="cell">
              <Badge variant={STATUS_VARIANT[novel.status]} size="sm">
                {STATUS_LABEL[novel.status]}
              </Badge>
            </div>

            <div role="cell" className={styles.table__num}>
              {novel.chapterCount} 章
            </div>

            <div role="cell" className={styles.table__num}>
              <Eye size={14} />
              {formatNumber(novel.totalViews)}
            </div>

            <div role="cell" className={styles.table__num}>
              <span className={styles.table__inlineStat}>
                <Heart size={14} />
                {formatNumber(novel.favoriteCount)}
              </span>
              <span className={styles.table__inlineStat}>
                <ChatCircle size={14} />
                {formatNumber(novel.commentCount)}
              </span>
            </div>

            <div role="cell" className={styles.table__date}>
              {novel.updatedAt}
            </div>

            <div role="cell" className={styles.table__actions}>
              <Link
                href={`/author/novels/${novel.id}`}
                className={styles.table__actionBtn}
                aria-label={`管理《${novel.title}》的分卷與章節`}
              >
                <PencilSimple size={16} />
              </Link>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => toggleSerialStatus(novel)}
                aria-label={
                  novel.status === 'hiatus'
                    ? `恢復《${novel.title}》的連載`
                    : `暫停《${novel.title}》的連載`
                }
              >
                {novel.status === 'hiatus' ? '恢復連載' : '暫停連載'}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
