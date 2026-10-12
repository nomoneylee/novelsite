import { requireAdmin } from '@/lib/auth/guard';
import * as adminService from '@/lib/services/adminService';
import { NovelManagementTable } from '@/components/admin/NovelManagementTable';
import page from '@/components/admin/AdminPage.module.css';

interface AdminContentPageProps {
  searchParams: Promise<{
    search?: string;
    categoryId?: string;
    status?: string;
    cursor?: string;
  }>;
}

export default async function AdminContentPage({ searchParams }: AdminContentPageProps) {
  await requireAdmin();
  const sp = await searchParams;

  const filter = {
    search: sp.search,
    categoryId: sp.categoryId,
    status: (sp.status as 'draft' | 'published' | 'admin_suspended') || undefined,
    cursor: sp.cursor,
    limit: 20,
  };

  const { items, totalCount } = await adminService.listNovelsForAdmin(filter);

  return (
    <div className={page.page}>
      <header className={page.header}>
        <h1 className={page.title}>作品內容管理</h1>
        <p className={page.subtitle}>
          審查全站作品狀態、執行違規下架、恢復發佈或強制刪除。下架採
          <code>admin_suspended</code> 狀態，前台一律 404，作者無法自行改回公開。
        </p>
      </header>

      <NovelManagementTable initialNovels={items} totalCount={totalCount} />
    </div>
  );
}
