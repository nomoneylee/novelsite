import type { Metadata } from 'next';
import { BookshelfView } from '@/components/profile/BookshelfView';
import { getAllNovels } from '@/lib/repositories';
import { requireUser } from '@/lib/auth/guard';
import styles from '../page.module.css';

/** generateMetadata + requireUser()：見 author/dashboard/page.tsx 同名註解，FR-011 */
export async function generateMetadata(): Promise<Metadata> {
  await requireUser();
  return {
    title: '我的書架',
    description: '查看你收藏的所有作品。',
  };
}

/** requireUser() MUST 為第一個 await（見 author/dashboard/page.tsx 同名註解，FR-011） */
export default async function BookshelfPage() {
  await requireUser();
  const allNovels = await getAllNovels();

  return (
    <div className={styles.page}>
      <header className={styles.page__header}>
        <h1 className={styles.page__title}>我的書架</h1>
        <p className={styles.page__subtitle}>你收藏的所有作品都在這裡</p>
      </header>

      <BookshelfView allNovels={allNovels} />
    </div>
  );
}
