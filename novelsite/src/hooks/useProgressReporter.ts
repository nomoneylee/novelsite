'use client';

/**
 * useProgressReporter — 閱讀進度的背景上報（FEAT-4 T038）
 * ========================================================
 * 兩個觸發點：`pagehide` 事件，以及每 `intervalSeconds`（預設 30）一次的節流。
 * 節流的行為本身在 `lib/reader/progressReporter`（可用假時鐘驗證，SC-021），
 * 本 Hook 只做事件接線與生命週期。
 *
 * 傳輸一律 `fetch(..., { keepalive: true })`，**MUST NOT 使用 `navigator.sendBeacon`** ——
 * 它只能發 POST，與本端點的 PUT 語意衝突，且無法自訂標頭（research R-5）。
 *
 * `getPercent` 回 `null` 即「尚未就緒」，上報器會跳過：續讀位置還原完成前
 * 送出 0% 會把正要還原的那個值覆寫掉（FR-011）。
 */

import { useEffect } from 'react';
import { createProgressReporter } from '@/lib/reader/progressReporter';
import { apiUrl } from '@/lib/apiUrl';

export function useProgressReporter(opts: {
  enabled: boolean;
  novelId: string;
  chapterId: string;
  getPercent: () => number | null;
  intervalSeconds: number;
}): void {
  const { enabled, novelId, chapterId, getPercent, intervalSeconds } = opts;

  useEffect(() => {
    if (!enabled) return;

    const reporter = createProgressReporter({
      getPercent,
      intervalMs: Math.max(1, intervalSeconds) * 1000,
      send: (percent) =>
        fetch(apiUrl('/api/reading-progress'), {
          method: 'PUT',
          keepalive: true,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ novelId, chapterId, percent }),
        }).then(() => undefined),
    });

    // `pagehide` 而非 `beforeunload`：行動瀏覽器把分頁移入 bfcache 時不觸發後者，
    // 而那正是 FR-012a 要覆蓋的情境（闔上手機、切走一小時）
    const onPageHide = () => reporter.flush();
    window.addEventListener('pagehide', onPageHide);

    return () => {
      window.removeEventListener('pagehide', onPageHide);
      reporter.flush();
      reporter.stop();
    };
  }, [enabled, novelId, chapterId, getPercent, intervalSeconds]);
}
