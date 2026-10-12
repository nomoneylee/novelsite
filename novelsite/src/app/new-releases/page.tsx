import type { Metadata } from 'next';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { NovelCard } from '@/components/novel/NovelCard';
import { getNewNovels } from '@/lib/repositories';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: '新書上架',
  description: '掌握 NovelSite 最新上架的原創作品，依上架時間排序，第一時間追讀新故事。',
  openGraph: {
    title: '新書上架 | NovelSite',
    description: '掌握 NovelSite 最新上架的原創作品，第一時間追讀新故事。',
    type: 'website',
  },
};

export default async function NewReleasesPage() {
  const novels = await getNewNovels();

  return (
    <>
      <SiteHeader />

      <main className={styles.page} id="new-releases-page">
        <div className={`container ${styles.page__inner}`}>
          <header className={styles.page__header}>
            <h1 className={styles.page__title}>新書上架</h1>
            <p className={styles.page__subtitle}>依上架時間排序，搶先閱讀平台最新原創作品</p>
          </header>

          {novels.length === 0 ? (
            <p className={styles.empty}>目前尚無新書上架，敬請期待。</p>
          ) : (
            <div className={styles.grid}>
              {novels.map((novel) => (
                <NovelCard key={novel.id} novel={novel} />
              ))}
            </div>
          )}
        </div>
      </main>

      <SiteFooter />
    </>
  );
}
