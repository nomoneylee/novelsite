import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getNovelDetail, getNovelsByIds } from '@/lib/repositories';
import { getSession } from '@/lib/auth/guard';
import { getProgress } from '@/lib/services/readingService';
import { list as listReviews } from '@/lib/services/reviewService';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { NovelHero } from '@/components/novel/NovelHero';
import { NovelDescription } from '@/components/novel/NovelDescription';
import { ChapterList } from '@/components/novel/ChapterList';
import { ReviewSection } from '@/components/novel/ReviewSection';
import { RelatedNovels } from '@/components/novel/RelatedNovels';
import styles from './page.module.css';

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const novel = await getNovelDetail(id);

  if (!novel) {
    return {
      title: '找不到作品',
      description: '該作品不存在或已下架。',
    };
  }

  return {
    title: `${novel.title} — ${novel.author}`,
    description: novel.description.slice(0, 150),
    keywords: [novel.title, novel.author, novel.category, ...(novel.tags ?? [])],
    openGraph: {
      title: `${novel.title} | NovelSite`,
      description: novel.description.slice(0, 150),
      type: 'book',
    },
  };
}

/**
 * 本頁 MUST 為動態渲染（實測，2026-09-05）。
 *
 * **原本的 `generateStaticParams` 已移除並由本宣告取代**（原：FEAT-6 / T041 裁示，
 * 2026-08-15，以 try/catch 在建置期資料庫連不上時回空陣列）。
 *
 * **為什麼原文行不通**：容器建置期一定連不到資料庫（`deploy/deployment.md` §3.4），
 * 所以它在正式環境**永遠**回空陣列。而 `generateStaticParams` 一存在，本路由就被
 * 視為「靜態產生 + `dynamicParams: true`」——未列出的 id 會在**首次請求時以靜態產生
 * 的脈絡渲染**（見 Next 文件 `dynamicParams`）。本頁的 `getSession()` 會讀 cookie、
 * 版面又需要逐請求的 CSP nonce（`src/proxy.ts`），在該脈絡下呼叫動態 API 即擲出
 * `DynamicServerError`，實際症狀是**點進任何一部作品都 500**，而容器日誌只有
 * `digest: 'DYNAMIC_SERVER_USAGE'`，完全不會提到 `generateStaticParams`。
 *
 * 首頁沒有這個問題，正是因為它沒有 `generateStaticParams`：建置時實際渲染過一次，
 * Next 當場就把它判為動態頁。
 *
 * 這也與既有架構一致——`deploy/deployment.md` 已載明本站全站動態、靜態化與 ISR 停用。
 */
export const dynamic = 'force-dynamic';

export default async function NovelDetailPage({ params }: Props) {
  const { id } = await params;
  const novel = await getNovelDetail(id);

  if (!novel) notFound();

  // 取得相關作品（保持 relatedIds 順序）
  const relatedNovels = await getNovelsByIds(novel.relatedIds);

  // 續讀點（FR-011）：Server Component 直接經服務層取得，**不經**
  // `GET /api/reading-progress`（contracts/reader-state-api.md §2）。
  // 未登入者沒有續讀點，也不必為此打一次資料庫。
  const session = await getSession();
  const resume = session ? await getProgress(session.uid, novel.id) : null;

  // 評論**第一頁**由伺服器渲染（FR-023a、contracts/interaction-api.md §1）：
  // 首屏就有內容可讀，切換排序與載入更多才向端點取。
  // MUST NOT 一次載入該作品的全部評論 —— 作品越受歡迎頁面越慢，而那是最不該慢的頁。
  const reviews = await listReviews(novel.id, { sort: 'hot', limit: 20 }, session?.uid);

  return (
    <>
      <SiteHeader />

      <main className={styles.page} id="novel-detail-page">
        {/* Hero 區 */}
        <NovelHero novel={novel} resume={resume} />

        {/* 主體內容 */}
        <div className={`container ${styles.page__body}`}>
          {/* 左欄：簡介 + 章節 + 評論 */}
          <div className={styles.page__main}>
            <NovelDescription description={novel.description} />
            <ChapterList
              novelId={novel.id}
              volumes={novel.volumes}
              latestChapterId={novel.latestChapterId}
              firstChapterId={novel.firstChapterId}
            />
            <ReviewSection
              novelId={novel.id}
              initialItems={reviews.items}
              initialCursor={reviews.nextCursor}
              totalRating={novel.rating}
              totalCount={novel.ratingCount}
            />
          </div>

          {/* 右欄：相關推薦 */}
          <aside className={styles.page__sidebar}>
            <RelatedNovels novels={relatedNovels} />
          </aside>
        </div>
      </main>

      <SiteFooter />
    </>
  );
}
