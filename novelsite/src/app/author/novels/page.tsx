import type { Metadata } from 'next';
import { AuthorWorkList } from '@/components/author/AuthorWorkList';
import { getAuthorWorks } from '@/lib/repositories';
import { requireAuthor } from '@/lib/auth/guard';
import styles from './page.module.css';

/** generateMetadata + requireAuthor()：見 author/dashboard/page.tsx 同名註解，FR-011 */
export async function generateMetadata(): Promise<Metadata> {
  await requireAuthor();
  return {
    title: '作品管理',
    description: '管理你在 NovelSite 上發表的所有作品，包含上架、草稿與連載狀態。',
  };
}

/**
 * `requireAuthor()` MUST 為第一個 await（見 author/dashboard/page.tsx 同名註解，FR-011）。
 *
 * 作品來源改為**登入者本人**（FEAT-3）：`DEMO_AUTHOR_ID` 是 FEAT-2 為了讓後台列表非空
 * 而暫置的常數，它的註解本來就寫著「真實 session→作者綁定屬 FEAT-3」。
 * 留著它的後果不是「列表看起來比較豐富」，而是**每個作者都看到同一個人的作品**。
 */
export default async function AuthorWorksPage() {
  const session = await requireAuthor();
  const novels = await getAuthorWorks(session.uid);

  return (
    <div className={styles.page}>
      <header className={styles.page__header}>
        <h1 className={styles.page__title}>作品管理</h1>
        <p className={styles.page__subtitle}>檢視並管理你的所有作品，掌握上架與草稿狀態</p>
      </header>

      <AuthorWorkList novels={novels} />
    </div>
  );
}
