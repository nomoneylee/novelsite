'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  SquaresFour,
  BookOpen,
  PlusCircle,
  Compass,
  ChartLineUp,
  ChatCircleText,
  ArrowLeft,
} from '@phosphor-icons/react';
import styles from './AuthorSidebar.module.css';

/**
 * 「章節編輯器」項目已移除（FEAT-3 T052）。
 *
 * 它原本寫死指向示範草稿 `/author/editor/draft-1`。編輯器改為擁有者限定之後
 * （`getAuthorChapterForEdit(session.uid, …)`），那條連結對**除了示範內容作者以外的
 * 每一位作者**都是 404 —— 而且是導覽列上的常駐項目，每次進後台都看得到。
 *
 * 沒有補上替代連結是刻意的：編輯器必然對應某一個具體章節，它沒有「總覽」意義的入口。
 * 正確的路徑是「作品管理 → 選作品 → 選章節」，那條路現在是通的。
 */
const NAV_ITEMS = [
  { href: '/author/dashboard', label: '數據儀表板', icon: SquaresFour },
  { href: '/author/novels', label: '作品管理', icon: BookOpen },
  { href: '/author/comments', label: '留言管理', icon: ChatCircleText },
  { href: '/author/create', label: '開始創作', icon: PlusCircle },
  { href: '/author/guide', label: '創作指南', icon: Compass },
  { href: '/author/earn', label: '作品成效', icon: ChartLineUp },
];

export function AuthorSidebar() {
  const pathname = usePathname();

  return (
    <aside className={styles.sidebar} aria-label="作者後台導覽">
      <div className={styles.sidebar__header}>
        <Link href="/" className={styles.sidebar__back}>
          <ArrowLeft size={16} />
          返回網站
        </Link>
        <p className={styles.sidebar__title}>作者後台</p>
      </div>

      <nav className={styles.sidebar__nav}>
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active =
            pathname === href ||
            (href !== '/author/dashboard' &&
              pathname.startsWith(href.split('/').slice(0, 3).join('/')));
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
    </aside>
  );
}
