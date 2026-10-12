import type { Metadata } from 'next';
import { NotificationCenter } from '@/components/profile/NotificationCenter';
import { getSessionUser, requireUser } from '@/lib/auth/guard';
import { list } from '@/lib/services/notificationService';
import { notificationListQuerySchema } from '@/lib/validation/notification';
import styles from '../page.module.css';

/** generateMetadata + requireUser()：見 author/dashboard/page.tsx 同名註解，FR-011 */
export async function generateMetadata(): Promise<Metadata> {
  await requireUser();
  return {
    title: '通知中心',
    description: '查看你收藏作品的更新通知。',
  };
}

/**
 * 通知中心（FEAT-4 4-D / T138）。
 *
 * 首屏由伺服器直接取數（與書架、閱讀歷史同形），`unread` 由查詢字串決定 ——
 * 做成客戶端狀態的話，「只看未讀」就無法被分享或於重新整理後保留。
 * 查詢字串 MUST 經共用驗證結構（FR-005）；非法值在此**回退為預設**而非 400 ——
 * 這是一個可被手改的網址，而頁面本身沒有任何輸入。
 *
 * `requireUser()` MUST 為第一個 await（見 author/dashboard/page.tsx 同名註解，FR-011）。
 */
export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();

  const raw = await searchParams;
  const parsed = notificationListQuerySchema.safeParse(
    typeof raw.unread === 'string' ? { unread: raw.unread } : {}
  );
  const unreadOnly = parsed.success ? parsed.data.unread : false;

  // 未讀數取自同一個工作階段查詢（版面已經取過一次，這裡是頁面自己的那一次）——
  // MUST NOT 另外呼叫 API 取數，那會讓「每頁至多一次計數」失效（FR-053a）
  const user = await getSessionUser();
  if (!user) return null;

  const page = await list(user.id, { unreadOnly, limit: 20 });

  return (
    <div className={styles.page}>
      <header className={styles.page__header}>
        <h1 className={styles.page__title}>通知中心</h1>
        <p className={styles.page__subtitle}>收藏作品的更新都會出現在這裡</p>
      </header>

      <NotificationCenter
        items={page.items}
        unreadOnly={unreadOnly}
        unreadCount={user.unreadCount}
      />
    </div>
  );
}
