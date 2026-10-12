import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { NovelManageView } from '@/components/author/NovelManageView';
import { getAuthorNovelManage, getCategories, getAllTags } from '@/lib/repositories';
import { requireAuthor } from '@/lib/auth/guard';

/**
 * 作品管理頁（FR-012a）—— 卷、章節、排序、上下架與刪除的落點。
 *
 * 擁有者條件由 `getAuthorNovelManage(session.uid, novelId)` 在 `where` 裡強制：
 * 非擁有者與不存在都回 `null` → `notFound()` → **404 而非 403**（FR-004）。
 * 兩者刻意不可區分 —— 403 等於告訴對方「這個 id 是有效的，只是不是你的」。
 */
export async function generateMetadata(): Promise<Metadata> {
  await requireAuthor();
  return {
    title: '作品管理',
    description: '管理這部作品的資訊、分卷、章節順序與上架狀態。',
  };
}

/** `requireAuthor()` MUST 為第一個 await（見 author/dashboard/page.tsx 同名註解） */
export default async function AuthorNovelManagePage({
  params,
}: {
  params: Promise<{ novelId: string }>;
}) {
  const session = await requireAuthor();
  const { novelId } = await params;

  const novel = await getAuthorNovelManage(session.uid, novelId);
  if (!novel) notFound();

  const [categories, tags] = await Promise.all([getCategories(), getAllTags()]);

  return <NovelManageView novel={novel} categories={categories} tags={tags} />;
}
