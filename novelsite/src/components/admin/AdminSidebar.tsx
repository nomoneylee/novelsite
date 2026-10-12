'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ChartLineUp,
  Users,
  BookOpen,
  Tag,
  ClockCounterClockwise,
  ShieldCheck,
} from '@phosphor-icons/react';
import styles from './AdminSidebar.module.css';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number; weight?: 'regular' | 'fill'; className?: string }>;
  exact?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/admin', label: '儀表板總覽', icon: ChartLineUp, exact: true },
  { href: '/admin/users', label: '使用者管理', icon: Users },
  { href: '/admin/content', label: '作品內容管理', icon: BookOpen },
  { href: '/admin/tags', label: '標籤治理', icon: Tag },
  { href: '/admin/audit', label: '稽核日誌', icon: ClockCounterClockwise },
];

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className={styles.sidebar} aria-label="管理後台導覽">
      <Link href="/admin" className={styles.brand}>
        <ShieldCheck size={22} weight="fill" aria-hidden="true" />
        <span className={styles.brandText}>管理中心</span>
        <span className={styles.badge}>ADMIN</span>
      </Link>

      <nav className={styles.nav}>
        {NAV_ITEMS.map((item) => {
          const isActive = item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`${styles.navItem} ${isActive ? styles.active : ''}`}
              aria-current={isActive ? 'page' : undefined}
            >
              {/* 選中態同時換成 fill 字重：顏色以外的第二個線索（WCAG 1.4.1） */}
              <Icon size={20} weight={isActive ? 'fill' : 'regular'} aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <p className={styles.footer}>所有管理操作都會寫入稽核日誌，且無法刪改。</p>
    </aside>
  );
}
