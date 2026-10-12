import type { Metadata } from 'next';
import { AuthorDashboardView } from '@/components/author/AuthorDashboardView';
import { getAuthorWorks } from '@/lib/repositories';
import { getAuthorDashboard } from '@/lib/services/statsService';
import { requireAuthor } from '@/lib/auth/guard';
import styles from './page.module.css';

/**
 * requireAuthor() MUST 為本函式第一個 await（層層授權檢查中最貼近資料的一道）—— Next.js 的
 * 巢狀路由段落會平行解析，layout 的轉址不保證能搶在本頁的資料擷取之前完成（實測：streaming
 * 下 layout 轉址與本頁內容會同時進入同一次回應）。故每個受保護頁面 MUST 各自於資料擷取前
 * 再次覆核，才能兌現 FR-011「回應本體 MUST NOT 含有受保護頁面的任何內容」。
 * metadata 改用 generateMetadata（而非靜態 export const metadata）同一理由：static metadata
 * 不受頁面元件的 redirect() 節制，靜態 title／description 仍會外洩（node_modules/next/dist/docs
 * 的 generateMetadata 參考確認 redirect() 在該函式內同樣可用）。
 */
export async function generateMetadata(): Promise<Metadata> {
  await requireAuthor();
  return {
    title: '數據儀表板',
    description: '掌握你在 NovelSite 上的作品瀏覽量、收藏量與評論趨勢。',
  };
}
/**
 * 作品資料的擁有者為**登入者本人**（FEAT-3 T093）。
 *
 * 先前指向 `DEMO_AUTHOR_ID`（FEAT-2 為了讓後台列表非空而暫用的內容作者）。
 * 本階段作者真的會有自己的作品，繼續沿用那個常數等於把**另一位作者的作品摘要**
 * 當成登入者自己的資料呈現 —— 那已經超出「示範統計」的範圍，是錯誤的資料歸屬。
 * 數字因而多半是 0，那是誠實的 0（FR-016）。
 *
 * **統計改讀真實資料**（FEAT-4 4-C / T107）：Server Component 直接呼叫服務層，
 * **不開 Route Handler** —— `AuthorDashboardView` 是純 props 的 client 元件、無期間切換器，
 * 另開一支 `GET /api/author/stats` 會是上線即死碼的端點
 * （contracts/analytics-scheduling-api.md §2；沿用導覽列未讀數的同一判準：
 * 沒有客戶端互動需求就不開端點）。
 */
export default async function AuthorDashboardPage() {
  const session = await requireAuthor();
  const [dashboard, novels] = await Promise.all([
    getAuthorDashboard(session.uid, { days: 14 }),
    getAuthorWorks(session.uid),
  ]);

  return (
    <div className={styles.page}>
      <header className={styles.page__header}>
        <h1 className={styles.page__title}>數據儀表板</h1>
        <p className={styles.page__subtitle}>近 14 天作品表現總覽</p>
      </header>

      <AuthorDashboardView
        summary={dashboard.summary}
        dailyStats={dashboard.daily}
        statsThroughDate={dashboard.statsThroughDate}
        novels={novels}
      />
    </div>
  );
}
