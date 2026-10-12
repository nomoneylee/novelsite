'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MagnifyingGlass, Moon, Sun, Eye, List, X, BookOpen, Bell } from '@phosphor-icons/react';
import { useAuth } from '@/hooks/useAuth';
import styles from './SiteHeader.module.css';

type Theme = 'light' | 'dark' | 'eyecare';

const THEME_ICONS: Record<Theme, React.ReactNode> = {
  light: <Sun size={18} weight="fill" />,
  dark: <Moon size={18} weight="fill" />,
  eyecare: <Eye size={18} weight="fill" />,
};

const THEME_LABELS: Record<Theme, string> = {
  light: '白紙模式',
  dark: '夜間模式',
  eyecare: '護眼模式',
};

const THEME_CYCLE: Theme[] = ['light', 'dark', 'eyecare'];

/**
 * 未讀數的顯示上限（contracts/analytics-scheduling-api.md §3）。
 * 超過時顯示 `99+`，但 `aria-label` 一律給**實際數字** ——
 * 輔助技術的使用者不該只被告知「很多」。
 */
const UNREAD_DISPLAY_MAX = 99;

const NAV_LINKS = [
  { href: '/novels', label: '書庫' },
  { href: '/categories', label: '分類' },
  { href: '/ranking', label: '排行榜' },
  { href: '/author/dashboard', label: '作者專區' },
];

function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem('novelsite-theme') as Theme | null;
    if (stored && THEME_CYCLE.includes(stored)) return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function SiteHeader() {
  // 先用安全預設值渲染，mount 後同步 localStorage 真實值
  // 避免 SSR/CSR Hydration Mismatch
  const [theme, setTheme] = useState<Theme>('light');
  const [mounted, setMounted] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [hasHeroBackdrop, setHasHeroBackdrop] = useState(false);
  const pathname = usePathname();
  const { user, isLoggedIn, ready: authReady } = useAuth();

  useEffect(() => {
    // 使用 queueMicrotask 讓 setState 在 microtask 佇列中執行，
    // 符合 react-hooks/set-state-in-effect 規則（不直接在 effect body 呼叫）
    queueMicrotask(() => {
      setTheme(readStoredTheme());
      setMounted(true);
    });
  }, []);

  // 監聽捲動以觸發毛玻璃效果
  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // 本頁頂端是否鋪著 Hero 底圖（首頁輪播、作品詳情頁）。
  // 這兩處以作品封面色鋪底並疊上近黑遮罩，透明 Header 若沿用主題文字色
  // （淺色主題的 `--color-fg-secondary` 是深褐色）等於深字壓深底，導覽列幾乎讀不到；
  // 標記由 Hero 元件自己掛上 `data-hero-backdrop`，Header 不必知道有哪些頁面。
  useEffect(() => {
    queueMicrotask(() => {
      setHasHeroBackdrop(document.querySelector('[data-hero-backdrop]') !== null);
    });
  }, [pathname]);

  // 切換主題
  const cycleTheme = useCallback(() => {
    setTheme((current) => {
      const idx = THEME_CYCLE.indexOf(current);
      const next = THEME_CYCLE[(idx + 1) % THEME_CYCLE.length];
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('novelsite-theme', next);
      return next;
    });
  }, []);

  // 略過導覽、直接跳到主要內容（鍵盤無障礙，WCAG 2.4.1）
  const skipToMain = useCallback((e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    const main = document.querySelector('main');
    if (main) {
      main.setAttribute('tabindex', '-1');
      main.focus();
      main.scrollIntoView();
    }
  }, []);

  return (
    <>
      <header
        className={[
          styles.header,
          isScrolled ? styles['header--scrolled'] : '',
          // 捲動後已有毛玻璃底、行動選單展開時面板也是毛玻璃底，
          // 兩種情況都恢復主題文字色，只有「停在頂端且底下是 Hero」才轉淺色
          hasHeroBackdrop && !isScrolled && !mobileMenuOpen ? styles['header--on-hero'] : '',
        ]
          .filter(Boolean)
          .join(' ')}
        id="site-header"
      >
        {/* 跳至主要內容連結：預設隱藏，鍵盤 focus 時顯示。置於 header landmark 內，
          避免落在任何 landmark 之外（axe region 規則） */}
        <a href="#main-content" className={styles.header__skip} onClick={skipToMain}>
          跳至主要內容
        </a>
        <div className={styles.header__inner}>
          {/* Logo */}
          <Link href="/" className={styles.header__logo} id="site-logo">
            <BookOpen size={24} weight="fill" className={styles.header__logo__icon} />
            <span className={styles.header__logo__text}>NovelSite</span>
          </Link>

          {/* 桌面導覽 */}
          <nav className={styles.header__nav} aria-label="主要導覽">
            {NAV_LINKS.map(({ href, label }) => (
              <Link key={href} href={href} className={styles.header__nav__link}>
                {label}
              </Link>
            ))}
          </nav>

          {/* 右側操作區 */}
          <div className={styles.header__actions}>
            {/* 搜尋 */}
            <Link
              href="/search"
              className={styles.header__icon__btn}
              aria-label="搜尋"
              id="search-btn"
            >
              <MagnifyingGlass size={20} />
            </Link>

            {/* 主題切換 — 加 suppressHydrationWarning 讓 server/client 差異被忽略 */}
            <button
              className={styles.header__theme__btn}
              onClick={cycleTheme}
              aria-label={mounted ? `切換主題，目前：${THEME_LABELS[theme]}` : '切換主題'}
              id="theme-toggle-btn"
              type="button"
              title={mounted ? THEME_LABELS[theme] : ''}
              suppressHydrationWarning
            >
              {mounted ? THEME_ICONS[theme] : <Sun size={18} weight="fill" />}
              <span className={styles.header__theme__label} suppressHydrationWarning>
                {mounted ? THEME_LABELS[theme] : '白紙模式'}
              </span>
            </button>

            {/* 通知中心入口（僅登入者；未讀數與工作階段同一次查詢取回，不另發請求） */}
            {authReady && isLoggedIn && user ? (
              <Link
                href="/profile/notifications"
                className={styles.header__icon__btn}
                id="notifications-btn"
                aria-label={
                  user.unreadCount > 0
                    ? `通知中心，${user.unreadCount} 則未讀`
                    : '通知中心，沒有未讀'
                }
              >
                <Bell size={20} />
                {/* 未讀時以**數字**標示，非只靠顏色（FR-064）；0 則完全不渲染徽章 */}
                {user.unreadCount > 0 && (
                  <span className={styles.header__badge} aria-hidden="true">
                    {user.unreadCount > UNREAD_DISPLAY_MAX
                      ? `${UNREAD_DISPLAY_MAX}+`
                      : user.unreadCount}
                  </span>
                )}
              </Link>
            ) : null}

            {/* 登入按鈕 / 已登入頭像 */}
            {authReady && isLoggedIn && user ? (
              <Link
                href="/profile/bookshelf"
                className={styles.header__avatar__btn}
                id="profile-btn"
                aria-label={`${user.name} 的個人中心`}
                title={user.name}
              >
                <span
                  className={styles.header__avatar}
                  style={{ background: user.avatarColor }}
                  aria-hidden="true"
                >
                  {user.name.charAt(0)}
                </span>
              </Link>
            ) : (
              <Link
                href="/auth/login"
                className={styles.header__login__btn}
                id="login-btn"
                suppressHydrationWarning
              >
                登入
              </Link>
            )}

            {/* 行動版漢堡選單 */}
            <button
              className={styles.header__mobile__toggle}
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-label={mobileMenuOpen ? '關閉選單' : '開啟選單'}
              aria-expanded={mobileMenuOpen}
              id="mobile-menu-toggle"
              type="button"
            >
              {mobileMenuOpen ? <X size={22} /> : <List size={22} />}
            </button>
          </div>
        </div>

        {/* 行動版選單 */}
        {mobileMenuOpen && (
          <nav className={styles.header__mobile__nav} aria-label="行動版導覽">
            {NAV_LINKS.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className={styles.header__mobile__nav__link}
                onClick={() => setMobileMenuOpen(false)}
              >
                {label}
              </Link>
            ))}
            <div className={styles.header__mobile__divider} />
            {authReady && isLoggedIn && user ? (
              <>
                <Link
                  href="/profile/notifications"
                  className={styles.header__mobile__nav__link}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  通知中心{user.unreadCount > 0 ? `（${user.unreadCount} 則未讀）` : ''}
                </Link>
                <Link
                  href="/profile/bookshelf"
                  className={styles.header__mobile__login}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  個人中心（{user.name}）
                </Link>
              </>
            ) : (
              <Link
                href="/auth/login"
                className={styles.header__mobile__login}
                onClick={() => setMobileMenuOpen(false)}
              >
                登入 / 註冊
              </Link>
            )}
          </nav>
        )}
      </header>
    </>
  );
}
