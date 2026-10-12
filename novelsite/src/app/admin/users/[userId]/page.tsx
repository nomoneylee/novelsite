import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CaretLeft } from '@phosphor-icons/react/dist/ssr';
import { requireAdmin } from '@/lib/auth/guard';
import * as adminService from '@/lib/services/adminService';
import { Badge } from '@/components/ui/Badge';
import page from '@/components/admin/AdminPage.module.css';
import table from '@/components/admin/AdminDataTable.module.css';

/**
 * 使用者管理詳情頁（FEAT-9 / 009-admin-dashboard，US2）。
 *
 * 只讀不寫：停權、復權、改角色、重設密碼一律留在列表頁的 `UserManagementTable`。
 * 兩處都放一份確認對話框等於同一條破壞性流程有兩套防呆要維護，而它們遲早會分岔。
 */

const ROLE_LABEL: Record<string, string> = {
  admin: '管理員',
  author: '作者',
  reader: '讀者',
};

const ROLE_VARIANT: Record<string, 'info' | 'success' | 'warning'> = {
  admin: 'warning',
  author: 'success',
  reader: 'info',
};

interface AdminUserDetailPageProps {
  params: Promise<{ userId: string }>;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
}

export default async function AdminUserDetailPage({ params }: AdminUserDetailPageProps) {
  await requireAdmin();
  const { userId } = await params;

  const user = await adminService.getUserForAdmin(userId);
  if (!user) {
    notFound();
  }

  // `targetType` 為 'User'（大寫）—— 與 adminService 寫入稽核紀錄時的值逐字一致，
  // 寫成小寫會查到空清單而看不出是查錯了
  const { items: auditLogs, totalCount: auditTotal } = await adminService.listAuditLogs({
    targetType: 'User',
    targetId: userId,
    limit: 20,
  });

  return (
    <div className={page.page}>
      <header className={page.header}>
        <Link href="/admin/users" className={page.backLink}>
          <CaretLeft size={14} aria-hidden="true" />
          返回使用者管理
        </Link>
        <h1 className={page.title}>使用者詳情：{user.name}</h1>
        <p className={page.subtitle}>
          檢視此帳號的基本資料、內容產出量與歷來管理處置紀錄。處置操作請回列表頁執行。
        </p>
      </header>

      <section className={page.section} aria-labelledby="user-profile-heading">
        <h2 id="user-profile-heading" className={page.sectionTitle}>
          基本資料
        </h2>

        <div className={page.card}>
          <dl className={page.definitionList}>
            <dt className={page.definitionTerm}>Email</dt>
            <dd className={page.definitionValue}>{user.email}</dd>

            <dt className={page.definitionTerm}>筆名</dt>
            <dd className={page.definitionValue}>{user.penName ?? '（未設定）'}</dd>

            <dt className={page.definitionTerm}>角色</dt>
            <dd className={page.definitionValue}>
              <Badge variant={ROLE_VARIANT[user.role] ?? 'default'}>
                {ROLE_LABEL[user.role] ?? user.role}
              </Badge>
            </dd>

            <dt className={page.definitionTerm}>帳號狀態</dt>
            <dd className={page.definitionValue}>
              <Badge variant={user.isSuspended ? 'error' : 'success'}>
                {user.isSuspended ? '已停權' : '正常'}
              </Badge>
              {user.isSuspended && user.suspendedAt && (
                <span className={page.muted}>停權於 {formatDateTime(user.suspendedAt)}</span>
              )}
            </dd>

            <dt className={page.definitionTerm}>註冊時間</dt>
            <dd className={`${page.definitionValue} ${page.numeric}`}>
              {formatDateTime(user.createdAt)}
            </dd>

            <dt className={page.definitionTerm}>最後更新</dt>
            <dd className={`${page.definitionValue} ${page.numeric}`}>
              {formatDateTime(user.updatedAt)}
            </dd>

            <dt className={page.definitionTerm}>內容產出</dt>
            <dd className={`${page.definitionValue} ${page.numeric}`}>
              作品 {user.novelCount} 部・留言 {user.commentCount} 則・書評 {user.reviewCount} 篇
            </dd>
          </dl>
        </div>
      </section>

      <section className={page.section} aria-labelledby="user-audit-heading">
        <h2 id="user-audit-heading" className={page.sectionTitle}>
          管理處置紀錄
          <span className={page.sectionCount}>共 {auditTotal} 筆</span>
        </h2>

        {auditLogs.length === 0 ? (
          // 這裡不用 components/admin/EmptyState：它是 client 元件語彙，
          // 為了一行空態把整包圖示拉進 RSC 不划算
          <p className={page.emptyNote}>此帳號未曾被管理員執行任何管理操作。</p>
        ) : (
          <div className={table.tableContainer}>
            <div className={table.tableWrapper}>
              <table className={table.plainTable}>
                <caption className="sr-only">此使用者歷來的管理處置紀錄</caption>
                <thead>
                  <tr>
                    <th scope="col" className={table.th}>
                      時間
                    </th>
                    <th scope="col" className={table.th}>
                      動作
                    </th>
                    <th scope="col" className={table.th}>
                      操作者
                    </th>
                    <th scope="col" className={table.th}>
                      理由
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.map((log) => (
                    <tr key={log.id} className={table.tr}>
                      <td className={`${table.td} ${page.numeric}`}>
                        {formatDateTime(log.createdAt)}
                      </td>
                      <td className={table.td}>{log.action}</td>
                      <td className={table.td}>{log.actorName ?? log.actorId}</td>
                      <td className={table.td}>{log.reason || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
