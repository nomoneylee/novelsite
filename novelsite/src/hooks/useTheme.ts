'use client';

/**
 * useTheme — 全站主題。
 *
 * 登入時走 API 並回寫本機作為離線快取，未登入沿用 `localStorage`（FEAT-4 T036）。
 * **主題是 `ReaderPreference` 的兩項之一**（另一項為字級，在 `useReaderPrefs`）——
 * FR-014 的同步範圍是這兩項，而主題自始不在 `useReaderPrefs` 裡。
 *
 * 既有的 SSR 防護 MUST 保留：本檔必須在首次繪製前自 `novelsite-theme` 讀到值
 * （`layout.tsx` 的內聯腳本亦讀同一個鍵），否則已登入者每次載入都會先閃一次錯誤主題。
 * 故**登入態的回寫沿用同一個鍵** —— 也正因為它在登入態被持續回寫，
 * 這個鍵 MUST NOT 成為 `useReaderStateMerge` 的觸發條件、亦 MUST NOT 被合併後清除。
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSessionUser } from '@/components/SessionProvider';
import { fetchPreference, savePreference } from '@/lib/reader/preferenceApi';

export type Theme = 'light' | 'dark' | 'eyecare';

const STORAGE_KEY = 'novelsite-theme';
const DEFAULT_THEME: Theme = 'light';

function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark' || value === 'eyecare';
}

function getSystemTheme(): Theme {
  if (typeof window === 'undefined') return DEFAULT_THEME;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return DEFAULT_THEME;
  const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
  if (stored && ['light', 'dark', 'eyecare'].includes(stored)) return stored;
  return getSystemTheme();
}

function applyTheme(theme: Theme) {
  const html = document.documentElement;

  // 加入過渡動畫 class，然後移除
  html.classList.add('theme-transition');
  html.setAttribute('data-theme', theme);
  window.setTimeout(() => {
    html.classList.remove('theme-transition');
  }, 350);
}

export function useTheme() {
  // 使用惰性初始化，在瀏覽器端直接讀取 localStorage，避免在 useEffect 裡呼叫 setState
  const [theme, setThemeState] = useState<Theme>(() =>
    typeof window !== 'undefined' ? getInitialTheme() : DEFAULT_THEME
  );
  // 用 ref 追蹤 hydration 狀態，避免在 effect 內呼叫 setState
  const mountedRef = useRef(false);
  const [mounted, setMounted] = useState(false);
  const isLoggedIn = useSessionUser() !== null;

  useEffect(() => {
    // 使用 ref 標記已掛載，避免在渲染過程中觸發連鎖更新
    if (!mountedRef.current) {
      mountedRef.current = true;
      setMounted(true);
    }
  }, []);

  // 登入時以伺服器上的主題為準（跨裝置一致，FR-014／SC-001）。
  // 伺服器尚無紀錄時**不動**現值 —— 那是「還沒設定過」，不是「要用預設值」。
  useEffect(() => {
    if (!isLoggedIn) return;
    let cancelled = false;
    void fetchPreference().then((remote) => {
      if (!cancelled && isTheme(remote?.theme)) setThemeState(remote.theme);
    });
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn]);

  useEffect(() => {
    if (!mounted) return;
    applyTheme(theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme, mounted]);

  // 監聽系統主題變更（僅在使用者未手動設定時）
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) {
        setThemeState(mediaQuery.matches ? 'dark' : 'light');
      }
    };
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  /**
   * 主題的伺服器端寫入只發生在**使用者主動切換**時。
   *
   * MUST NOT 掛在 `theme` 的 effect 上：那會在每次載入就把本機現值送上去，
   * 而載入時的 `fetchPreference` 還沒回來 —— 結果是本機值蓋掉伺服器值，
   * 「另一台裝置改過的主題」永遠傳不回來。
   */
  const syncTheme = useCallback(
    (next: Theme) => {
      if (isLoggedIn) void savePreference({ theme: next });
      return next;
    },
    [isLoggedIn]
  );

  const setTheme = useCallback(
    (newTheme: Theme) => {
      setThemeState(syncTheme(newTheme));
    },
    [syncTheme]
  );

  const cycleTheme = useCallback(() => {
    setThemeState((current) => {
      const themes: Theme[] = ['light', 'eyecare', 'dark'];
      const idx = themes.indexOf(current);
      return syncTheme(themes[(idx + 1) % themes.length]);
    });
  }, [syncTheme]);

  const toggleDark = useCallback(() => {
    setThemeState((current) => syncTheme(current === 'dark' ? 'light' : 'dark'));
  }, [syncTheme]);

  return {
    theme,
    setTheme,
    cycleTheme,
    toggleDark,
    mounted,
    isLight: theme === 'light',
    isDark: theme === 'dark',
    isEyecare: theme === 'eyecare',
  };
}
