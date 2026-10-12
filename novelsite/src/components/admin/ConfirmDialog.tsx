'use client';

import React, { useState, useEffect, useRef, useId } from 'react';
import { createPortal } from 'react-dom';
import styles from './ConfirmDialog.module.css';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void> | void;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  isDestructive?: boolean;
  requireReason?: boolean;
  reasonPlaceholder?: string;
  isLoading?: boolean;
}

function ConfirmDialogInner({
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = '確認',
  cancelLabel = '取消',
  isDestructive = true,
  requireReason = true,
  reasonPlaceholder = '請輸入操作理由（如：違規內容下架、惡意洗版…）',
  isLoading = false,
}: Omit<ConfirmDialogProps, 'isOpen'>) {
  const titleId = useId();
  const descId = useId();
  const reasonId = useId();
  const errorId = useId();

  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  // 記錄開啟前的焦點元素，關閉時歸還
  useEffect(() => {
    triggerRef.current = document.activeElement as HTMLElement | null;
    return () => {
      triggerRef.current?.focus();
    };
  }, []);

  // 焦點捕獲與鍵盤 ESC 支援
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLoading) {
        onClose();
        return;
      }

      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    const timer = setTimeout(() => {
      if (dialogRef.current) {
        const firstFocusable = dialogRef.current.querySelector<HTMLElement>(
          requireReason ? 'textarea' : 'button:not([disabled])'
        );
        firstFocusable?.focus();
      }
    }, 50);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      clearTimeout(timer);
    };
  }, [isLoading, onClose, requireReason]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmed = reason.trim();
    if (requireReason) {
      if (!trimmed) {
        setError('請輸入操作理由');
        return;
      }
      if (trimmed.length > 200) {
        setError('操作理由不能超過 200 字');
        return;
      }
    }

    setError('');
    await onConfirm(trimmed);
  };

  return (
    <div
      className={styles.overlay}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isLoading) {
          onClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        tabIndex={-1}
      >
        <form onSubmit={handleSubmit}>
          <div className={styles.header}>
            <h3
              id={titleId}
              className={`${styles.title} ${isDestructive ? styles.dangerTitle : ''}`}
            >
              {title}
            </h3>
          </div>

          <div className={styles.body}>
            <div id={descId} className={styles.message}>
              {message}
            </div>

            {requireReason && (
              <div className={styles.formGroup}>
                <label htmlFor={reasonId} className={styles.label}>
                  操作理由
                  <span className={styles.required}>*</span>
                </label>
                <textarea
                  id={reasonId}
                  className={`${styles.textarea} ${error ? styles.textareaError : ''}`}
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value);
                    if (error) setError('');
                  }}
                  placeholder={reasonPlaceholder}
                  maxLength={200}
                  rows={3}
                  disabled={isLoading}
                  aria-invalid={!!error}
                  aria-describedby={error ? errorId : undefined}
                  required
                />
                <div className={styles.charCount}>{reason.length} / 200 字</div>
                {error && (
                  <span id={errorId} className={styles.errorText} role="alert">
                    {error}
                  </span>
                )}
              </div>
            )}
          </div>

          <div className={styles.footer}>
            <button
              type="button"
              className={styles.cancelBtn}
              onClick={onClose}
              disabled={isLoading}
            >
              {cancelLabel}
            </button>
            <button
              type="submit"
              className={isDestructive ? styles.confirmDangerBtn : styles.confirmBtn}
              disabled={isLoading || (requireReason && !reason.trim())}
            >
              {isLoading ? '處理中…' : confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function ConfirmDialog(props: ConfirmDialogProps) {
  if (!props.isOpen || typeof document === 'undefined') return null;
  return createPortal(<ConfirmDialogInner {...props} />, document.body);
}
