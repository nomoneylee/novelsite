import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AccountSettingsView } from '@/components/profile/AccountSettingsView';
import { requireUser } from '@/lib/auth/guard';
import { usersRepo } from '@/lib/repositories';
import styles from '../page.module.css';

/** generateMetadata + requireUser()：見 author/dashboard/page.tsx 同名註解，FR-011 */
export async function generateMetadata(): Promise<Metadata> {
  await requireUser();
  return {
    title: '帳號設定',
    description: '管理你的個人資料與帳號偏好。',
  };
}

/** requireUser() MUST 為第一個 await（見 author/dashboard/page.tsx 同名註解，FR-011） */
export default async function AccountSettingsPage() {
  const session = await requireUser();

  /**
   * 表單的初始值自資料庫取，**不從 `SessionProvider` 拿**（FEAT-3 T089）：
   * 那份工作階段使用者是給全站導覽列用的，為了設定頁一個欄位把 500 字的簡介
   * 塞進每一頁的 flight payload 並不划算（見 `types.ts` 的 `UserProfile` 註解）。
   */
  const profile = await usersRepo.findProfile(session.uid);
  if (!profile) notFound();

  return (
    <div className={styles.page}>
      <header className={styles.page__header}>
        <h1 className={styles.page__title}>帳號設定</h1>
        <p className={styles.page__subtitle}>管理個人資料與偏好設定</p>
      </header>

      <AccountSettingsView profile={profile} />
    </div>
  );
}
