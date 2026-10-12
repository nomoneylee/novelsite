'use client';

/**
 * useReaderStateMerge — 登入後把本機累積的讀者狀態帶進帳號（FEAT-4 T037）
 * =========================================================================
 * 全部判斷（觸發、截斷、告知、清除時機）在 `lib/reader/readerStateMerge`，
 * 本 Hook 只負責「登入態下掛載時執行一次」。
 *
 * 觸發判定 MUST 以**瀏覽器端是否仍有本機資料**為準，MUST NOT 以帳號層級的
 * 「首次登入」旗標為準 —— 本機資料存在於每一個瀏覽器，帳號旗標會使第二台裝置上的
 * 訪客資料永遠無法上傳（FR-015）。
 */

import { useEffect, useRef } from 'react';
import { runReaderStateMerge } from '@/lib/reader/readerStateMerge';
import { showToast } from '@/components/ui/Toast';

/** 客戶端的截斷上限。伺服器端以 `env.MERGE_BATCH_MAX` 為準並回 400，兩者的預設值一致 */
const MERGE_BATCH_MAX = 200;

export function useReaderStateMerge(isLoggedIn: boolean): void {
  // 同一次掛載內只跑一次：React 的嚴格模式會把 effect 執行兩次，
  // 而合併雖為冪等，重複送出仍是白費的請求
  const startedRef = useRef(false);

  useEffect(() => {
    if (!isLoggedIn || startedRef.current) return;
    startedRef.current = true;

    void runReaderStateMerge({
      loggedIn: true,
      storage: window.localStorage,
      fetchImpl: (...args) => fetch(...args),
      batchMax: MERGE_BATCH_MAX,
      notify: (message) => showToast(message, 'info'),
    });
  }, [isLoggedIn]);
}
