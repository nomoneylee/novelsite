import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { getCategories, getCategoryCounts } from '@/lib/repositories';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: '分類總覽',
  description:
    '瀏覽 NovelSite 全部小說分類：玄幻、都市、言情、科幻、歷史、懸疑，一站探索你的興趣。',
  openGraph: {
    title: '分類總覽 | NovelSite',
    description: '瀏覽 NovelSite 全部小說分類，探索你感興趣的題材。',
    type: 'website',
  },
};

export default async function CategoriesPage() {
  const [categories, counts] = await Promise.all([getCategories(), getCategoryCounts()]);

  return (
    <>
      <SiteHeader />

      <main className={styles.page} id="categories-page">
        <div className={`container ${styles.page__inner}`}>
          <header className={styles.page__header}>
            <h1 className={styles.page__title}>分類總覽</h1>
            <p className={styles.page__subtitle}>選擇你喜愛的題材，探索對應的所有作品</p>
          </header>

          <div className={styles.grid}>
            {categories.map((cat) => (
              <Link
                key={cat.id}
                href={`/categories/${cat.id}`}
                className={styles.card}
                id={`category-card-${cat.id}`}
                style={
                  {
                    '--cat-color': cat.color,
                    '--cat-bg': cat.bgColor,
                  } as React.CSSProperties
                }
              >
                <span className={styles.card__emoji} aria-hidden="true">
                  {cat.emoji}
                </span>
                <span className={styles.card__label}>{cat.label}</span>
                <span className={styles.card__desc}>{cat.description}</span>
                <span className={styles.card__count}>{counts[cat.label] ?? 0} 部作品</span>
              </Link>
            ))}
          </div>
        </div>
      </main>

      <SiteFooter />
    </>
  );
}
