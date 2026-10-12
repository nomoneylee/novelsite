import React from 'react';
import Link from 'next/link';
import { BookOpen } from '@phosphor-icons/react/dist/ssr';
import styles from './SiteFooter.module.css';

const FOOTER_LINKS = {
  探索: [
    { href: '/novels', label: '所有小說' },
    { href: '/categories', label: '分類' },
    { href: '/new-releases', label: '新書上架' },
    { href: '/ranking', label: '排行榜' },
    { href: '/profile/bookshelf', label: '我的書架' },
  ],
  創作: [
    { href: '/author/dashboard', label: '作者後台' },
    { href: '/author/create', label: '開始創作' },
    { href: '/author/guide', label: '創作指南' },
    { href: '/author/earn', label: '作品成效' },
  ],
  平台: [
    { href: '/about', label: '關於我們' },
    { href: '/help', label: '幫助中心' },
    { href: '/contact', label: '聯絡我們' },
  ],
  法務: [
    { href: '/privacy', label: '隱私政策' },
    { href: '/terms', label: '服務條款' },
  ],
};

export function SiteFooter() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className={styles.footer} id="site-footer">
      <div className={styles.footer__container}>
        {/* 上方區域 */}
        <div className={styles.footer__top}>
          {/* 品牌區 */}
          <div className={styles.footer__brand}>
            <Link href="/" className={styles.footer__logo} id="footer-logo">
              <BookOpen size={28} weight="fill" className={styles.footer__logo__icon} />
              <span className={styles.footer__logo__text}>NovelSite</span>
            </Link>
            <p className={styles.footer__tagline}>
              沉浸式繁體中文原創文學平台
              <br />
              以「文字是主角，UI 是配角」為核心哲學
            </p>
          </div>

          {/* 連結區 */}
          <div className={styles.footer__links}>
            {Object.entries(FOOTER_LINKS).map(([category, links]) => (
              <div key={category} className={styles.footer__links__group}>
                <h2 className={styles.footer__links__title}>{category}</h2>
                <ul className={styles.footer__links__list}>
                  {links.map(({ href, label }) => (
                    <li key={href}>
                      <Link href={href} className={styles.footer__link}>
                        {label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* 分隔線 */}
        <div className={styles.footer__divider} />

        {/* 底部版權 */}
        <div className={styles.footer__bottom}>
          <p className={styles.footer__copyright}>© {currentYear} NovelSite. 保留所有權利。</p>
        </div>
      </div>
    </footer>
  );
}
