import type { Metadata } from 'next';
import { CreateNovelForm } from '@/components/author/CreateNovelForm';
import { getCategories } from '@/lib/repositories';
import { requireAuthor } from '@/lib/auth/guard';
import styles from '../dashboard/page.module.css';

/** generateMetadata + requireAuthor()：見 author/dashboard/page.tsx 同名註解，FR-011 */
export async function generateMetadata(): Promise<Metadata> {
  await requireAuthor();
  return {
    title: '開始創作',
    description: '在 NovelSite 建立你的新作品，填寫作品名稱、分類與簡介，開啟創作之旅。',
  };
}

/** requireAuthor() MUST 為第一個 await（見 author/dashboard/page.tsx 同名註解，FR-011） */
export default async function AuthorCreatePage() {
  await requireAuthor();
  const categories = await getCategories();

  return (
    <div className={styles.page}>
      <header className={styles.page__header}>
        <h1 className={styles.page__title}>開始創作</h1>
        <p className={styles.page__subtitle}>填寫基本資訊，建立你的新作品草稿</p>
      </header>

      <CreateNovelForm categories={categories} />
    </div>
  );
}
