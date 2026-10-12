import { AuthorSidebar } from '@/components/author/AuthorSidebar';
import { requireAuthor } from '@/lib/auth/guard';
import styles from './layout.module.css';

/** 第二道防線：以資料庫 User.role 覆核，角色不足即轉址（FR-013、FR-045） */
export default async function AuthorLayout({ children }: { children: React.ReactNode }) {
  await requireAuthor();

  return (
    <div className={styles.shell}>
      <AuthorSidebar />
      <main className={styles.content}>{children}</main>
    </div>
  );
}
