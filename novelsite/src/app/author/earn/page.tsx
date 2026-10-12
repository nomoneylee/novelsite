import type { Metadata } from 'next';
import { Eye, Heart, TextAa, BookOpen } from '@phosphor-icons/react/dist/ssr';
import { getAuthorSummary, getAuthorWorks } from '@/lib/repositories';
import { getNovelPerformance, type PerformanceMetrics } from '@/lib/services/statsService';
import { requireAuthor } from '@/lib/auth/guard';
import styles from '../dashboard/page.module.css';
import earn from './page.module.css';

const PERIOD_NOTE_ID = 'earn-period-note';

/** generateMetadata + requireAuthor()：見 author/dashboard/page.tsx 同名註解，FR-011 */
export async function generateMetadata(): Promise<Metadata> {
  await requireAuthor();
  return {
    title: '作品成效',
    description: '檢視你在 NovelSite 的作品成效：曝光、收藏與累積字數一覽。',
  };
}

const NUM = (n: number) => n.toLocaleString('en-US');

/**
 * 比率的呈現（FR-043b 第 5 項）。
 *
 * `null` 是**分母為 0**（近 7 日沒有任何讀者）的專屬值，MUST 顯示「尚無資料」而非 `0%`：
 * `0%` 說的是「來的人都沒讀完」，而事實是「沒有人來過」，兩者對作者的意義完全相反。
 */
const RATE = (value: number | null) => (value === null ? null : `${(value * 100).toFixed(1)}%`);

/**
 * requireAuthor() MUST 為第一個 await（見 author/dashboard/page.tsx 同名註解，FR-011）。
 * 資料歸屬改為登入者本人（FEAT-3 T093，理由見 dashboard 頁的同名註解）。
 *
 * **四項指標改讀真實明細**（FEAT-4 4-C / T109）：期間統一近 7 日，
 * 由 `ChapterView` 逐筆算出，**MUST NOT 改讀 `NovelDailyStat`**（FR-042a）——
 * 完讀率與收藏轉換的分母是不重複讀者數，而每日統計沒有讀者身分維度。
 */
export default async function AuthorEarnPage() {
  const session = await requireAuthor();
  const [summary, novels] = await Promise.all([
    getAuthorSummary(session.uid),
    getAuthorWorks(session.uid),
  ]);

  // 逐部取成效。作者的作品數是個位數量級，且每一部的指標各自有自己的分母，
  // 無法由一次查詢共用（分母是「不重複讀者數」，跨作品相加沒有意義）
  const metricsByNovel = new Map<string, PerformanceMetrics | null>(
    await Promise.all(
      novels.map(async (n) => [n.id, await getNovelPerformance(session.uid, n.id)] as const)
    )
  );

  const totalWordCount = novels.reduce((acc, n) => acc + n.wordCount, 0);

  const stats = [
    { icon: Eye, label: '累計曝光', value: NUM(summary.totalViews), accent: true },
    { icon: Heart, label: '累計收藏', value: NUM(summary.totalFavorites) },
    { icon: TextAa, label: '累計字數', value: NUM(totalWordCount) },
    { icon: BookOpen, label: '作品數', value: NUM(summary.totalNovels) },
  ];

  // 各作品成效拆分（依近 7 日曝光高低排序）
  const perNovel = novels
    .map((n) => ({
      id: n.id,
      title: n.title,
      coverColor: n.coverColor,
      wordCount: n.wordCount,
      metrics: metricsByNovel.get(n.id) ?? null,
    }))
    .sort((a, b) => (b.metrics?.impressions ?? 0) - (a.metrics?.impressions ?? 0));

  return (
    <div className={styles.page}>
      <header className={styles.page__header}>
        <h1 className={styles.page__title}>作品成效</h1>
        <p className={styles.page__subtitle}>以下為各作品的閱讀表現，協助你了解讀者的實際反應</p>
      </header>

      {/*
        期間標示（FEAT-4 4-C / T109）。上方四張卡為**累計值**、下方拆分為**近 7 日**，
        兩者的期間不同是刻意的（累計曝光要看得出作品的一生，成效要看得出最近的反應）；
        不寫出來的話，同一頁上兩個「曝光」對不起來時沒有人說得出哪一個是錯的。
      */}
      <p id={PERIOD_NOTE_ID} className={earn.periodNote}>
        以下四張卡為累計值；各作品成效拆分的四項指標計算期間為「近 7 日」，由閱讀明細逐筆算出
      </p>

      <section className={earn.stats} aria-describedby={PERIOD_NOTE_ID}>
        {stats.map(({ icon: Icon, label, value, accent }) => (
          <div key={label} className={`${earn.stat} ${accent ? earn['stat--accent'] : ''}`}>
            <span className={earn.stat__icon} aria-hidden="true">
              <Icon size={22} weight="fill" />
            </span>
            <span className={earn.stat__value}>{value}</span>
            <span className={earn.stat__label}>{label}</span>
          </div>
        ))}
      </section>

      <section className={earn.breakdown} aria-describedby={PERIOD_NOTE_ID}>
        <h2 className={earn.breakdown__title}>各作品成效拆分（近 7 日）</h2>
        {perNovel.length === 0 ? (
          // 資料歸屬改為登入者本人之後，還沒有作品的作者會走到這裡。
          // 一個標題底下空無一物，看起來像載入失敗而不是「你還沒有作品」
          <p className={earn.disclaimer}>你還沒有作品。建立第一部作品後，這裡會顯示它的成效。</p>
        ) : (
          <ul className={earn.breakdown__list}>
            {perNovel.map((n) => (
              <li key={n.id} className={earn.row}>
                <span
                  className={earn.row__cover}
                  style={{ background: n.coverColor }}
                  aria-hidden="true"
                >
                  {n.title.charAt(0)}
                </span>
                <span className={earn.row__title}>
                  {n.title}
                  <span className={earn.row__empty}>・{NUM(n.wordCount)} 字</span>
                </span>
                <NovelMetrics metrics={n.metrics} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * 一列作品的四項指標。
 *
 * 四項各自獨立呈現「尚無資料」：曝光與留言熱度是計數（0 就是 0，那是誠實的），
 * 完讀率與收藏轉換是比率（分母為 0 時沒有值可言）。
 * 把四項綁在一起用同一個空狀態，會讓「有 3 次曝光但沒人讀完」變成整列消失。
 */
function NovelMetrics({ metrics }: { metrics: PerformanceMetrics | null }) {
  if (!metrics) {
    return <span className={earn.row__empty}>尚無資料</span>;
  }

  const completion = RATE(metrics.completionRate);
  const conversion = RATE(metrics.favoriteConversion);

  return (
    <span className={earn.row__metric}>
      曝光 {NUM(metrics.impressions)}・讀者 {NUM(metrics.distinctViewers)}・完讀率{' '}
      {completion ?? <span className={earn.row__empty}>尚無資料</span>}・收藏轉換{' '}
      {conversion ?? <span className={earn.row__empty}>尚無資料</span>}・留言熱度{' '}
      {NUM(metrics.commentHeat)}
    </span>
  );
}
