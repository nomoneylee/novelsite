'use client';

import { useId, useMemo } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Tooltip,
  Filler,
} from 'chart.js';
import { Line, Bar } from 'react-chartjs-2';
import { Eye, Heart, ChatCircle, BookOpen } from '@phosphor-icons/react';
import type { AuthorWorkSummary, AuthorSummary, DailyStat } from '@/lib/types';
import styles from './AuthorDashboardView.module.css';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Tooltip,
  Filler
);

function formatNumber(n: number): string {
  if (n >= 100000000) return `${(n / 100000000).toFixed(1)}億`;
  if (n >= 10000) return `${(n / 10000).toFixed(1)}萬`;
  return n.toLocaleString('zh-TW');
}

function formatDateLabel(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${m}/${d}`;
}

interface AuthorDashboardViewProps {
  summary: AuthorSummary;
  dailyStats: DailyStat[];
  /** 統計截止日（台北昨日，`YYYY-MM-DD`）；MUST 明確標示，見下方說明 */
  statsThroughDate: string;
  novels: AuthorWorkSummary[];
}

export function AuthorDashboardView({
  summary,
  dailyStats,
  statsThroughDate,
  novels,
}: AuthorDashboardViewProps) {
  const throughNoteId = useId();
  const labels = useMemo(() => dailyStats.map((s) => formatDateLabel(s.date)), [dailyStats]);

  /**
   * 空狀態的判定（FR-043b 第 4 項）。
   *
   * 圖表元件在資料全為 0 時畫得出來，但畫出來的是一條貼著底的直線 ——
   * 看起來像「已接上資料且真的沒人看」與「壞掉了」的疊加。
   * 示範資料環境下全站計數為 0（FR-043a），故這是**主要路徑**而非邊角情境。
   */
  const hasDailyData = useMemo(
    () => dailyStats.some((s) => s.views > 0 || s.favorites > 0 || s.comments > 0),
    [dailyStats]
  );
  const hasNovelViews = useMemo(() => novels.some((n) => n.totalViews > 0), [novels]);

  const lineData = useMemo(
    () => ({
      labels,
      datasets: [
        {
          label: '瀏覽量',
          data: dailyStats.map((s) => s.views),
          borderColor: '#d97706',
          backgroundColor: 'rgba(217, 119, 6, 0.12)',
          fill: true,
          tension: 0.35,
          pointRadius: 0,
          pointHoverRadius: 4,
        },
      ],
    }),
    [labels, dailyStats]
  );

  const barData = useMemo(
    () => ({
      labels: novels.map((n) => n.title),
      datasets: [
        {
          label: '總瀏覽量',
          data: novels.map((n) => n.totalViews),
          backgroundColor: '#92400e',
          borderRadius: 6,
          maxBarThickness: 36,
        },
      ],
    }),
    [novels]
  );

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { grid: { display: false }, ticks: { font: { size: 11 } } },
      y: {
        grid: { color: 'rgba(120, 113, 108, 0.12)' },
        ticks: {
          font: { size: 11 },
          callback: (value: string | number) => formatNumber(Number(value)),
        },
      },
    },
  };

  return (
    <div className={styles.view}>
      {/*
        統計截止日（FEAT-4 4-C / T108）。每日彙總**只處理已結束的日期**（FR-036b），
        故曲線的最後一點恆為昨日。不寫出這一句，作者每天都會看到「今天是 0」而以為壞了。
        今日的收藏、留言與評分不受此限 —— 那三個由寫入路徑即時維護（FR-038a）。
      */}
      <p id={throughNoteId} className={styles.throughNote}>
        瀏覽趨勢統計至 {statsThroughDate}（每日彙總只處理已結束的日期，今日資料明日呈現）；
        收藏、留言與評分為即時數字
      </p>

      {/* 統計卡片 */}
      <div className={styles.stats} aria-describedby={throughNoteId}>
        <StatCard
          icon={<Eye size={20} />}
          label="總瀏覽量"
          value={formatNumber(summary.totalViews)}
        />
        <StatCard
          icon={<Heart size={20} />}
          label="總收藏量"
          value={formatNumber(summary.totalFavorites)}
        />
        <StatCard
          icon={<ChatCircle size={20} />}
          label="總留言數"
          value={formatNumber(summary.totalComments)}
        />
        <StatCard
          icon={<BookOpen size={20} />}
          label="作品數"
          value={summary.totalNovels.toString()}
        />
      </div>

      {/* 折線圖：近 14 天瀏覽趨勢 */}
      <section className={styles.chartCard} aria-describedby={throughNoteId}>
        <h2 className={styles.chartCard__title}>近 14 天瀏覽趨勢</h2>
        <div className={styles.chartCard__body}>
          {hasDailyData ? (
            <Line data={lineData} options={chartOptions} aria-label="近 14 天瀏覽趨勢折線圖" />
          ) : (
            <p className={styles.empty}>
              尚無資料。讀者開始閱讀後，這裡會顯示近 14 天的每日瀏覽趨勢。
            </p>
          )}
        </div>
      </section>

      {/* 柱狀圖：各作品瀏覽量比較 */}
      <section className={styles.chartCard} aria-describedby={throughNoteId}>
        <h2 className={styles.chartCard__title}>各作品瀏覽量比較</h2>
        <div className={styles.chartCard__body}>
          {hasNovelViews ? (
            <Bar data={barData} options={chartOptions} aria-label="各作品瀏覽量比較柱狀圖" />
          ) : (
            <p className={styles.empty}>
              {novels.length === 0
                ? '你還沒有作品。建立第一部作品後，這裡會顯示它的瀏覽量。'
                : '尚無資料。作品有人閱讀後，這裡會顯示各作品的瀏覽量比較。'}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className={styles.statCard}>
      <span className={styles.statCard__icon}>{icon}</span>
      <div>
        <p className={styles.statCard__value}>{value}</p>
        <p className={styles.statCard__label}>{label}</p>
      </div>
    </div>
  );
}
