'use client';

import React, { useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import styles from './Modal.module.css';

/**
 * 對話框內可聚焦的元素（FEAT-8 T012，FR-032）。
 *
 * `[tabindex="-1"]` 排除在外 —— 對話框根節點本身就帶它（開啟時焦點移入用），
 * 不排掉的話它會成為循環裡的一站，使用者每繞一圈就會撞到一個什麼都不是的焦點。
 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  closeOnOverlay?: boolean;
  showCloseButton?: boolean;
  footer?: React.ReactNode;
}

export function Modal({
  isOpen,
  onClose,
  title,
  description,
  children,
  size = 'md',
  closeOnOverlay = true,
  showCloseButton = true,
  footer,
}: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  /** 開啟瞬間的觸發元素，關閉時焦點要歸還給它（FEAT-8 T011，FR-032） */
  const triggerRef = useRef<HTMLElement | null>(null);

  /**
   * 關閉後把焦點歸還原觸發元素（FR-032）。
   *
   * **只能在這裡做**：「開啟前焦點在哪」在對話框換上 `document.activeElement`
   * 之前的一瞬就消失了，呼叫端拿不到。不歸還的症狀是鍵盤使用者關閉對話框後
   * 焦點掉回頁面最前端，得從頭按一遍 Tab 才回得了原位。
   */
  useEffect(() => {
    if (!isOpen) return;
    triggerRef.current = document.activeElement as HTMLElement | null;
    return () => {
      triggerRef.current?.focus();
      triggerRef.current = null;
    };
  }, [isOpen]);

  // 鎖定背景捲動
  useEffect(() => {
    if (isOpen) {
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
      document.body.style.overflow = 'hidden';
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    } else {
      document.body.style.overflow = '';
      document.body.style.paddingRight = '';
    }
    return () => {
      document.body.style.overflow = '';
      document.body.style.paddingRight = '';
    };
  }, [isOpen]);

  // ESC 鍵關閉；Tab 焦點鎖在對話框內（FEAT-8 T012，FR-032）
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;

      const dialog = dialogRef.current;
      if (!dialog) return;

      const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      // 一個可聚焦元素都沒有時，焦點留在對話框根節點，**MUST NOT** 放它逸出去
      if (focusables.length === 0) {
        e.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;

      if (e.shiftKey) {
        if (active === first || !dialog.contains(active)) {
          e.preventDefault();
          last.focus();
        }
        return;
      }
      // 最後一個往後推回第一個；焦點已在對話框外時一律拉回來
      if (active === last || !dialog.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      // 焦點移入 Dialog
      requestAnimationFrame(() => dialogRef.current?.focus());
    }
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  const modal = (
    <div
      ref={overlayRef}
      className={`${styles.modal__overlay} ${isOpen ? styles['modal__overlay--open'] : ''}`}
      onClick={closeOnOverlay ? (e) => e.target === overlayRef.current && onClose() : undefined}
      aria-hidden={!isOpen}
    >
      <div
        ref={dialogRef}
        className={`${styles.modal} ${styles[`modal--${size}`]}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? 'modal-title' : undefined}
        aria-describedby={description ? 'modal-desc' : undefined}
        tabIndex={-1}
      >
        {/* Header */}
        {(title || showCloseButton) && (
          <div className={styles.modal__header}>
            {title && (
              <h2 id="modal-title" className={styles.modal__title}>
                {title}
              </h2>
            )}
            {description && (
              <p id="modal-desc" className={styles.modal__description}>
                {description}
              </p>
            )}
            {showCloseButton && (
              <button
                className={styles.modal__close}
                onClick={onClose}
                aria-label="關閉對話框"
                id="modal-close-btn"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        )}

        {/* Body */}
        <div className={styles.modal__body}>{children}</div>

        {/* Footer */}
        {footer && <div className={styles.modal__footer}>{footer}</div>}
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
