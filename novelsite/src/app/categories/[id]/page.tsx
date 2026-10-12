import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { CaretLeft } from '@phosphor-icons/react/dist/ssr';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { CategoryNovelGrid } from '@/components/novel/CategoryNovelGrid';
import { getCategoryById, getNovelsByCategory } from '@/lib/repositories';
import styles from './page.module.css';

interface Props {
  params: Promise<{ id: string }>;
}

/**
 * 本頁 MUST 為動態渲染——理由與作法同 `src/app/novels/[id]/page.tsx`
 * （實測，2026-09-05；取代原本的 `generateStaticParams`，FEAT-6 / T041 裁示，2026-08-15）。
 *
 * 摘要：容器建置期連不到資料庫，該函式在正式環境永遠回空陣列，於是本路由被當成
 * 「靜態產生 + `dynamicParams: true`」、在首次請求時以靜態脈絡渲染；版面需要逐請求的
 * CSP nonce，於是每個分類頁都 500，日誌只有 `digest: 'DYNAMIC_SERVER_USAGE'`。
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const category = await getCategoryById(id);

  if (!category) {
    return { title: '找不到分類', description: '該分類不存在。' };
  }

  return {
    title: `${category.label}小說`,
    description: `瀏覽 NovelSite「${category.label}」分類的所有作品：${category.description}。`,
    openGraph: {
      title: `${category.label}小說 | NovelSite`,
      description: `瀏覽「${category.label}」分類的所有作品。`,
      type: 'website',
    },
  };
}

export default async function CategoryDetailPage({ params }: Props) {
  const { id } = await params;
  const category = await getCategoryById(id);
  if (!category) notFound();

  const novels = await getNovelsByCategory(category.label);

  return (
    <>
      <SiteHeader />

      <main className={styles.page} id="category-detail-page">
        {/* 分類 Hero */}
        <section
          className={styles.hero}
          style={
            {
              '--cat-color': category.color,
              '--cat-bg': category.bgColor,
            } as React.CSSProperties
          }
        >
          <div className={`container ${styles.hero__inner}`}>
            <Link href="/categories" className={styles.backLink}>
              <CaretLeft size={16} weight="bold" />
              分類總覽
            </Link>
            <div className={styles.hero__main}>
              <span className={styles.hero__emoji} aria-hidden="true">
                {category.emoji}
              </span>
              <div>
                <h1 className={styles.hero__title}>{category.label}</h1>
                <p className={styles.hero__desc}>{category.description}</p>
              </div>
            </div>
          </div>
        </section>

        <div className={`container ${styles.page__body}`}>
          <CategoryNovelGrid novels={novels} />
        </div>
      </main>

      <SiteFooter />
    </>
  );
}
