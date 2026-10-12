import { requireAdmin } from '@/lib/auth/guard';
import * as adminService from '@/lib/services/adminService';
import { UserManagementTable } from '@/components/admin/UserManagementTable';
import page from '@/components/admin/AdminPage.module.css';

interface AdminUsersPageProps {
  searchParams: Promise<{
    search?: string;
    role?: string;
    isSuspended?: string;
    cursor?: string;
  }>;
}

export default async function AdminUsersPage({ searchParams }: AdminUsersPageProps) {
  const session = await requireAdmin();
  const sp = await searchParams;

  const filter = {
    search: sp.search,
    role: (sp.role as 'reader' | 'author' | 'admin') || undefined,
    isSuspended: sp.isSuspended === 'true' ? true : sp.isSuspended === 'false' ? false : undefined,
    cursor: sp.cursor,
    limit: 20,
  };

  const { items, totalCount } = await adminService.listUsersForAdmin(filter);

  return (
    <div className={page.page}>
      <header className={page.header}>
        <h1 className={page.title}>使用者管理</h1>
        <p className={page.subtitle}>
          檢視站內使用者名冊、調整角色、停權或復權帳號。停權會同時撤銷該帳號所有工作階段，
          但不連坐下架其名下已發佈的作品。
        </p>
      </header>

      <UserManagementTable
        initialUsers={items}
        totalCount={totalCount}
        currentAdminId={session.uid}
      />
    </div>
  );
}
