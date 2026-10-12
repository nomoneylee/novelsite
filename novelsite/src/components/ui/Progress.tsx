import React from 'react';
import styles from './Progress.module.css';

export type ProgressVariant = 'default' | 'reading' | 'success' | 'warning';

export interface ProgressProps {
  value: number; // 0 - 100
  max?: number;
  variant?: ProgressVariant;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  label?: string;
  animated?: boolean;
  className?: string;
  /** 閱讀進度條：固定在頁面頂部 */
  sticky?: boolean;
  'aria-label'?: string;
}

export function Progress({
  value,
  max = 100,
  variant = 'default',
  size = 'sm',
  showLabel = false,
  label,
  animated = true,
  className = '',
  sticky = false,
  'aria-label': ariaLabel,
}: ProgressProps) {
  const percentage = Math.min(Math.max((value / max) * 100, 0), 100);

  const wrapperClass = [
    styles.progress__wrapper,
    sticky ? styles['progress__wrapper--sticky'] : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const trackClass = [styles.progress__track, styles[`progress__track--${size}`]]
    .filter(Boolean)
    .join(' ');

  const barClass = [
    styles.progress__bar,
    styles[`progress__bar--${variant}`],
    animated ? styles['progress__bar--animated'] : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={wrapperClass}>
      {(showLabel || label) && (
        <div className={styles.progress__header}>
          {label && <span className={styles.progress__label}>{label}</span>}
          {showLabel && (
            <span className={styles.progress__percentage}>{Math.round(percentage)}%</span>
          )}
        </div>
      )}
      <div
        className={trackClass}
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={ariaLabel ?? label ?? '進度'}
      >
        <div className={barClass} style={{ transform: `scaleX(${percentage / 100})` }} />
      </div>
    </div>
  );
}
