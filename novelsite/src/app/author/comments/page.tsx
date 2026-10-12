import type { Metadata } from 'next';
import { AuthorCommentList } from '@/components/author/AuthorCommentList';
import { requireAuthor } from '@/lib/auth/guard';
import styles from './page.module.css';

/** generateMetadata + requireAuthor()：見 author/dashboard/page.tsx 同名註解，FR-011 */
export async function generateMetadata(): Promise<Metadata> {
  await requireAuthor();
  return {
    title: '留言管理',
    description: '檢視自己作品下的讀者留言，必要時將個別留言隱藏。',
  };
}

/**
 * 作者的留言管理頁（FEAT-4 4-B / T080）。
 *
 * `requireAuthor()` MUST 為第一個 await（見 author/dashboard/page.tsx 同名註解，FR-011）。
 * 清單本身由 `AuthorCommentList` 向 `GET /api/author/comments` 取 —— 該端點的
 * `novel.authorId` 由**資料層強制帶入**，即使頁面層漏了守衛，也查不到他人作品下的留言。
 */
export default async function AuthorCommentsPage() {
  await requireAuthor();

  return (
    <div className={styles.page}>
      <header className={styles.page__header}>
        <h1 className={styles.page__title}>留言管理</h1>
        <p className={styles.page__subtitle}>
          你可以隱藏不適當的留言。隱藏後讀者端（含留言者本人）都不再顯示，但留言內容不會被更動。
        </p>
      </header>

      <AuthorCommentList />
    </div>
  );
}
