import type { Metadata } from 'next';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { RankingPageView } from '@/components/ranking/RankingPageView';
import { getCategories } from '@/lib/repositories';
import { getRanking } from '@/lib/services/rankingService';
import { rankingQuerySchema } from '@/lib/validation/notification';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: '排行榜',
  description: '探索 NovelSite 熱門排行榜：週榜、月榜、總榜，以及各分類人氣作品一次掌握。',
  openGraph: {
    title: '排行榜 | NovelSite',
    description: '探索 NovelSite 熱門排行榜：週榜、月榜、總榜，以及各分類人氣作品一次掌握。',
    type: 'website',
  },
};

/**
 * 排行榜頁（FEAT-4 4-D / T141，FR-047）。
 *
 * 只讀**最近一次重算的結果**（`RankingEntry`），週期與分類為查詢字串。
 * 兩者 MUST 經共用驗證結構（FR-005），但**非法值回退預設而非擲錯** ——
 * 這是一個會被貼在聊天室裡的網址，`?period=weekley` 打錯字時，
 * 看到週榜比看到一頁 400 合理，而本頁本來就沒有任何使用者輸入。
 */
export default async function RankingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const parsed = rankingQuerySchema.safeParse({
    ...(typeof raw.period === 'string' ? { period: raw.period } : {}),
    ...(typeof raw.categoryId === 'string' ? { categoryId: raw.categoryId } : {}),
  });
  const { period, categoryId } = parsed.success
    ? parsed.data
    : { period: 'weekly' as const, categoryId: 'all' };

  const [items, categories] = await Promise.all([getRanking(period, categoryId), getCategories()]);

  return (
    <>
      <SiteHeader />

      <main className={styles.page} id="ranking-page">
        <div className={`container ${styles.page__inner}`}>
          <header className={styles.page__header}>
            <h1 className={styles.page__title}>排行榜</h1>
            <p className={styles.page__subtitle}>發掘讀者最愛，緊跟熱門作品脈動</p>
          </header>

          <RankingPageView
            items={items}
            categories={categories}
            period={period}
            categoryId={categoryId}
          />
        </div>
      </main>

      <SiteFooter />
    </>
  );
}
