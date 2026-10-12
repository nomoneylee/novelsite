'use client';

/**
 * useBookshelfIds — 讀取完整書架 id 清單（供書架頁列表使用）
 * 與 useBookshelf 共用同一組來源（登入時為 API、未登入時為 localStorage key），
 * 僅職責不同：useBookshelf 管理單一作品的加入/移除，這裡管理整份清單的讀取與批次移除。
 */

import { useState, useCallback, useEffect } from 'react';
import { useSessionUser } from '@/components/SessionProvider';
import { fetchBookshelfIds, toggleBookshelfRemote } from '@/lib/reader/bookshelfApi';

const STORAGE_KEY = 'novelsite-bookshelf';

function loadIds(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function saveIds(ids: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // ignore quota errors
  }
}

export function useBookshelfIds() {
  const [ids, setIds] = useState<string[]>([]);
  const isLoggedIn = useSessionUser() !== null;

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(async () => {
      const next = isLoggedIn ? await fetchBookshelfIds() : loadIds();
      if (!cancelled) setIds(next);
    });
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn]);

  const remove = useCallback(
    (novelId: string) => {
      setIds((prev) => {
        const next = prev.filter((id) => id !== novelId);
        if (isLoggedIn) {
          void toggleBookshelfRemote(novelId, false).then((ok) => {
            if (!ok) setIds(prev);
          });
        } else {
          saveIds(next);
        }
        return next;
      });
    },
    [isLoggedIn]
  );

  return { ids, remove };
}
