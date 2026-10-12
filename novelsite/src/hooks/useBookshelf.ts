'use client';

/**
 * useBookshelf — 書架管理 Hook
 *
 * 登入時走 API（狀態跟著帳號走），未登入沿用 `localStorage`（FEAT-4 T034）。
 * **對外形狀不變**（`{ isInShelf, toggle }`）—— 登入與否的分歧封裝在這裡，
 * 不擴散到各消費端（spec Assumptions）。
 *
 * 採用兩段式初始化避免 SSR/CSR Hydration Mismatch：
 * - server 及 client 首次渲染均回傳空陣列（安全預設值）
 * - mount 後透過 queueMicrotask 讀取 localStorage 真實值
 *   （使用 queueMicrotask 讓 setState 在 microtask 佇列中執行，
 *    符合 react-hooks/set-state-in-effect 規則）
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

export function useBookshelf(novelId: string) {
  // server / client 首次渲染都使用空陣列，避免 Hydration Mismatch
  const [ids, setIds] = useState<string[]>([]);
  const isLoggedIn = useSessionUser() !== null;

  // mount 後同步真實值：登入取伺服器、未登入取 localStorage
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

  const isInShelf = ids.includes(novelId);

  const toggle = useCallback(() => {
    setIds((prev) => {
      const adding = !prev.includes(novelId);
      const next = adding ? [...prev, novelId] : prev.filter((id) => id !== novelId);

      if (isLoggedIn) {
        // 樂觀更新：按下去要立刻有反應。失敗時回捲，否則畫面會宣稱一件沒發生的事
        void toggleBookshelfRemote(novelId, adding).then((ok) => {
          if (!ok) setIds(prev);
        });
      } else {
        saveIds(next);
      }
      return next;
    });
  }, [novelId, isLoggedIn]);

  return { isInShelf, toggle };
}
