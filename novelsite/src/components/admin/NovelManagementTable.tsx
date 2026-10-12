'use client';

import React, { useId, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AdminDataTable, type Column } from '@/components/admin/AdminDataTable';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { EmptyState } from '@/components/admin/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { showToast } from '@/components/ui/Toast';
import {
  suspendNovelAction,
  restoreNovelAction,
  deleteNovelAction,
} from '@/app/admin/content/actions';
import type { AdminNovelRow } from '@/lib/types';
import { useSyncedList, useDebouncedCallback } from './useAdminList';
import styles from './NovelManagementTable.module.css';

interface NovelManagementTableProps {
  initialNovels: AdminNovelRow[];
  totalCount: number;
}

export function NovelManagementTable({ initialNovels, totalCount }: NovelManagementTableProps) {
  const router = useRouter();
  /** 篩選欄位 id 前綴（憲章第 V 條：MUST 由 useId 產生，SSR 與瀏覽器才一致） */
  const fieldIdPrefix = useId();
  const searchParams = useSearchParams();

  const [novels, setNovels] = useSyncedList<AdminNovelRow>(initialNovels);
  const [searchTerm, setSearchTerm] = useState(searchParams.get('search') ?? '');
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') ?? '');

  const [activeDialog, setActiveDialog] = useState<
    | { type: 'suspend'; novel: AdminNovelRow }
    | { type: 'restore'; novel: AdminNovelRow }
    | { type: 'delete'; novel: AdminNovelRow }
    | null
  >(null);

  const [isLoading, setIsLoading] = useState(false);

  const handleFilterChange = (newSearch?: string, newStatus?: string) => {
    const params = new URLSearchParams();
    const s = newSearch !== undefined ? newSearch : searchTerm;
    const st = newStatus !== undefined ? newStatus : statusFilter;

    if (s.trim()) params.set('search', s.trim());
    if (st) params.set('status', st);

    router.push(`/admin/content?${params.toString()}`);
  };

  /** 邊打字邊搜尋 MUST 去抖：否則每個字元都送一次導覽，中文組字過程還會各觸發一次 */
  const debouncedSearch = useDebouncedCallback((value: string) => {
    handleFilterChange(value, undefined);
  });

  const handleConfirmAction = async (reason: string) => {
    if (!activeDialog) return;
    setIsLoading(true);

    try {
      if (activeDialog.type === 'suspend') {
        const res = await suspendNovelAction({
          novelId: activeDialog.novel.id,
          reason,
        });
        if (res.success) {
          showToast(`已成功下架作品「${activeDialog.novel.title}」`, 'success');
          setNovels((prev) =>
            prev.map((n) =>
              n.id === activeDialog.novel.id ? { ...n, status: 'admin_suspended' } : n
            )
          );
        } else {
          showToast(res.error.message, 'error');
        }
      } else if (activeDialog.type === 'restore') {
        const res = await restoreNovelAction({
          novelId: activeDialog.novel.id,
          reason,
        });
        if (res.success) {
          showToast(`已成功恢復上架作品「${activeDialog.novel.title}」`, 'success');
          setNovels((prev) =>
            prev.map((n) => (n.id === activeDialog.novel.id ? { ...n, status: 'published' } : n))
          );
        } else {
          showToast(res.error.message, 'error');
        }
      } else if (activeDialog.type === 'delete') {
        const res = await deleteNovelAction({
          novelId: activeDialog.novel.id,
          reason,
        });
        if (res.success) {
          showToast(`已成功刪除作品「${activeDialog.novel.title}」`, 'success');
          setNovels((prev) => prev.filter((n) => n.id !== activeDialog.novel.id));
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

  const columns: Column<AdminNovelRow>[] = [
    {
      key: 'title',
      header: '作品標題',
      render: (row) => (
        <div className={styles.titleCell}>
          <Link href={`/admin/content/${row.id}`} className={styles.titleLink}>
            {row.title}
          </Link>
          <span className={styles.titleMeta}>
            {row.chapterCount} 章・{row.wordCount.toLocaleString()} 字
          </span>
        </div>
      ),
    },
    {
      key: 'authorName',
      header: '作者',
      render: (row) => <span>{row.authorName}</span>,
    },
    {
      key: 'category',
      header: '分類',
      render: (row) => <Badge variant="default">{row.category}</Badge>,
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
      key: 'chapterCount',
      header: '章節數',
      render: (row) => <span>{row.chapterCount} 章</span>,
    },
    {
      key: 'wordCount',
      header: '總字數',
      render: (row) => <span>{row.wordCount.toLocaleString()} 字</span>,
    },
    {
      key: 'actions',
      header: '操作',
      render: (row) => (
        <div className={styles.actionsCell}>
          <Link href={`/admin/content/${row.id}`} className={styles.actionBtn}>
            章節管理
          </Link>

          {row.status === 'admin_suspended' ? (
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.successBtn}`}
              onClick={() => setActiveDialog({ type: 'restore', novel: row })}
            >
              恢復上架
            </button>
          ) : (
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.dangerBtn}`}
              onClick={() => setActiveDialog({ type: 'suspend', novel: row })}
            >
              違規下架
            </button>
          )}

          <button
            type="button"
            className={`${styles.actionBtn} ${styles.dangerBtn}`}
            onClick={() => setActiveDialog({ type: 'delete', novel: row })}
          >
            強制刪除
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className={styles.container}>
      <div className={styles.filterBar}>
        <div className={styles.fieldGrow}>
          <label className={styles.label} htmlFor={`${fieldIdPrefix}-search`}>
            搜尋
          </label>
          <input
            id={`${fieldIdPrefix}-search`}
            type="search"
            className={styles.searchInput}
            placeholder="作品標題或作者名稱"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              debouncedSearch(e.target.value);
            }}
            onKeyDown={(e) => {
              // Enter 立即送出，不等去抖
              if (e.key === 'Enter') handleFilterChange(e.currentTarget.value, undefined);
            }}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${fieldIdPrefix}-status`}>
            作品狀態
          </label>
          <select
            id={`${fieldIdPrefix}-status`}
            className={styles.select}
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              handleFilterChange(undefined, e.target.value);
            }}
          >
            <option value="">所有狀態</option>
            <option value="published">已發佈</option>
            <option value="draft">草稿</option>
            <option value="admin_suspended">管理員下架</option>
          </select>
        </div>
      </div>

      <AdminDataTable
        columns={columns}
        data={novels}
        keyExtractor={(item) => item.id}
        caption={`作品管理清單（共 ${totalCount} 部作品）`}
        emptyNode={<EmptyState title="查無作品" description="沒有符合條件的作品紀錄。" />}
      />

      {/* 確認對話框 */}
      {activeDialog && (
        <ConfirmDialog
          isOpen={true}
          title={
            activeDialog.type === 'suspend'
              ? `違規下架作品：${activeDialog.novel.title}`
              : activeDialog.type === 'restore'
                ? `恢復作品上架：${activeDialog.novel.title}`
                : `強制刪除作品：${activeDialog.novel.title}`
          }
          message={
            activeDialog.type === 'suspend'
              ? '下架後該作品在前台將立即 404 不可見，且作者端無法自行重新發佈。'
              : activeDialog.type === 'restore'
                ? '恢復上架後該作品將重新對前台讀者公開可見。'
                : '強制刪除將永久移除該作品及其全部卷、章節與留言，此操作無法復原！'
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
