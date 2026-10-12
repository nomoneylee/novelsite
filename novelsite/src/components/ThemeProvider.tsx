'use client';

import React, { createContext, useContext } from 'react';
import { useTheme, type Theme } from '@/hooks/useTheme';

// ─────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────
interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  cycleTheme: () => void;
  toggleDark: () => void;
  mounted: boolean;
  isLight: boolean;
  isDark: boolean;
  isEyecare: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

// ─────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────
interface ThemeProviderProps {
  children: React.ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const themeValue = useTheme();

  return <ThemeContext.Provider value={themeValue}>{children}</ThemeContext.Provider>;
}

// ─────────────────────────────────────────────
// useThemeContext Hook
// ─────────────────────────────────────────────
export function useThemeContext() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useThemeContext 必須在 ThemeProvider 內部使用');
  }
  return ctx;
}

export type { Theme };
