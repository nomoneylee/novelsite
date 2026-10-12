'use client';

import React, { useId, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AdminDataTable, type Column } from '@/components/admin/AdminDataTable';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { EmptyState } from '@/components/admin/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { showToast } from '@/components/ui/Toast';
import {
  suspendUserAction,
  reactivateUserAction,
  changeRoleAction,
  resetUserPasswordAction,
} from '@/app/admin/users/actions';
import type { AdminUserRow } from '@/lib/types';
import { useSyncedList } from './useAdminList';
import styles from './UserManagementTable.module.css';

interface UserManagementTableProps {
  initialUsers: AdminUserRow[];
  totalCount: number;
  currentAdminId: string;
}

export function UserManagementTable({
  initialUsers,
  totalCount,
  currentAdminId,
}: UserManagementTableProps) {
  const router = useRouter();
  /** 篩選欄位 id 前綴 MUST 由 useId 產生（憲章第 V 條）：SSR 與瀏覽器要拿到同一個值，
   *  否則 hydration 後 label 的 htmlFor 對不上 input 的 id，而畫面上看不出壞掉 */
  const fieldIdPrefix = useId();
  const searchParams = useSearchParams();

  // MUST 用 useSyncedList：純 useState 不會跟著 router.push 後的新 props 更新（見該 hook 註解）
  const [users, setUsers] = useSyncedList<AdminUserRow>(initialUsers);
  const [searchTerm, setSearchTerm] = useState(searchParams.get('search') ?? '');
  const [roleFilter, setRoleFilter] = useState(searchParams.get('role') ?? '');
  const [statusFilter, setStatusFilter] = useState(searchParams.get('isSuspended') ?? '');

  // 對話框狀態
  const [activeDialog, setActiveDialog] = useState<
    | { type: 'suspend'; user: AdminUserRow }
    | { type: 'reactivate'; user: AdminUserRow }
    | { type: 'changeRole'; user: AdminUserRow; newRole: 'reader' | 'author' | 'admin' }
    | { type: 'resetPassword'; user: AdminUserRow; mode: 'email' | 'link' }
    | null
  >(null);

  const [isLoading, setIsLoading] = useState(false);
  const [resetResultLink, setResetResultLink] = useState<string | null>(null);

  const handleFilterChange = (newSearch?: string, newRole?: string, newStatus?: string) => {
    const params = new URLSearchParams();
    const s = newSearch !== undefined ? newSearch : searchTerm;
    const r = newRole !== undefined ? newRole : roleFilter;
    const st = newStatus !== undefined ? newStatus : statusFilter;

    if (s.trim()) params.set('search', s.trim());
    if (r) params.set('role', r);
    if (st) params.set('isSuspended', st);

    router.push(`/admin/users?${params.toString()}`);
  };

  const handleConfirmAction = async (reason: string) => {
    if (!activeDialog) return;
    setIsLoading(true);

    try {
      if (activeDialog.type === 'suspend') {
        const res = await suspendUserAction({
          userId: activeDialog.user.id,
          reason,
        });
        if (!res.success) {
          showToast(res.error.message, 'error');
        } else {
          showToast(`已成功停權使用者 ${activeDialog.user.name}`, 'success');
          setUsers((prev) =>
            prev.map((u) =>
              u.id === activeDialog.user.id
                ? { ...u, isSuspended: true, suspendedAt: new Date().toISOString() }
                : u
            )
          );
          setActiveDialog(null);
        }
      } else if (activeDialog.type === 'reactivate') {
        const res = await reactivateUserAction({
          userId: activeDialog.user.id,
          reason,
        });
        if (!res.success) {
          showToast(res.error.message, 'error');
        } else {
          showToast(`已成功復權使用者 ${activeDialog.user.name}`, 'success');
          setUsers((prev) =>
            prev.map((u) =>
              u.id === activeDialog.user.id ? { ...u, isSuspended: false, suspendedAt: null } : u
            )
          );
          setActiveDialog(null);
        }
      } else if (activeDialog.type === 'changeRole') {
        const res = await changeRoleAction({
          userId: activeDialog.user.id,
          newRole: activeDialog.newRole,
          reason,
        });
        if (!res.success) {
          showToast(res.error.message, 'error');
        } else {
          showToast(
            `已將使用者 ${activeDialog.user.name} 角色變更為 ${activeDialog.newRole}`,
            'success'
          );
          setUsers((prev) =>
            prev.map((u) =>
              u.id === activeDialog.user.id ? { ...u, role: activeDialog.newRole } : u
            )
          );
          setActiveDialog(null);
        }
      } else if (activeDialog.type === 'resetPassword') {
        const res = await resetUserPasswordAction({
          userId: activeDialog.user.id,
          mode: activeDialog.mode,
        });
        if (!res.success) {
          showToast(res.error.message, 'error');
        } else {
          if (res.data.mode === 'email') {
            showToast(`已成功寄出密碼重設信至 ${activeDialog.user.email}`, 'success');
            setActiveDialog(null);
          } else {
            setResetResultLink(window.location.origin + res.data.resetUrl);
          }
        }
      }
    } finally {
      setIsLoading(false);
    }
  };

  const columns: Column<AdminUserRow>[] = [
    {
      key: 'name',
      header: '使用者',
      render: (u) => (
        <div className={styles.userCell}>
          <Link href={`/admin/users/${u.id}`} className={styles.userName}>
            {u.name}
          </Link>
          <span className={styles.userMeta}>{u.email}</span>
          {u.penName && <span className={styles.penName}>筆名：{u.penName}</span>}
        </div>
      ),
    },
    {
      key: 'role',
      header: '角色',
      width: '100px',
      render: (u) => {
        const variantMap: Record<string, 'info' | 'success' | 'warning'> = {
          admin: 'warning',
          author: 'success',
          reader: 'info',
        };
        const labelMap: Record<string, string> = {
          admin: '管理員',
          author: '作者',
          reader: '讀者',
        };
        return (
          <Badge variant={variantMap[u.role] ?? 'default'}>{labelMap[u.role] ?? u.role}</Badge>
        );
      },
    },
    {
      key: 'status',
      header: '狀態',
      width: '100px',
      render: (u) => (
        <Badge variant={u.isSuspended ? 'error' : 'success'}>
          {u.isSuspended ? '已停權' : '正常'}
        </Badge>
      ),
    },
    {
      key: 'stats',
      header: '作品 / 留言',
      width: '120px',
      render: (u) => (
        <span className={styles.statsCell}>
          {u.novelCount ?? 0} 部 / {u.commentCount ?? 0} 則
        </span>
      ),
    },
    {
      key: 'createdAt',
      header: '註冊時間',
      width: '140px',
      render: (u) => (
        <span className={styles.dateCell}>{new Date(u.createdAt).toLocaleDateString('zh-TW')}</span>
      ),
    },
    {
      key: 'actions',
      header: '操作',
      width: '240px',
      render: (u) => {
        const isSelf = u.id === currentAdminId;

        return (
          <div className={styles.actionsCell}>
            {u.isSuspended ? (
              <button
                type="button"
                className={`${styles.actionBtn} ${styles.successBtn}`}
                onClick={() => setActiveDialog({ type: 'reactivate', user: u })}
              >
                復權
              </button>
            ) : (
              <button
                type="button"
                className={`${styles.actionBtn} ${styles.dangerBtn}`}
                disabled={isSelf}
                title={isSelf ? '無法停權自己的帳號' : '停權使用者'}
                onClick={() => setActiveDialog({ type: 'suspend', user: u })}
              >
                停權
              </button>
            )}

            {/* 角色調整 */}
            <select
              className={styles.roleSelect}
              aria-label={`變更 ${u.name} 的角色`}
              value={u.role}
              disabled={isSelf}
              onChange={(e) => {
                const newRole = e.target.value as 'reader' | 'author' | 'admin';
                if (newRole !== u.role) {
                  setActiveDialog({ type: 'changeRole', user: u, newRole });
                }
              }}
            >
              <option value="reader">讀者</option>
              <option value="author">作者</option>
              <option value="admin">管理員</option>
            </select>

            {/* 重設密碼按鈕 */}
            <button
              type="button"
              className={styles.actionBtn}
              onClick={() => setActiveDialog({ type: 'resetPassword', user: u, mode: 'link' })}
            >
              重設連結
            </button>
          </div>
        );
      },
    },
  ];

  return (
    <div className={styles.container}>
      {/* 篩選工具列 */}
      {/*
        篩選列的每個欄位都有**可見**標籤。placeholder MUST NOT 當標籤用：
        使用者一開始打字它就消失，等於把「這格是什麼」抽掉
      */}
      <div className={styles.filterBar}>
        <div className={styles.fieldGrow}>
          <label className={styles.label} htmlFor={`${fieldIdPrefix}-search`}>
            搜尋
          </label>
          <input
            id={`${fieldIdPrefix}-search`}
            type="search"
            className={styles.searchInput}
            placeholder="姓名、Email 或筆名"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleFilterChange(searchTerm)}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${fieldIdPrefix}-role`}>
            角色
          </label>
          <select
            id={`${fieldIdPrefix}-role`}
            className={styles.select}
            value={roleFilter}
            onChange={(e) => {
              setRoleFilter(e.target.value);
              handleFilterChange(undefined, e.target.value);
            }}
          >
            <option value="">全部角色</option>
            <option value="reader">讀者</option>
            <option value="author">作者</option>
            <option value="admin">管理員</option>
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${fieldIdPrefix}-status`}>
            帳號狀態
          </label>
          <select
            id={`${fieldIdPrefix}-status`}
            className={styles.select}
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              handleFilterChange(undefined, undefined, e.target.value);
            }}
          >
            <option value="">全部狀態</option>
            <option value="false">正常</option>
            <option value="true">已停權</option>
          </select>
        </div>
      </div>

      {/* 資料表格 */}
      <AdminDataTable
        columns={columns}
        data={users}
        keyExtractor={(u) => u.id}
        caption={`使用者管理清單（共 ${totalCount} 位使用者）`}
        emptyNode={<EmptyState title="查無符合條件的使用者" />}
      />

      {/* 確認對話框 */}
      {activeDialog && (
        <ConfirmDialog
          isOpen={true}
          isLoading={isLoading}
          onClose={() => {
            setActiveDialog(null);
            setResetResultLink(null);
          }}
          title={
            activeDialog.type === 'suspend'
              ? `停權使用者：${activeDialog.user.name}`
              : activeDialog.type === 'reactivate'
                ? `復權使用者：${activeDialog.user.name}`
                : activeDialog.type === 'changeRole'
                  ? `變更角色：${activeDialog.user.name} → ${activeDialog.newRole}`
                  : `產生重設密碼連結：${activeDialog.user.name}`
          }
          message={
            resetResultLink ? (
              <div className={styles.resetResult}>
                <p>已產生 15 分鐘一次性密碼重設連結：</p>
                <input
                  type="text"
                  readOnly
                  value={resetResultLink}
                  aria-label="一次性密碼重設連結"
                  className={styles.copyInput}
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
              </div>
            ) : (
              <span>
                {activeDialog.type === 'suspend' &&
                  '停權後該使用者所有登入 Session 將立即失效且無法登入。'}
                {activeDialog.type === 'reactivate' && '復權後使用者可恢復正常登入與站內活動。'}
                {activeDialog.type === 'changeRole' &&
                  '變更角色將撤銷該使用者現有 Session，下次登入時生效。'}
                {activeDialog.type === 'resetPassword' &&
                  '系統將產生一組 15 分鐘有效的一次性重設連結，全程不經手明文密碼。'}
              </span>
            )
          }
          confirmLabel={resetResultLink ? '完成' : '確認執行'}
          cancelLabel={resetResultLink ? '關閉' : '取消'}
          isDestructive={activeDialog.type === 'suspend'}
          requireReason={!resetResultLink && activeDialog.type !== 'resetPassword'}
          onConfirm={
            resetResultLink
              ? () => {
                  setActiveDialog(null);
                  setResetResultLink(null);
                }
              : handleConfirmAction
          }
        />
      )}
    </div>
  );
}
