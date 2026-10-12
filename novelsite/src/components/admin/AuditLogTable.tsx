'use client';

import React, { useId, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AdminDataTable, type Column } from '@/components/admin/AdminDataTable';
import { EmptyState } from '@/components/admin/EmptyState';
import { Badge } from '@/components/ui/Badge';
import type { AuditLogRow } from '@/lib/types';
import { useSyncedList } from './useAdminList';
import styles from './AuditLogTable.module.css';

interface AuditLogTableProps {
  initialLogs: AuditLogRow[];
  totalCount: number;
}

export function AuditLogTable({ initialLogs, totalCount }: AuditLogTableProps) {
  const router = useRouter();
  /** 篩選欄位 id 前綴（憲章第 V 條：MUST 由 useId 產生） */
  const fieldIdPrefix = useId();
  const searchParams = useSearchParams();

  const [logs] = useSyncedList<AuditLogRow>(initialLogs);
  const [activeDiff, setActiveDiff] = useState<{ action: string; diff: string } | null>(null);

  const [actionFilter, setActionFilter] = useState(searchParams.get('action') ?? '');
  const [targetTypeFilter, setTargetTypeFilter] = useState(searchParams.get('targetType') ?? '');
  const [dateFrom, setDateFrom] = useState(searchParams.get('dateFrom') ?? '');
  const [dateTo, setDateTo] = useState(searchParams.get('dateTo') ?? '');

  const handleFilterSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (actionFilter.trim()) params.set('action', actionFilter.trim());
    if (targetTypeFilter.trim()) params.set('targetType', targetTypeFilter.trim());
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);

    router.push(`/admin/audit?${params.toString()}`);
  };

  const formatDiffJson = (raw: string) => {
    try {
      const obj = JSON.parse(raw);
      return JSON.stringify(obj, null, 2);
    } catch {
      return raw;
    }
  };

  const columns: Column<AuditLogRow>[] = [
    {
      key: 'createdAt',
      header: '操作時間',
      render: (row) => {
        const d = new Date(row.createdAt);
        return (
          <span className={styles.timeCell}>
            {d.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}
          </span>
        );
      },
    },
    {
      key: 'actor',
      header: '操作者',
      render: (row) => (
        <div className={styles.field}>
          <strong>{row.actorName || '系統／未知'}</strong>
          <span className={styles.timeCell}>{row.actorEmail || row.actorId}</span>
        </div>
      ),
    },
    {
      key: 'action',
      header: '處置動作',
      render: (row) => {
        let variant: 'default' | 'success' | 'warning' | 'error' | 'info' = 'default';
        if (row.action.includes('delete') || row.action.includes('suspend')) {
          variant = 'error';
        } else if (row.action.includes('restore') || row.action.includes('create')) {
          variant = 'success';
        } else if (
          row.action.includes('role') ||
          row.action.includes('password') ||
          row.action.includes('merge')
        ) {
          variant = 'warning';
        }
        return <Badge variant={variant}>{row.action}</Badge>;
      },
    },
    {
      key: 'target',
      header: '目標對象',
      render: (row) => (
        <div className={styles.field}>
          <strong>{row.targetType}</strong>
          <code className={styles.actionTag}>{row.targetId.slice(0, 12)}…</code>
        </div>
      ),
    },
    {
      key: 'reason',
      header: '理由 / 說明',
      render: (row) => <span className={styles.reasonCell}>{row.reason || '—'}</span>,
    },
    {
      key: 'ip',
      header: '來源 IP',
      render: (row) => (
        <code className={styles.actionTag}>
          {row.ip ? (row.ip.length === 64 ? `${row.ip.slice(0, 8)}…（已雜湊）` : row.ip) : '—'}
        </code>
      ),
    },
    {
      key: 'diff',
      header: '異動紀錄',
      render: (row) => (
        <button
          type="button"
          className={styles.actionBtn}
          onClick={() => setActiveDiff({ action: row.action, diff: row.diff })}
        >
          查看 Diff
        </button>
      ),
    },
  ];

  return (
    <div className={styles.container}>
      {/* 每個欄位都用真的 <label htmlFor>；原本是 <div> 包文字，螢幕閱讀器讀不到關聯 */}
      <form className={styles.filterBar} onSubmit={handleFilterSubmit}>
        <div className={styles.field}>
          <label className={styles.filterLabel} htmlFor={`${fieldIdPrefix}-action`}>
            動作別
          </label>
          <input
            id={`${fieldIdPrefix}-action`}
            type="text"
            className={styles.input}
            placeholder="例如：user.suspend"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.filterLabel} htmlFor={`${fieldIdPrefix}-target`}>
            對象類型
          </label>
          <input
            id={`${fieldIdPrefix}-target`}
            type="text"
            className={styles.input}
            placeholder="User / Novel / Tag"
            value={targetTypeFilter}
            onChange={(e) => setTargetTypeFilter(e.target.value)}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.filterLabel} htmlFor={`${fieldIdPrefix}-from`}>
            起日
          </label>
          <input
            id={`${fieldIdPrefix}-from`}
            type="date"
            className={styles.dateInput}
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.filterLabel} htmlFor={`${fieldIdPrefix}-to`}>
            訖日
          </label>
          <input
            id={`${fieldIdPrefix}-to`}
            type="date"
            className={styles.dateInput}
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>

        <button type="submit" className={styles.actionBtn}>
          套用篩選
        </button>
      </form>

      <AdminDataTable
        columns={columns}
        data={logs}
        keyExtractor={(item) => item.id}
        caption={`安全稽核留痕紀錄（共 ${totalCount} 筆）`}
        emptyNode={
          <EmptyState title="查無稽核日誌" description="在指定的條件區間內未記錄到任何管理操作。" />
        }
      />

      {/* Diff 檢視彈窗 */}
      {activeDiff && (
        <div
          className={styles.diffModalOverlay}
          role="dialog"
          aria-modal="true"
          aria-labelledby="diff-dialog-title"
        >
          <div className={styles.diffModal}>
            <h2 id="diff-dialog-title" className={styles.diffTitle}>
              處置前後 Diff 明細：{activeDiff.action}
            </h2>
            <pre className={styles.diffPre}>{formatDiffJson(activeDiff.diff)}</pre>
            <button type="button" className={styles.closeBtn} onClick={() => setActiveDiff(null)}>
              關閉
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
