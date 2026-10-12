'use client';

/**
 * useReaderPrefs — 閱讀頁偏好設定 Hook
 *
 * 字級（`fontSize`）登入時走 API 並**回寫本機作為離線快取**，未登入沿用 `localStorage`
 * （FEAT-4 T036）。**主題不在這裡** —— 它自始由全站的 `useTheme` 獨立管理（見該檔）。
 *
 * 無干擾模式（`distractionFree`）**MUST NOT 同步**：現行明訂不跨章節記憶，
 * 同步它會讓讀者在下一章莫名其妙地找不到工具列。
 *
 * 採用兩段式初始化避免 SSR/CSR Hydration Mismatch：
 * - server 及 client 首次渲染均回傳預設值
 * - mount 後透過 queueMicrotask 讀取真實值
 */

import { useState, useCallback, useEffect } from 'react';
import { useSessionUser } from '@/components/SessionProvider';
import { fetchPreference, savePreference } from '@/lib/reader/preferenceApi';

export type ReaderFontSize = 'sm' | 'md' | 'lg';

interface ReaderPrefs {
  fontSize: ReaderFontSize;
  distractionFree: boolean;
}

const STORAGE_KEY = 'novelsite-reader-prefs';
const DEFAULT_PREFS: ReaderPrefs = { fontSize: 'md', distractionFree: false };

function isFontSize(value: unknown): value is ReaderFontSize {
  return value === 'sm' || value === 'md' || value === 'lg';
}

function loadPrefs(): ReaderPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<ReaderPrefs>;
    return {
      fontSize: isFontSize(parsed.fontSize) ? parsed.fontSize : DEFAULT_PREFS.fontSize,
      distractionFree: false, // 無干擾模式不跨章節記憶，每次進入章節重置
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function savePrefs(prefs: ReaderPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // ignore quota errors
  }
}

export function useReaderPrefs() {
  const [prefs, setPrefs] = useState<ReaderPrefs>(DEFAULT_PREFS);
  const isLoggedIn = useSessionUser() !== null;

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(async () => {
      const local = loadPrefs();
      if (!isLoggedIn) {
        if (!cancelled) setPrefs(local);
        return;
      }

      const remote = await fetchPreference();
      const next: ReaderPrefs = {
        ...local,
        // 伺服器尚無紀錄時沿用本機值，MUST NOT 把它蓋成預設值
        fontSize: isFontSize(remote?.fontSize) ? remote.fontSize : local.fontSize,
      };
      // 回寫本機作為離線快取。**這個鍵在登入態被持續回寫**，故它 MUST NOT 成為
      // `useReaderStateMerge` 的觸發條件、也 MUST NOT 被合併成功後清除 ——
      // 否則每次登入都會重新命中觸發判定，FR-015b／SC-002 的冪等恆假
      savePrefs(next);
      if (!cancelled) setPrefs(next);
    });
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn]);

  const setFontSize = useCallback(
    (fontSize: ReaderFontSize) => {
      setPrefs((prev) => {
        const next = { ...prev, fontSize };
        savePrefs(next);
        if (isLoggedIn) void savePreference({ fontSize });
        return next;
      });
    },
    [isLoggedIn]
  );

  const toggleDistractionFree = useCallback(() => {
    setPrefs((prev) => ({ ...prev, distractionFree: !prev.distractionFree }));
  }, []);

  return {
    fontSize: prefs.fontSize,
    distractionFree: prefs.distractionFree,
    setFontSize,
    toggleDistractionFree,
  };
}
