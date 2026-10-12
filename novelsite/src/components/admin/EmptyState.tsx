import React from 'react';
import { MagnifyingGlass } from '@phosphor-icons/react';
import styles from './EmptyState.module.css';

export interface EmptyStateProps {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}

export function EmptyState({
  title = '查無資料',
  description = '目前沒有符合篩選條件的項目，請嘗試調整搜尋字詞或篩選條件。',
  icon,
  action,
}: EmptyStateProps) {
  return (
    <div className={styles.container}>
      <div className={styles.iconWrap} aria-hidden="true">
        {icon ?? <MagnifyingGlass size={28} />}
      </div>
      <h3 className={styles.title}>{title}</h3>
      <p className={styles.description}>{description}</p>
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}
