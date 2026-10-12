'use client';

import React, { createContext, useContext, useId } from 'react';
import styles from './Tabs.module.css';

// ─────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────
interface TabsContextValue {
  activeTab: string;
  onChange: (value: string) => void;
  baseId: string;
  variant: 'default' | 'pills' | 'underline';
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext() {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error('Tabs 子元件必須在 <Tabs> 內使用');
  return ctx;
}

// ─────────────────────────────────────────────
// Tabs Root
// ─────────────────────────────────────────────
export interface TabsProps {
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
  variant?: 'default' | 'pills' | 'underline';
  className?: string;
}

export function Tabs({
  value,
  onChange,
  children,
  variant = 'default',
  className = '',
}: TabsProps) {
  const baseId = useId();
  return (
    <TabsContext.Provider value={{ activeTab: value, onChange, baseId, variant }}>
      <div className={`${styles.tabs} ${className}`}>{children}</div>
    </TabsContext.Provider>
  );
}

// ─────────────────────────────────────────────
// TabList
// ─────────────────────────────────────────────
export interface TabListProps {
  children: React.ReactNode;
  className?: string;
}

export function TabList({ children, className = '' }: TabListProps) {
  const { variant } = useTabsContext();
  return (
    <div
      className={`${styles.tablist} ${styles[`tablist--${variant}`]} ${className}`}
      role="tablist"
    >
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────
// Tab
// ─────────────────────────────────────────────
export interface TabProps {
  value: string;
  children: React.ReactNode;
  disabled?: boolean;
  icon?: React.ReactNode;
}

export function Tab({ value, children, disabled = false, icon }: TabProps) {
  const { activeTab, onChange, baseId, variant } = useTabsContext();
  const isActive = activeTab === value;

  return (
    <button
      id={`${baseId}-tab-${value}`}
      role="tab"
      aria-selected={isActive}
      aria-controls={`${baseId}-panel-${value}`}
      disabled={disabled}
      className={[
        styles.tab,
        styles[`tab--${variant}`],
        isActive ? styles['tab--active'] : '',
        disabled ? styles['tab--disabled'] : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={() => {
        if (!disabled) onChange(value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (!disabled) onChange(value);
        }
      }}
    >
      {icon && <span className={styles.tab__icon}>{icon}</span>}
      {children}
      {variant === 'underline' && isActive && (
        <span className={styles.tab__indicator} aria-hidden="true" />
      )}
    </button>
  );
}

// ─────────────────────────────────────────────
// TabPanel
// ─────────────────────────────────────────────
export interface TabPanelProps {
  value: string;
  children: React.ReactNode;
  className?: string;
}

export function TabPanel({ value, children, className = '' }: TabPanelProps) {
  const { activeTab, baseId } = useTabsContext();
  if (activeTab !== value) return null;

  return (
    <div
      id={`${baseId}-panel-${value}`}
      role="tabpanel"
      aria-labelledby={`${baseId}-tab-${value}`}
      className={`${styles.tabpanel} ${className}`}
      tabIndex={0}
    >
      {children}
    </div>
  );
}
