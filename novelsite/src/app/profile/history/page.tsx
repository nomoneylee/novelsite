import type { Metadata } from 'next';
import { ReadingHistoryView } from '@/components/profile/ReadingHistoryView';
import { requireUser } from '@/lib/auth/guard';
import styles from '../page.module.css';

/** generateMetadata + requireUser()：見 author/dashboard/page.tsx 同名註解，FR-011 */
export async function generateMetadata(): Promise<Metadata> {
  await requireUser();
  return {
    title: '閱讀歷史',
    description: '查看你最近閱讀過的章節紀錄。',
  };
}

/** requireUser() MUST 為第一個 await（見 author/dashboard/page.tsx 同名註解，FR-011） */
export default async function ReadingHistoryPage() {
  await requireUser();
  return (
    <div className={styles.page}>
      <header className={styles.page__header}>
        <h1 className={styles.page__title}>閱讀歷史</h1>
        <p className={styles.page__subtitle}>最近閱讀的章節，依時間排序</p>
      </header>

      <ReadingHistoryView />
    </div>
  );
}
