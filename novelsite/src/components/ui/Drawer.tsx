'use client';

import React, { useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import styles from './Drawer.module.css';

export type DrawerSide = 'left' | 'right' | 'bottom';

export interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  side?: DrawerSide;
  title?: string;
  children: React.ReactNode;
  width?: string;
  showCloseButton?: boolean;
  closeOnOverlay?: boolean;
}

export function Drawer({
  isOpen,
  onClose,
  side = 'right',
  title,
  children,
  width = '320px',
  showCloseButton = true,
  closeOnOverlay = true,
}: DrawerProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
      document.body.style.overflow = 'hidden';
      document.body.style.paddingRight = `${scrollbarWidth}px`;
      requestAnimationFrame(() => drawerRef.current?.focus());
    } else {
      document.body.style.overflow = '';
      document.body.style.paddingRight = '';
    }
    return () => {
      document.body.style.overflow = '';
      document.body.style.paddingRight = '';
    };
  }, [isOpen]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (isOpen) document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  const drawerStyle: React.CSSProperties = side === 'bottom' ? {} : { width, maxWidth: '90vw' };

  const drawer = (
    <div
      ref={overlayRef}
      className={styles.drawer__overlay}
      onClick={closeOnOverlay ? (e) => e.target === overlayRef.current && onClose() : undefined}
    >
      <div
        ref={drawerRef}
        className={`${styles.drawer} ${styles[`drawer--${side}`]}`}
        style={drawerStyle}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        {/* Header */}
        {(title || showCloseButton) && (
          <div className={styles.drawer__header}>
            {title && <h2 className={styles.drawer__title}>{title}</h2>}
            {showCloseButton && (
              <button
                className={styles.drawer__close}
                onClick={onClose}
                aria-label="關閉側邊欄"
                id="drawer-close-btn"
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
        <div className={styles.drawer__body}>{children}</div>
      </div>
    </div>
  );

  return createPortal(drawer, document.body);
}
