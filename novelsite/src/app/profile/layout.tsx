import { ProfileSidebar } from '@/components/profile/ProfileSidebar';
import { requireUser } from '@/lib/auth/guard';
import styles from './layout.module.css';

/** 第二道防線：伺服器端驗證登入狀態，未登入即轉址（FR-013、FR-014） */
export default async function ProfileLayout({ children }: { children: React.ReactNode }) {
  await requireUser();

  return (
    <div className={styles.shell}>
      <ProfileSidebar />
      <main className={styles.content}>{children}</main>
    </div>
  );
}
