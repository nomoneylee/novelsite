import { requireAdmin } from '@/lib/auth/guard';
import * as adminService from '@/lib/services/adminService';
import { TagManagementTable } from '@/components/admin/TagManagementTable';
import page from '@/components/admin/AdminPage.module.css';

interface AdminTagsPageProps {
  searchParams: Promise<{
    search?: string;
    sortBy?: 'name' | 'count';
    sortOrder?: 'asc' | 'desc';
  }>;
}

export default async function AdminTagsPage({ searchParams }: AdminTagsPageProps) {
  await requireAdmin();
  const sp = await searchParams;

  const filter = {
    search: sp.search,
    sortBy: sp.sortBy,
    sortOrder: sp.sortOrder,
  };

  const tags = await adminService.listTags(filter);

  return (
    <div className={page.page}>
      <header className={page.header}>
        <h1 className={page.title}>標籤治理</h1>
        <p className={page.subtitle}>
          建立全站規範標籤、修正錯字與代稱、合併語意重複的標籤。合併會把來源標籤的作品關聯
          轉移到目標標籤並自動去重，來源標籤隨後刪除。
        </p>
      </header>

      <TagManagementTable initialTags={tags} />
    </div>
  );
}
