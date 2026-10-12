import React from 'react';
import styles from './SkeletonTable.module.css';

export interface SkeletonTableProps {
  rows?: number;
  columns?: number;
}

export function SkeletonTable({ rows = 5, columns = 5 }: SkeletonTableProps) {
  return (
    <div className={styles.skeletonWrapper} aria-busy="true" aria-label="載入中">
      <div className={styles.skeletonHeader}>
        {Array.from({ length: columns }).map((_, i) => (
          <div key={i} className={styles.skeletonCell} style={{ flex: i === 0 ? 2 : 1 }} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className={styles.skeletonRow}>
          {Array.from({ length: columns }).map((_, c) => (
            <div key={c} className={styles.skeletonCell} style={{ flex: c === 0 ? 2 : 1 }} />
          ))}
        </div>
      ))}
    </div>
  );
}
