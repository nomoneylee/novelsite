import type { Metadata } from 'next';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { NovelLibraryView } from '@/components/novel/NovelLibraryView';
import { getAllNovels, getCategories } from '@/lib/repositories';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: '書庫',
  description: '瀏覽 NovelSite 全站原創小說，依分類篩選、排序，探索你的下一部心頭好。',
  openGraph: {
    title: '書庫 | NovelSite',
    description: '瀏覽 NovelSite 全站原創小說，依分類篩選、排序，探索你的下一部心頭好。',
    type: 'website',
  },
};

export default async function NovelsPage() {
  const [novels, categories] = await Promise.all([getAllNovels(), getCategories()]);

  return (
    <>
      <SiteHeader />

      <main className={styles.page} id="novels-page">
        <div className={`container ${styles.page__inner}`}>
          <header className={styles.page__header}>
            <h1 className={styles.page__title}>書庫</h1>
            <p className={styles.page__subtitle}>
              探索全站原創作品，依分類與排序找到你的下一段故事
            </p>
          </header>

          <NovelLibraryView novels={novels} categories={categories} />
        </div>
      </main>

      <SiteFooter />
    </>
  );
}
