import React from 'react';
import styles from './AdminDataTable.module.css';

export interface Column<T> {
  key: string;
  header: string;
  render?: (item: T) => React.ReactNode;
  width?: string;
  align?: 'left' | 'center' | 'right';
}

export interface AdminDataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (item: T) => string;
  caption?: string;
  emptyNode?: React.ReactNode;
  pagination?: {
    currentPage?: number;
    totalCount?: number;
    pageSize?: number;
    hasPrev?: boolean;
    hasNext?: boolean;
    onPrev?: () => void;
    onNext?: () => void;
  };
}

export function AdminDataTable<T>({
  columns,
  data,
  keyExtractor,
  caption,
  emptyNode,
  pagination,
}: AdminDataTableProps<T>) {
  if (data.length === 0 && emptyNode) {
    return <>{emptyNode}</>;
  }

  return (
    <div className={styles.tableContainer}>
      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className={styles.th}
                  style={{ width: col.width, textAlign: col.align ?? 'left' }}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((item) => {
              const rowKey = keyExtractor(item);
              return (
                <tr key={rowKey} className={styles.tr}>
                  {columns.map((col) => {
                    const content = col.render
                      ? col.render(item)
                      : (item as Record<string, unknown>)[col.key] != null
                        ? String((item as Record<string, unknown>)[col.key])
                        : '-';

                    return (
                      <td
                        key={col.key}
                        className={styles.td}
                        style={{ textAlign: col.align ?? 'left' }}
                      >
                        {content}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pagination && (
        <div className={styles.pagination} aria-label="分頁導覽">
          <div>
            {pagination.totalCount !== undefined ? `共 ${pagination.totalCount} 筆資料` : ''}
          </div>
          <div className={styles.paginationButtons}>
            <button
              type="button"
              className={styles.pageBtn}
              onClick={pagination.onPrev}
              disabled={!pagination.hasPrev}
              aria-label="上一頁"
            >
              上一頁
            </button>
            <button
              type="button"
              className={styles.pageBtn}
              onClick={pagination.onNext}
              disabled={!pagination.hasNext}
              aria-label="下一頁"
            >
              下一頁
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
