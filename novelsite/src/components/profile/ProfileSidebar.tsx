'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  BookmarkSimple,
  ClockCounterClockwise,
  Gear,
  SignOut,
} from '@phosphor-icons/react';
import { useAuth } from '@/hooks/useAuth';
import { showToast } from '@/components/ui/Toast';
import styles from './ProfileSidebar.module.css';

const NAV_ITEMS = [
  { href: '/profile/bookshelf', label: '我的書架', icon: BookmarkSimple },
  { href: '/profile/history', label: '閱讀歷史', icon: ClockCounterClockwise },
  { href: '/profile/settings', label: '帳號設定', icon: Gear },
];

export function ProfileSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();

  const handleLogout = async () => {
    await logout();
    showToast('已登出', 'info');
    router.push('/');
    router.refresh();
  };

  return (
    <aside className={styles.sidebar} aria-label="個人中心導覽">
      <Link href="/" className={styles.sidebar__back}>
        <ArrowLeft size={16} />
        返回首頁
      </Link>

      <div className={styles.sidebar__profile}>
        <div className={styles.sidebar__avatar} style={{ background: user?.avatarColor }}>
          {user?.name.charAt(0) ?? '訪'}
        </div>
        <div>
          <p className={styles.sidebar__name}>{user?.name ?? '訪客'}</p>
          <p className={styles.sidebar__email}>{user?.email ?? ''}</p>
        </div>
      </div>

      <nav className={styles.sidebar__nav}>
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`${styles.sidebar__link} ${active ? styles['sidebar__link--active'] : ''}`}
              aria-current={active ? 'page' : undefined}
            >
              <Icon size={18} weight={active ? 'fill' : 'regular'} />
              {label}
            </Link>
          );
        })}
      </nav>

      <button type="button" className={styles.sidebar__logout} onClick={handleLogout}>
        <SignOut size={18} />
        登出
      </button>
    </aside>
  );
}
