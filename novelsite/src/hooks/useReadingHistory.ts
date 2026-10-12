'use client';

/**
 * useReadingHistory — 閱讀歷史紀錄 Hook
 *
 * 登入時走 API（每部作品一筆，由 `PUT /api/reading-progress` 於伺服器端 upsert），
 * 未登入沿用 `localStorage`（本機仍只留 50 筆）。**對外形狀不變**（FEAT-4 T035）。
 *
 * 採用兩段式初始化避免 SSR/CSR Hydration Mismatch：
 * - server 及 client 首次渲染均回傳空陣列（安全預設值）
 * - mount 後透過 queueMicrotask 讀取真實值
 */

import { useState, useCallback, useEffect } from 'react';
import { useSessionUser } from '@/components/SessionProvider';
import type { ReadingHistoryEntry } from '@/lib/types';
import { apiUrl } from '@/lib/apiUrl';

const STORAGE_KEY = 'novelsite-reading-history';
const MAX_ENTRIES = 50;

function loadHistory(): ReadingHistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ReadingHistoryEntry[];
  } catch {
    return [];
  }
}

function saveHistory(entries: ReadingHistoryEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // ignore quota errors
  }
}

async function fetchHistory(): Promise<ReadingHistoryEntry[]> {
  try {
    const res = await fetch(apiUrl('/api/history?limit=20'));
    if (!res.ok) return [];
    const json = (await res.json()) as { items?: ReadingHistoryEntry[] };
    return json.items ?? [];
  } catch {
    return [];
  }
}

async function deleteHistoryRemote(novelId?: string): Promise<boolean> {
  try {
    const res = await fetch(
      apiUrl(`/api/history${novelId ? `?novelId=${encodeURIComponent(novelId)}` : ''}`),
      {
        method: 'DELETE',
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}

export function useReadingHistory() {
  const [history, setHistory] = useState<ReadingHistoryEntry[]>([]);
  const isLoggedIn = useSessionUser() !== null;

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(async () => {
      const next = isLoggedIn ? await fetchHistory() : loadHistory();
      if (!cancelled) setHistory(next);
    });
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn]);

  /**
   * 記錄一次造訪。
   *
   * 登入時**只更新畫面**：伺服器端的歷史由 `PUT /api/reading-progress` 一併 upsert
   * （契約中歷史沒有獨立寫入端點），在這裡再打一次會是同一件事的第二個真相來源。
   */
  const recordVisit = useCallback(
    (entry: ReadingHistoryEntry) => {
      setHistory((prev) => {
        const next = [entry, ...prev.filter((e) => e.novelId !== entry.novelId)].slice(
          0,
          MAX_ENTRIES
        );
        if (!isLoggedIn) saveHistory(next);
        return next;
      });
    },
    [isLoggedIn]
  );

  const clearHistory = useCallback(() => {
    setHistory([]);
    if (isLoggedIn) void deleteHistoryRemote();
    else saveHistory([]);
  }, [isLoggedIn]);

  const removeEntry = useCallback(
    (novelId: string) => {
      setHistory((prev) => {
        const next = prev.filter((e) => e.novelId !== novelId);
        if (isLoggedIn) void deleteHistoryRemote(novelId);
        else saveHistory(next);
        return next;
      });
    },
    [isLoggedIn]
  );

  return { history, recordVisit, clearHistory, removeEntry };
}
