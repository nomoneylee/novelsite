'use client';

import React, { useState } from 'react';
import { AdminDataTable, type Column } from '@/components/admin/AdminDataTable';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { EmptyState } from '@/components/admin/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { showToast } from '@/components/ui/Toast';
import {
  suspendChapterAction,
  restoreChapterAction,
  deleteChapterAction,
} from '@/app/admin/content/actions';
import type { AdminChapterRow } from '@/lib/types';
import styles from './NovelManagementTable.module.css';

interface ChapterManagementTableProps {
  initialChapters: AdminChapterRow[];
  novelTitle: string;
  novelId: string;
}

export function ChapterManagementTable({
  initialChapters,
  novelTitle,
  novelId,
}: ChapterManagementTableProps) {
  const [chapters, setChapters] = useState<AdminChapterRow[]>(initialChapters);
  const [activeDialog, setActiveDialog] = useState<
    | { type: 'suspend'; chapter: AdminChapterRow }
    | { type: 'restore'; chapter: AdminChapterRow }
    | { type: 'delete'; chapter: AdminChapterRow }
    | null
  >(null);

  const [isLoading, setIsLoading] = useState(false);

  const handleConfirmAction = async (reason: string) => {
    if (!activeDialog) return;
    setIsLoading(true);

    try {
      if (activeDialog.type === 'suspend') {
        const res = await suspendChapterAction({
          chapterId: activeDialog.chapter.id,
          reason,
        });
        if (res.success) {
          showToast(`已成功下架第 ${activeDialog.chapter.number} 章`, 'success');
          setChapters((prev) =>
            prev.map((c) =>
              c.id === activeDialog.chapter.id ? { ...c, status: 'admin_suspended' } : c
            )
          );
        } else {
          showToast(res.error.message, 'error');
        }
      } else if (activeDialog.type === 'restore') {
        const res = await restoreChapterAction({
          chapterId: activeDialog.chapter.id,
          reason,
        });
        if (res.success) {
          showToast(`已成功恢復第 ${activeDialog.chapter.number} 章`, 'success');
          setChapters((prev) =>
            prev.map((c) => (c.id === activeDialog.chapter.id ? { ...c, status: 'published' } : c))
          );
        } else {
          showToast(res.error.message, 'error');
        }
      } else if (activeDialog.type === 'delete') {
        const res = await deleteChapterAction({
          chapterId: activeDialog.chapter.id,
          reason,
        });
        if (res.success) {
          showToast(
            `已刪除第 ${activeDialog.chapter.number} 章，作品字數重算為 ${res.data.wordCount.toLocaleString()} 字`,
            'success'
          );
          setChapters((prev) => prev.filter((c) => c.id !== activeDialog.chapter.id));
        } else {
          showToast(res.error.message, 'error');
        }
      }
    } catch {
      showToast('操作發生非預期錯誤', 'error');
    } finally {
      setIsLoading(false);
      setActiveDialog(null);
    }
  };

  const columns: Column<AdminChapterRow>[] = [
    {
      key: 'number',
      header: '章號',
      render: (row) => <span className={styles.titleLink}>第 {row.number} 章</span>,
    },
    {
      key: 'title',
      header: '章節標題',
      render: (row) => <span>{row.title}</span>,
    },
    {
      key: 'wordCount',
      header: '字數',
      render: (row) => <span>{row.wordCount.toLocaleString()} 字</span>,
    },
    {
      key: 'status',
      header: '狀態',
      render: (row) => {
        if (row.status === 'admin_suspended') {
          return <Badge variant="error">管理員下架</Badge>;
        }
        if (row.status === 'published') {
          return <Badge variant="success">已發佈</Badge>;
        }
        return <Badge variant="default">草稿</Badge>;
      },
    },
    {
      key: 'commentCount',
      header: '留言數',
      render: (row) => <span>{row.commentCount} 則</span>,
    },
    {
      key: 'actions',
      header: '處置操作',
      render: (row) => (
        <div className={styles.actionsCell}>
          {row.status === 'admin_suspended' ? (
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.successBtn}`}
              onClick={() => setActiveDialog({ type: 'restore', chapter: row })}
            >
              恢復發佈
            </button>
          ) : (
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.dangerBtn}`}
              onClick={() => setActiveDialog({ type: 'suspend', chapter: row })}
            >
              違規下架
            </button>
          )}

          <button
            type="button"
            className={`${styles.actionBtn} ${styles.dangerBtn}`}
            onClick={() => setActiveDialog({ type: 'delete', chapter: row })}
          >
            硬刪除
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className={styles.container}>
      {/* 返回入口已在頁面層的 backLink，這裡不再重複一個 */}
      <p className={styles.numericCell}>作品識別碼：{novelId}</p>

      <AdminDataTable
        columns={columns}
        data={chapters}
        keyExtractor={(item) => item.id}
        caption={`《${novelTitle}》章節審閱清單（共 ${chapters.length} 章）`}
        emptyNode={<EmptyState title="尚無章節" description="本部作品目前尚未建立任何章節。" />}
      />

      {activeDialog && (
        <ConfirmDialog
          isOpen={true}
          title={
            activeDialog.type === 'suspend'
              ? `違規下架章節：第 ${activeDialog.chapter.number} 章`
              : activeDialog.type === 'restore'
                ? `恢復發佈章節：第 ${activeDialog.chapter.number} 章`
                : `硬刪除章節：第 ${activeDialog.chapter.number} 章`
          }
          message={
            activeDialog.type === 'suspend'
              ? '下架後讀者將無法閱讀此章，作者端亦無法自主發佈此章。'
              : activeDialog.type === 'restore'
                ? '恢復後該章節將重新對讀者公開。'
                : '硬刪除將永久抹除此章節及其內文與留言，並立即重算作品字數與章節總數，無法復原！'
          }
          confirmLabel={
            activeDialog.type === 'suspend'
              ? '確認下架'
              : activeDialog.type === 'restore'
                ? '確認恢復'
                : '確認刪除'
          }
          cancelLabel="取消"
          isDestructive={activeDialog.type !== 'restore'}
          requireReason={true}
          isLoading={isLoading}
          onConfirm={handleConfirmAction}
          onClose={() => setActiveDialog(null)}
        />
      )}
    </div>
  );
}
