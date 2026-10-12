'use client';

import React, { useState, useId } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus } from '@phosphor-icons/react';
import { AdminDataTable, type Column } from '@/components/admin/AdminDataTable';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { EmptyState } from '@/components/admin/EmptyState';
import { showToast } from '@/components/ui/Toast';
import {
  createTagAction,
  renameTagAction,
  mergeTagsAction,
  deleteTagAction,
} from '@/app/admin/tags/actions';
import type { AdminTagRow } from '@/lib/types';
import { useSyncedList, useDebouncedCallback } from './useAdminList';
import styles from './TagManagementTable.module.css';

interface TagManagementTableProps {
  initialTags: AdminTagRow[];
}

export function TagManagementTable({ initialTags }: TagManagementTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const createNameId = useId();
  const createSlugId = useId();
  const createModalTitleId = useId();
  const editNameId = useId();
  const editSlugId = useId();
  const editModalTitleId = useId();
  const mergeTargetSelectId = useId();
  const forceDeleteCheckboxId = useId();
  const fieldIdPrefix = useId();

  const [tags, setTags] = useSyncedList<AdminTagRow>(initialTags);
  const [searchTerm, setSearchTerm] = useState(searchParams.get('search') ?? '');
  const [sortBy, setSortBy] = useState<'name' | 'count'>(
    (searchParams.get('sortBy') as 'name' | 'count') || 'name'
  );
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(
    (searchParams.get('sortOrder') as 'asc' | 'desc') || 'asc'
  );

  // 模態框狀態
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editTag, setEditTag] = useState<AdminTagRow | null>(null);
  const [mergeSourceTag, setMergeSourceTag] = useState<AdminTagRow | null>(null);
  const [deleteTargetTag, setDeleteTargetTag] = useState<AdminTagRow | null>(null);

  // 表單資料狀態
  const [formName, setFormName] = useState('');
  const [formSlug, setFormSlug] = useState('');
  const [selectedTargetTagId, setSelectedTargetTagId] = useState('');
  const [forceDelete, setForceDelete] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleFilterChange = (
    newSearch?: string,
    newSortBy?: 'name' | 'count',
    newSortOrder?: 'asc' | 'desc'
  ) => {
    const params = new URLSearchParams();
    const s = newSearch !== undefined ? newSearch : searchTerm;
    const sb = newSortBy !== undefined ? newSortBy : sortBy;
    const so = newSortOrder !== undefined ? newSortOrder : sortOrder;

    if (s.trim()) params.set('search', s.trim());
    if (sb) params.set('sortBy', sb);
    if (so) params.set('sortOrder', so);

    router.push(`/admin/tags?${params.toString()}`);
  };

  /** 邊打字邊搜尋 MUST 去抖：否則每個字元都送一次導覽，中文組字過程還會各觸發一次 */
  const debouncedSearch = useDebouncedCallback((value: string) => {
    handleFilterChange(value, undefined, undefined);
  });

  const handleCreateTag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim() || !formSlug.trim()) {
      showToast('請完整填寫標籤名稱與代稱', 'error');
      return;
    }

    setIsLoading(true);
    try {
      const res = await createTagAction({ name: formName.trim(), slug: formSlug.trim() });
      if (res.success) {
        showToast(`已成功建立標籤「${formName.trim()}」`, 'success');
        setTags((prev) => [
          ...prev,
          { id: res.data.id, name: formName.trim(), slug: formSlug.trim(), novelCount: 0 },
        ]);
        setIsCreateOpen(false);
        setFormName('');
        setFormSlug('');
      } else {
        showToast(res.error.message, 'error');
      }
    } catch {
      showToast('建立標籤失敗', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRenameTag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTag || !formName.trim() || !formSlug.trim()) return;

    setIsLoading(true);
    try {
      const res = await renameTagAction({
        tagId: editTag.id,
        name: formName.trim(),
        slug: formSlug.trim(),
      });
      if (res.success) {
        showToast(`已成功修改標籤「${formName.trim()}」`, 'success');
        setTags((prev) =>
          prev.map((t) =>
            t.id === editTag.id ? { ...t, name: formName.trim(), slug: formSlug.trim() } : t
          )
        );
        setEditTag(null);
      } else {
        showToast(res.error.message, 'error');
      }
    } catch {
      showToast('修改標籤失敗', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleMergeConfirm = async (reason: string) => {
    if (!mergeSourceTag || !selectedTargetTagId) return;

    setIsLoading(true);
    try {
      const res = await mergeTagsAction({
        sourceTagId: mergeSourceTag.id,
        targetTagId: selectedTargetTagId,
        reason,
      });
      if (res.success) {
        showToast(
          `已成功將標籤「${mergeSourceTag.name}」合併，影響 ${res.data.affectedCount} 部作品`,
          'success'
        );
        setTags((prev) => prev.filter((t) => t.id !== mergeSourceTag.id));
        setMergeSourceTag(null);
        setSelectedTargetTagId('');
      } else {
        showToast(res.error.message, 'error');
      }
    } catch {
      showToast('標籤合併失敗', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteConfirm = async (reason: string) => {
    if (!deleteTargetTag) return;

    setIsLoading(true);
    try {
      const res = await deleteTagAction({
        tagId: deleteTargetTag.id,
        force: forceDelete,
        reason,
      });
      if (res.success) {
        showToast(`已成功刪除標籤「${deleteTargetTag.name}」`, 'success');
        setTags((prev) => prev.filter((t) => t.id !== deleteTargetTag.id));
        setDeleteTargetTag(null);
        setForceDelete(false);
      } else {
        showToast(res.error.message, 'error');
      }
    } catch {
      showToast('刪除標籤失敗', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const columns: Column<AdminTagRow>[] = [
    {
      key: 'name',
      header: '標籤名稱',
      render: (row) => <span className={styles.tagName}>{row.name}</span>,
    },
    {
      key: 'slug',
      header: '代稱 (Slug)',
      render: (row) => <code className={styles.slug}>{row.slug}</code>,
    },
    {
      key: 'novelCount',
      header: '關聯作品數',
      render: (row) => <span>{row.novelCount} 部</span>,
    },
    {
      key: 'actions',
      header: '治理操作',
      render: (row) => (
        <div className={styles.actionsCell}>
          <button
            type="button"
            className={styles.actionBtn}
            onClick={() => {
              setEditTag(row);
              setFormName(row.name);
              setFormSlug(row.slug);
            }}
          >
            編輯
          </button>

          <button
            type="button"
            className={styles.actionBtn}
            onClick={() => {
              setMergeSourceTag(row);
              setSelectedTargetTagId('');
            }}
          >
            合併至…
          </button>

          <button
            type="button"
            className={`${styles.actionBtn} ${styles.dangerBtn}`}
            onClick={() => {
              setDeleteTargetTag(row);
              setForceDelete(false);
            }}
          >
            刪除
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className={styles.container}>
      <div className={styles.topBar}>
        <div className={styles.filterBar}>
          <div className={styles.fieldGrow}>
            <label className={styles.label} htmlFor={`${fieldIdPrefix}-search`}>
              搜尋
            </label>
            <input
              id={`${fieldIdPrefix}-search`}
              type="search"
              className={styles.searchInput}
              placeholder="標籤名稱或代稱"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                debouncedSearch(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter')
                  handleFilterChange(e.currentTarget.value, undefined, undefined);
              }}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${fieldIdPrefix}-sortby`}>
              排序依據
            </label>
            <select
              id={`${fieldIdPrefix}-sortby`}
              className={styles.select}
              value={sortBy}
              onChange={(e) => {
                const val = e.target.value as 'name' | 'count';
                setSortBy(val);
                handleFilterChange(undefined, val, undefined);
              }}
            >
              <option value="name">名稱</option>
              <option value="count">關聯作品數</option>
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${fieldIdPrefix}-sortorder`}>
              排序順序
            </label>
            <select
              id={`${fieldIdPrefix}-sortorder`}
              className={styles.select}
              value={sortOrder}
              onChange={(e) => {
                const val = e.target.value as 'asc' | 'desc';
                setSortOrder(val);
                handleFilterChange(undefined, undefined, val);
              }}
            >
              <option value="asc">遞增（A-Z／小到大）</option>
              <option value="desc">遞減（Z-A／大到小）</option>
            </select>
          </div>
        </div>

        <button
          type="button"
          className={styles.primaryBtn}
          onClick={() => {
            setIsCreateOpen(true);
            setFormName('');
            setFormSlug('');
          }}
        >
          <Plus size={16} aria-hidden="true" />
          新增標籤
        </button>
      </div>

      <AdminDataTable
        columns={columns}
        data={tags}
        keyExtractor={(item) => item.id}
        caption={`標籤管理名冊（共 ${tags.length} 個標籤）`}
        emptyNode={<EmptyState title="查無標籤" description="尚未建立符合條件的標籤。" />}
      />

      {/* 新增標籤彈窗 */}
      {isCreateOpen && (
        <div
          className={styles.modalOverlay}
          role="dialog"
          aria-modal="true"
          aria-labelledby={createModalTitleId}
        >
          <form className={styles.modal} onSubmit={handleCreateTag}>
            <h2 id={createModalTitleId} className={styles.modalTitle}>
              新增全站標籤
            </h2>

            <div className={styles.formGroup}>
              <label htmlFor={createNameId} className={styles.formLabel}>
                標籤名稱
              </label>
              <input
                id={createNameId}
                type="text"
                className={styles.formInput}
                placeholder="例如：仙俠修真"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                required
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor={createSlugId} className={styles.formLabel}>
                代稱 (Slug，僅限小寫英數連字號)
              </label>
              <input
                id={createSlugId}
                type="text"
                className={styles.formInput}
                placeholder="例如：xianxia-cultivation"
                value={formSlug}
                onChange={(e) => setFormSlug(e.target.value)}
                pattern="^[a-z0-9-]+$"
                required
              />
            </div>

            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.cancelBtn}
                onClick={() => setIsCreateOpen(false)}
              >
                取消
              </button>
              <button type="submit" className={styles.submitBtn} disabled={isLoading}>
                {isLoading ? '建立中…' : '確認新增'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 編輯標籤彈窗 */}
      {editTag && (
        <div
          className={styles.modalOverlay}
          role="dialog"
          aria-modal="true"
          aria-labelledby={editModalTitleId}
        >
          <form className={styles.modal} onSubmit={handleRenameTag}>
            <h2 id={editModalTitleId} className={styles.modalTitle}>
              編輯標籤：{editTag.name}
            </h2>

            <div className={styles.formGroup}>
              <label htmlFor={editNameId} className={styles.formLabel}>
                標籤名稱
              </label>
              <input
                id={editNameId}
                type="text"
                className={styles.formInput}
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                required
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor={editSlugId} className={styles.formLabel}>
                代稱 (Slug)
              </label>
              <input
                id={editSlugId}
                type="text"
                className={styles.formInput}
                value={formSlug}
                onChange={(e) => setFormSlug(e.target.value)}
                pattern="^[a-z0-9-]+$"
                required
              />
            </div>

            <div className={styles.modalActions}>
              <button type="button" className={styles.cancelBtn} onClick={() => setEditTag(null)}>
                取消
              </button>
              <button type="submit" className={styles.submitBtn} disabled={isLoading}>
                {isLoading ? '儲存中…' : '儲存變更'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 標籤合併對話框 */}
      {mergeSourceTag && (
        <ConfirmDialog
          isOpen={true}
          isLoading={isLoading}
          onClose={() => setMergeSourceTag(null)}
          title={`合併標籤：${mergeSourceTag.name}`}
          message={
            <div>
              <p className={styles.dialogText}>
                將標籤「{mergeSourceTag.name}」（關聯 {mergeSourceTag.novelCount}{' '}
                部作品）合併至目標標籤。作品關聯會自動去重轉移，來源標籤隨後刪除。
              </p>
              <div className={styles.formGroup}>
                <label htmlFor={mergeTargetSelectId} className={styles.formLabel}>
                  請選擇目標標籤：
                </label>
                <select
                  id={mergeTargetSelectId}
                  className={`${styles.select} ${styles.fullWidth}`}
                  value={selectedTargetTagId}
                  onChange={(e) => setSelectedTargetTagId(e.target.value)}
                >
                  <option value="">-- 請選擇目標標籤 --</option>
                  {tags
                    .filter((t) => t.id !== mergeSourceTag.id)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.slug}) - 目前關聯 {t.novelCount} 部
                      </option>
                    ))}
                </select>
              </div>
            </div>
          }
          confirmLabel="確認合併"
          cancelLabel="取消"
          isDestructive={true}
          requireReason={true}
          onConfirm={handleMergeConfirm}
        />
      )}

      {/* 刪除標籤確認 */}
      {deleteTargetTag && (
        <ConfirmDialog
          isOpen={true}
          isLoading={isLoading}
          onClose={() => setDeleteTargetTag(null)}
          title={`刪除標籤：${deleteTargetTag.name}`}
          message={
            <div>
              <p className={styles.dialogText}>
                確定要刪除標籤「{deleteTargetTag.name}」嗎？
                {deleteTargetTag.novelCount > 0 && (
                  <span className={styles.dialogWarning}>
                    警告：此標籤目前仍有 {deleteTargetTag.novelCount} 部關聯作品。
                  </span>
                )}
              </p>
              {deleteTargetTag.novelCount > 0 && (
                <label htmlFor={forceDeleteCheckboxId} className={styles.checkboxLabel}>
                  <input
                    id={forceDeleteCheckboxId}
                    type="checkbox"
                    checked={forceDelete}
                    onChange={(e) => setForceDelete(e.target.checked)}
                  />
                  <span>我了解並確認強制解除與作品的關聯並刪除</span>
                </label>
              )}
            </div>
          }
          confirmLabel="確認刪除"
          cancelLabel="取消"
          isDestructive={true}
          requireReason={true}
          onConfirm={handleDeleteConfirm}
        />
      )}
    </div>
  );
}
