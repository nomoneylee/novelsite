import React from 'react';
import { Users, BookOpen, TextAa, Eye, Warning } from '@phosphor-icons/react/dist/ssr';
import { requireAdmin } from '@/lib/auth/guard';
import * as adminStatsService from '@/lib/services/adminStatsService';
import { AdminTrendChart, AdminCategoryChart } from '@/components/admin/AdminChart';
import page from '@/components/admin/AdminPage.module.css';
import styles from '@/components/admin/AdminDashboard.module.css';

export const metadata = {
  title: '儀表板總覽 | 管理中心',
};

/** 字數在萬以上改用「萬字」，否則四位數以上的原始值在卡片裡讀不出量級 */
function formatWords(total: number): string {
  return total >= 10000 ? `${(total / 10000).toFixed(1)} 萬字` : `${total.toLocaleString()} 字`;
}

export default async function AdminDashboardPage() {
  await requireAdmin();

  const [stats, trends7, trends30, categories] = await Promise.all([
    adminStatsService.getSiteOverview(),
    adminStatsService.getDailyTrends(7),
    adminStatsService.getDailyTrends(30),
    adminStatsService.getCategoryDistribution(),
  ]);

  const hasSuspended = stats.novels.adminSuspended > 0;

  return (
    <div className={page.page}>
      <header className={page.header}>
        <h1 className={page.title}>營運儀表板總覽</h1>
        <p className={page.subtitle}>
          全站關鍵營運指標、近 7／30 天讀者活躍趨勢與小說分類生態分佈。
        </p>
      </header>

      <section className={page.section} aria-labelledby="metrics-heading">
        <h2 id="metrics-heading" className={page.sectionTitle}>
          關鍵指標
        </h2>

        <div className={styles.metricsGrid}>
          <article className={styles.metricCard}>
            <h3 className={styles.metricLabel}>
              <span className={styles.metricIcon} aria-hidden="true">
                <Users size={16} weight="fill" />
              </span>
              全站總使用者
            </h3>
            <p className={styles.metricValue}>{stats.users.total.toLocaleString()}</p>
            <ul className={styles.metricBreakdown}>
              <li>讀者 {stats.users.readers}</li>
              <li>作者 {stats.users.authors}</li>
              <li className={stats.users.suspended > 0 ? styles.alert : undefined}>
                停權 {stats.users.suspended}
              </li>
            </ul>
          </article>

          <article className={styles.metricCard}>
            <h3 className={styles.metricLabel}>
              <span className={styles.metricIcon} aria-hidden="true">
                <BookOpen size={16} weight="fill" />
              </span>
              作品總數
            </h3>
            <p className={styles.metricValue}>{stats.novels.total.toLocaleString()}</p>
            <ul className={styles.metricBreakdown}>
              <li>已發佈 {stats.novels.published}</li>
              <li>草稿 {stats.novels.draft}</li>
              <li className={hasSuspended ? styles.alert : undefined}>
                {hasSuspended && <Warning size={12} weight="fill" aria-hidden="true" />} 違規下架{' '}
                {stats.novels.adminSuspended}
              </li>
            </ul>
          </article>

          <article className={styles.metricCard}>
            <h3 className={styles.metricLabel}>
              <span className={styles.metricIcon} aria-hidden="true">
                <TextAa size={16} weight="fill" />
              </span>
              累積總字數
            </h3>
            <p className={styles.metricValue}>{formatWords(stats.chapters.totalWords)}</p>
            <ul className={styles.metricBreakdown}>
              <li>收錄章節 {stats.chapters.total.toLocaleString()} 章</li>
            </ul>
          </article>

          <article className={styles.metricCard}>
            <h3 className={styles.metricLabel}>
              <span className={styles.metricIcon} aria-hidden="true">
                <Eye size={16} weight="fill" />
              </span>
              閱讀總瀏覽
            </h3>
            <p className={styles.metricValue}>{stats.views.total.toLocaleString()}</p>
            <ul className={styles.metricBreakdown}>
              <li>去重計算，每人每章每日一次</li>
            </ul>
          </article>
        </div>
      </section>

      <section className={page.section} aria-labelledby="charts-heading">
        <h2 id="charts-heading" className={page.sectionTitle}>
          趨勢與分佈
        </h2>
        <div className={styles.chartsGrid}>
          <AdminTrendChart trends7={trends7} trends30={trends30} />
          <AdminCategoryChart categories={categories} />
        </div>
      </section>
    </div>
  );
}
