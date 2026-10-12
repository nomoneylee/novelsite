import type { Metadata } from 'next';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { HeroSection } from '@/components/home/HeroSection';
import { CategoryNav } from '@/components/home/CategoryNav';
import { NewBooksSection } from '@/components/home/NewBooksSection';
import { RankingWidget } from '@/components/home/RankingWidget';
import { getFeaturedNovels, getNewNovels, getCategories } from '@/lib/repositories';
import { getRanking } from '@/lib/services/rankingService';
import styles from './page.module.css';

/** 首頁排行區塊的顯示筆數 */
const HOME_RANKING_SIZE = 10;

export const metadata: Metadata = {
  title: 'NovelSite — 繁體中文原創文學平台',
  description:
    '沉浸式繁體中文原創文學閱讀平台，收錄玄幻、都市、言情、科幻、歷史、懸疑等海量優質小說，每日更新，提供最極致的閱讀體驗。',
  openGraph: {
    title: 'NovelSite — 繁體中文原創文學平台',
    description: '沉浸式繁體中文原創文學閱讀平台，海量優質小說，極致閱讀體驗。',
    type: 'website',
    locale: 'zh_TW',
    url: 'https://novelsite.tw',
    siteName: 'NovelSite',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'NovelSite — 繁體中文原創文學平台',
    description: '沉浸式繁體中文原創文學閱讀平台，海量優質小說，極致閱讀體驗。',
  },
};

export default async function HomePage() {
  const [featuredNovels, newNovels, weeklyRanking, categories] = await Promise.all([
    getFeaturedNovels(),
    getNewNovels(),
    getRanking('weekly'),
    getCategories(),
  ]);

  return (
    <>
      {/* 頂部導覽列 */}
      <SiteHeader />

      {/* Hero 輪播 */}
      <HeroSection novels={featuredNovels} />

      {/* 主要內容 */}
      <main id="main-content" className={styles.main}>
        {/* 分類快捷導航 */}
        <CategoryNav categories={categories} />

        {/* 新書推薦 + 排行榜 */}
        <div className={styles.content__layout}>
          <div className={styles.content__primary}>
            <NewBooksSection novels={newNovels} />
          </div>
          <div className={styles.content__sidebar}>
            <div className={styles.sidebar__sticky}>
              {/* 首頁只放前 10 名；完整榜單在 /ranking（榜單本身沒有筆數上限） */}
              <RankingWidget items={weeklyRanking.slice(0, HOME_RANKING_SIZE)} />
            </div>
          </div>
        </div>
      </main>

      {/* 頁尾 */}
      <SiteFooter />
    </>
  );
}
