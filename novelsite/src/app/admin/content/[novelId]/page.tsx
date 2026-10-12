import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CaretLeft } from '@phosphor-icons/react/dist/ssr';
import { requireAdmin } from '@/lib/auth/guard';
import * as adminService from '@/lib/services/adminService';
import { ChapterManagementTable } from '@/components/admin/ChapterManagementTable';
import page from '@/components/admin/AdminPage.module.css';

interface AdminNovelDetailPageProps {
  params: Promise<{
    novelId: string;
  }>;
}

export default async function AdminNovelDetailPage({ params }: AdminNovelDetailPageProps) {
  await requireAdmin();
  const { novelId } = await params;

  const novel = await adminService.getNovelForAdmin(novelId);
  if (!novel) {
    notFound();
  }

  const chapters = await adminService.listChaptersForAdmin(novelId);

  return (
    <div className={page.page}>
      <header className={page.header}>
        <Link href="/admin/content" className={page.backLink}>
          <CaretLeft size={14} aria-hidden="true" />
          返回作品內容管理
        </Link>
        <h1 className={page.title}>作品審查：{novel.title}</h1>
        <p className={page.subtitle}>
          檢視各章節狀態、執行單章違規下架或恢復，或強制刪除章節。刪除會在同一交易內重算
          作品的章節數與總字數。
        </p>
      </header>

      <ChapterManagementTable
        initialChapters={chapters}
        novelTitle={novel.title}
        novelId={novelId}
      />
    </div>
  );
}
