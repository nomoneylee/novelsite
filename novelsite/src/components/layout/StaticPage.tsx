import React from 'react';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { SiteFooter } from '@/components/layout/SiteFooter';
import styles from './StaticPage.module.css';

interface StaticPageProps {
  title: string;
  subtitle?: string;
  /** 最後更新日期（法務頁使用） */
  updatedAt?: string;
  children: React.ReactNode;
  id?: string;
}

/** 資訊／法務等靜態內容頁的共用外框（導覽列 + 內容容器 + 頁尾） */
export function StaticPage({ title, subtitle, updatedAt, children, id }: StaticPageProps) {
  return (
    <>
      <SiteHeader />

      <main className={styles.page} id={id}>
        <div className={`container ${styles.page__inner}`}>
          <header className={styles.page__header}>
            <h1 className={styles.page__title}>{title}</h1>
            {subtitle && <p className={styles.page__subtitle}>{subtitle}</p>}
            {updatedAt && <p className={styles.page__updated}>最後更新：{updatedAt}</p>}
          </header>

          <article className={styles.article}>{children}</article>
        </div>
      </main>

      <SiteFooter />
    </>
  );
}
