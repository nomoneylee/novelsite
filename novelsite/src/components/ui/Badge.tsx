import React from 'react';
import styles from './Badge.module.css';

export type BadgeVariant =
  | 'default'
  | 'fantasy'
  | 'urban'
  | 'romance'
  | 'scifi'
  | 'history'
  | 'mystery'
  | 'success'
  | 'warning'
  | 'error'
  | 'info';

export type BadgeSize = 'sm' | 'md';

export interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  size?: BadgeSize;
  dot?: boolean;
  className?: string;
}

// 分類對應 variant
export const CATEGORY_VARIANT_MAP: Record<string, BadgeVariant> = {
  玄幻: 'fantasy',
  都市: 'urban',
  言情: 'romance',
  科幻: 'scifi',
  歷史: 'history',
  懸疑: 'mystery',
};

export function Badge({
  children,
  variant = 'default',
  size = 'md',
  dot = false,
  className = '',
}: BadgeProps) {
  const classes = [styles.badge, styles[`badge--${variant}`], styles[`badge--${size}`], className]
    .filter(Boolean)
    .join(' ');

  return (
    <span className={classes}>
      {dot && <span className={styles.badge__dot} aria-hidden="true" />}
      {children}
    </span>
  );
}
