import React from 'react';
import { requireAdmin } from '@/lib/auth/guard';
import * as adminService from '@/lib/services/adminService';
import { AuditLogTable } from '@/components/admin/AuditLogTable';
import page from '@/components/admin/AdminPage.module.css';

interface AdminAuditPageProps {
  searchParams: Promise<{
    actorId?: string;
    action?: string;
    targetType?: string;
    targetId?: string;
    dateFrom?: string;
    dateTo?: string;
    cursor?: string;
  }>;
}

export const metadata = {
  title: '安全稽核留痕 | 管理中心',
};

export default async function AdminAuditPage({ searchParams }: AdminAuditPageProps) {
  await requireAdmin();
  const sp = await searchParams;

  const filter = {
    actorId: sp.actorId,
    action: sp.action,
    targetType: sp.targetType,
    targetId: sp.targetId,
    dateFrom: sp.dateFrom,
    dateTo: sp.dateTo,
    cursor: sp.cursor,
  };

  const { items, totalCount } = await adminService.listAuditLogs(filter);

  return (
    <div className={page.page}>
      <header className={page.header}>
        <h1 className={page.title}>安全稽核留痕</h1>
        <p className={page.subtitle}>
          管理員的每一項高權限處置都會純追加寫入這裡。系統不提供任何修改或刪除出口， 來源 IP 於 90
          天後自動不可逆雜湊化。
        </p>
      </header>

      <AuditLogTable initialLogs={items} totalCount={totalCount} />
    </div>
  );
}
