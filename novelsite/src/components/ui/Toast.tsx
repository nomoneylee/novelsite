'use client';

/**
 * Toast — 輕量通知元件
 * 透過全域事件系統觸發，無需 context
 */

import React, { useState, useEffect, useCallback } from 'react';
import { CheckCircle, WarningCircle, Info, X } from '@phosphor-icons/react';
import styles from './Toast.module.css';

export type ToastType = 'success' | 'error' | 'info';

interface ToastMessage {
  id: string;
  type: ToastType;
  message: string;
}

// ─── 全域事件名稱 ─────────────────────────────────────────
const TOAST_EVENT = 'novelsite:toast';

// ─── 觸發函式（供外部呼叫） ────────────────────────────────
export function showToast(message: string, type: ToastType = 'success') {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: { message, type } }));
}

// ─── 圖示映射 ─────────────────────────────────────────────
const ICONS: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle size={18} weight="fill" />,
  error: <WarningCircle size={18} weight="fill" />,
  info: <Info size={18} weight="fill" />,
};

// ─── Toast 容器（應放在 layout 裡） ───────────────────────
export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const { message, type } = (e as CustomEvent<{ message: string; type: ToastType }>).detail;
      const id = `${Date.now()}-${Math.random()}`;
      setToasts((prev) => [...prev, { id, type, message }]);
      // 3 秒後自動移除
      setTimeout(() => removeToast(id), 3000);
    };

    window.addEventListener(TOAST_EVENT, handler);
    return () => window.removeEventListener(TOAST_EVENT, handler);
  }, [removeToast]);

  if (toasts.length === 0) return null;

  return (
    <div className={styles.container} aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`${styles.toast} ${styles[`toast--${toast.type}`]}`}
          role="alert"
        >
          <span className={styles.toast__icon}>{ICONS[toast.type]}</span>
          <span className={styles.toast__message}>{toast.message}</span>
          <button
            className={styles.toast__close}
            onClick={() => removeToast(toast.id)}
            aria-label="關閉通知"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
