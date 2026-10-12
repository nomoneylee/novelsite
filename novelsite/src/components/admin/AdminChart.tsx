'use client';

import React, { useEffect, useState } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line, Bar } from 'react-chartjs-2';
import type { AdminDailyTrendPoint, AdminCategoryDistribution } from '@/lib/types';
import styles from './AdminChart.module.css';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Tooltip,
  Legend,
  Filler
);

/**
 * 圖表主題色（FEAT-9 UI 重構 2026-09-06）
 * ==========================================
 * **色值 MUST 由 CSS 變數讀出，MUST NOT 寫死 hex**。重構前四個序列色是寫死的
 * indigo／emerald／blue，站上三個主題（light／dark／eyecare）切換時圖表紋風不動，
 * 夜間模式那組色壓在深底上對比嚴重不足。
 *
 * Chart.js 吃的是具體色字串，不吃 `var(--x)`，故必須在瀏覽器端解析一次；
 * 主題切換是改 `<html data-theme>`，所以用 MutationObserver 盯那一個屬性重讀。
 */
interface VizColors {
  series1: string;
  series2: string;
  grid: string;
  text: string;
}

const FALLBACK: VizColors = {
  series1: '#d97706',
  series2: '#2563eb',
  grid: '#e8e0d4',
  text: '#78716c',
};

function readVizColors(): VizColors {
  const cs = getComputedStyle(document.documentElement);
  const pick = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    series1: pick('--viz-series-1', FALLBACK.series1),
    series2: pick('--viz-series-2', FALLBACK.series2),
    grid: pick('--color-border', FALLBACK.grid),
    text: pick('--color-subtle', FALLBACK.text),
  };
}

function useVizColors(): VizColors {
  // 伺服器端渲染時沒有 document，先給 light 的值，掛載後立刻校正
  const [colors, setColors] = useState<VizColors>(FALLBACK);

  useEffect(() => {
    const sync = () => setColors(readVizColors());
    sync();

    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, []);

  return colors;
}

/** 折線圖共用的座標軸樣式 */
function axisOptions(colors: VizColors, yTitle: string) {
  return {
    x: {
      grid: { display: false },
      ticks: { color: colors.text, maxRotation: 0, autoSkip: true },
      border: { color: colors.grid },
    },
    y: {
      beginAtZero: true,
      grid: { color: colors.grid },
      ticks: { color: colors.text, precision: 0 as const },
      border: { display: false },
      title: { display: true, text: yTitle, color: colors.text },
    },
  };
}

// ─────────────────────────────────────────────
// 營運趨勢
// ─────────────────────────────────────────────

interface TrendChartProps {
  trends7: AdminDailyTrendPoint[];
  trends30: AdminDailyTrendPoint[];
}

export function AdminTrendChart({ trends7, trends30 }: TrendChartProps) {
  const [days, setDays] = useState<7 | 30>(7);
  const colors = useVizColors();
  const points = days === 7 ? trends7 : trends30;
  const labels = points.map((d) => d.date.slice(5)); // MM-DD

  const totalViews = points.reduce((sum, d) => sum + d.views, 0);
  const totalNewUsers = points.reduce((sum, d) => sum + d.newUsers, 0);
  const hasData = totalViews > 0 || totalNewUsers > 0;

  /**
   * **兩個量體 MUST 拆成兩張圖，MUST NOT 共用一張圖的左右雙 Y 軸**。
   * 重構前是雙軸：閱讀量在左、新註冊在右，兩條線的交叉點純粹是兩個刻度縮放的巧合，
   * 讀者會把它讀成「那天註冊追上了瀏覽」。雙軸是資料視覺化的頭號錯誤。
   */
  const makeLine = (label: string, data: number[], color: string) => ({
    labels,
    datasets: [
      {
        label,
        data,
        borderColor: color,
        backgroundColor: color.startsWith('#') ? color + '22' : color,
        borderWidth: 2,
        pointRadius: points.length > 14 ? 0 : 3,
        pointHoverRadius: 5,
        tension: 0.3,
        fill: true,
      },
    ],
  });

  // 單一序列不需要圖例：標題已經指名它是什麼
  const baseOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { mode: 'index' as const, intersect: false },
    },
    interaction: { mode: 'index' as const, intersect: false },
  };

  return (
    <div className={styles.chartCard}>
      <div className={styles.chartHeader}>
        <h3 className={styles.chartTitle}>全站營運趨勢</h3>
        <div className={styles.buttonGroup} role="group" aria-label="趨勢統計區間">
          {([7, 30] as const).map((n) => (
            <button
              key={n}
              type="button"
              className={days === n ? styles.toggleBtn + ' ' + styles.activeBtn : styles.toggleBtn}
              aria-pressed={days === n}
              onClick={() => setDays(n)}
            >
              近 {n} 天
            </button>
          ))}
        </div>
      </div>

      {hasData ? (
        <>
          <p className="sr-only">
            近 {days} 天累計閱讀瀏覽 {totalViews} 次，新註冊使用者 {totalNewUsers} 位。
          </p>
          <div className={styles.chartBody}>
            <Line
              data={makeLine(
                '閱讀瀏覽量',
                points.map((d) => d.views),
                colors.series1
              )}
              options={{ ...baseOptions, scales: axisOptions(colors, '閱讀瀏覽量') }}
            />
          </div>
          <div className={styles.chartBody}>
            <Line
              data={makeLine(
                '新註冊使用者',
                points.map((d) => d.newUsers),
                colors.series2
              )}
              options={{ ...baseOptions, scales: axisOptions(colors, '新註冊使用者') }}
            />
          </div>
        </>
      ) : (
        <p className={styles.chartEmpty}>
          近 {days} 天尚無閱讀或註冊紀錄，等有資料後這裡會顯示每日趨勢。
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// 分類分佈
// ─────────────────────────────────────────────

interface CategoryChartProps {
  categories: AdminCategoryDistribution[];
}

export function AdminCategoryChart({ categories }: CategoryChartProps) {
  const colors = useVizColors();
  const hasData = categories.some((c) => c.ongoingNovels + c.completedNovels > 0);

  const chartData = {
    labels: categories.map((c) => c.name),
    datasets: [
      {
        label: '連載中',
        data: categories.map((c) => c.ongoingNovels),
        backgroundColor: colors.series1,
        borderRadius: 4,
      },
      {
        label: '已完結',
        data: categories.map((c) => c.completedNovels),
        backgroundColor: colors.series2,
        borderRadius: 4,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top' as const,
        align: 'end' as const,
        labels: { color: colors.text, boxWidth: 12, boxHeight: 12, usePointStyle: true },
      },
      tooltip: { mode: 'index' as const, intersect: false },
    },
    scales: {
      x: {
        stacked: true,
        grid: { display: false },
        ticks: { color: colors.text },
        border: { color: colors.grid },
      },
      y: {
        stacked: true,
        beginAtZero: true,
        grid: { color: colors.grid },
        ticks: { color: colors.text, precision: 0 as const },
        border: { display: false },
        title: { display: true, text: '作品數量', color: colors.text },
      },
    },
  };

  return (
    <div className={styles.chartCard}>
      <div className={styles.chartHeader}>
        <h3 className={styles.chartTitle}>分類生態分佈</h3>
      </div>

      {hasData ? (
        <>
          <p className="sr-only">
            各分類的作品數量：
            {categories
              .map((c) => `${c.name} 連載中 ${c.ongoingNovels} 部、已完結 ${c.completedNovels} 部`)
              .join('；')}
            。
          </p>
          <div className={styles.chartBody}>
            <Bar data={chartData} options={options} />
          </div>
        </>
      ) : (
        <p className={styles.chartEmpty}>尚無作品資料，等作者開始發佈後這裡會顯示分類分佈。</p>
      )}
    </div>
  );
}
