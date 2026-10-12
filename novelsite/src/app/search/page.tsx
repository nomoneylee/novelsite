import type { Metadata } from 'next';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { SearchView } from '@/components/search/SearchView';
import { getCategories } from '@/lib/repositories';
import { search } from '@/lib/services/searchService';
import styles from './page.module.css';

interface Props {
  searchParams: Promise<{ q?: string; category?: string }>;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { q } = await searchParams;
  const title = q ? `搜尋「${q}」` : '搜尋';

  return {
    title,
    description: 'NovelSite 全站搜尋：以書名、作者、標籤或分類快速找到你想讀的作品。',
  };
}

/**
 * 搜尋頁（FR-030a、FR-030b）。
 *
 * 首屏由本 Server Component 直接呼叫 `searchService`（**不經 HTTP**），
 * 與 `/api/search` 共用同一個服務，兩條路的空查詢短路與錯誤語意因而完全一致。
 *
 * **網址只有 `q` 與 `category`，沒有 `cursor`**：游標只存在於用戶端「載入更多」的
 * fetch 裡。這使「變更分類後回到第一頁」成為結構上的必然，而不是某段程式碼記得要做的事。
 */
export default async function SearchPage({ searchParams }: Props) {
  const { q = '', category = '' } = await searchParams;
  const query = q.trim();

  const [page, categories] = await Promise.all([
    search({ q: query, ...(category ? { category } : {}) }),
    getCategories(),
  ]);

  return (
    <>
      <SiteHeader />

      <main className={styles.page} id="search-page">
        <div className={`container ${styles.page__inner}`}>
          <header className={styles.page__header}>
            <h1 className={styles.page__title}>搜尋作品</h1>
          </header>

          {/*
            key 綁定關鍵字與分類：任一變動即整個重新掛載，已累積的頁面與游標
            必然歸零（FR-030b）。靠各處記得清狀態的作法，遲早會漏掉一處，
            而漏掉的症狀是「換了分類卻停在上一組條件的第三頁」。
          */}
          <SearchView
            key={`${query}|${category}`}
            query={query}
            category={category}
            categories={categories}
            initialItems={page.items}
            initialCursor={page.nextCursor}
          />
        </div>
      </main>

      <SiteFooter />
    </>
  );
}
