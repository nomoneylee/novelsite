import React from 'react';
import Link from 'next/link';
import { ArrowSquareOut, ShieldCheck } from '@phosphor-icons/react/dist/ssr';
import { AdminSidebar } from '@/components/admin/AdminSidebar';
import styles from './layout.module.css';

export const metadata = {
  title: '管理後台 | NovelSite',
  robots: {
    index: false,
    follow: false,
  },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.container}>
      <AdminSidebar />
      <div className={styles.mainWrapper}>
        <header className={styles.header}>
          <span className={styles.headerTitle}>NovelSite 管理後台</span>
          <div className={styles.headerActions}>
            <span className={styles.roleBadge}>
              <ShieldCheck size={14} weight="fill" aria-hidden="true" />
              系統管理員
            </span>
            {/*
              返回前台放在頂部而非側邊欄底部：側邊欄在 <1024px 轉為橫向捲動列，
              「底部」那個位置到時候會捲到看不見的地方去
            */}
            <Link href="/" className={styles.homeLink}>
              <ArrowSquareOut size={16} aria-hidden="true" />
              <span>返回前台</span>
            </Link>
          </div>
        </header>
        <main id="main-content" className={styles.content}>
          {children}
        </main>
      </div>
    </div>
  );
}
