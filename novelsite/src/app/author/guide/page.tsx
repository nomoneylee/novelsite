import type { Metadata } from 'next';
import Link from 'next/link';
import {
  PlusCircle,
  PencilSimpleLine,
  RocketLaunch,
  ChartLineUp,
} from '@phosphor-icons/react/dist/ssr';
import { requireAuthor } from '@/lib/auth/guard';
import styles from '../dashboard/page.module.css';
import guide from './page.module.css';

/** generateMetadata + requireAuthor()：見 author/dashboard/page.tsx 同名註解，FR-011 */
export async function generateMetadata(): Promise<Metadata> {
  await requireAuthor();
  return {
    title: '創作指南',
    description: '從建立作品到發佈章節，NovelSite 創作指南帶你快速上手，寫出你的第一部作品。',
  };
}

const STEPS = [
  {
    icon: PlusCircle,
    title: '一、建立作品',
    body: '於「開始創作」填寫作品名稱、選擇分類並撰寫簡介，系統會為你建立一份作品草稿。好的簡介能在讀者滑動時抓住目光。',
  },
  {
    icon: PencilSimpleLine,
    title: '二、撰寫章節',
    body: '進入「章節編輯器」，支援 Markdown 語法與即時預覽。建議每章 2,000～3,000 字，並善用分段維持中文閱讀節奏。',
  },
  {
    icon: RocketLaunch,
    title: '三、發佈上架',
    body: '章節完成後可先存為草稿，確認無誤再發佈。穩定的更新頻率（例如每日更新）能有效累積讀者黏著度。',
  },
  {
    icon: ChartLineUp,
    title: '四、經營數據',
    body: '在「數據儀表板」追蹤瀏覽量、收藏與評論趨勢，了解讀者喜好，持續優化你的故事節奏與主題。',
  },
];

const TIPS = [
  '前三章是黃金決勝點：盡早拋出鉤子與衝突，讓讀者有追下去的理由。',
  '維持一致的更新節奏，比偶爾爆更更能養成讀者的閱讀習慣。',
  '善用分類與標籤，讓對的讀者更容易找到你的作品。',
  '回覆讀者留言能建立社群感，也是靈感的重要來源。',
];

/** requireAuthor() MUST 為第一個 await（見 author/dashboard/page.tsx 同名註解，FR-011） */
export default async function AuthorGuidePage() {
  await requireAuthor();
  return (
    <div className={styles.page}>
      <header className={styles.page__header}>
        <h1 className={styles.page__title}>創作指南</h1>
        <p className={styles.page__subtitle}>四個步驟，帶你在 NovelSite 寫出第一部作品</p>
      </header>

      <section className={guide.steps}>
        {STEPS.map(({ icon: Icon, title, body }) => (
          <article key={title} className={guide.step}>
            <span className={guide.step__icon} aria-hidden="true">
              <Icon size={24} weight="fill" />
            </span>
            <div>
              <h2 className={guide.step__title}>{title}</h2>
              <p className={guide.step__body}>{body}</p>
            </div>
          </article>
        ))}
      </section>

      <section className={guide.tips}>
        <h2 className={guide.tips__title}>寫作小技巧</h2>
        <ul className={guide.tips__list}>
          {TIPS.map((tip) => (
            <li key={tip} className={guide.tips__item}>
              {tip}
            </li>
          ))}
        </ul>
      </section>

      <div className={guide.cta}>
        <Link href="/author/create" className={guide.cta__btn}>
          <PlusCircle size={18} weight="fill" />
          立即開始創作
        </Link>
      </div>
    </div>
  );
}
