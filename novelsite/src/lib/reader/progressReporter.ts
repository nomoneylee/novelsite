/**
 * 閱讀進度的節流上報器（FEAT-4 4-A / T038 的核心，SC-021）
 * ==========================================================
 * 無 React 相依、無 DOM 相依：只有一個計時器與「上次送出的值」。
 * `useProgressReporter` 負責把 `pagehide` 事件與元件生命週期接上來。
 *
 * **為何拆出來**：節流是唯一一條時間相關的成功標準（SC-021），
 * 它只能用假時鐘驗證；而單元測試套件以 `react-server` 條件執行，
 * 該條件下的 react 不提供 `useEffect`，import 一個 Hook 檔會在載入期就爆。
 */

export interface ProgressReporterOptions {
  /**
   * 當下的百分比；回 `null` 代表**尚未就緒**。
   *
   * 續讀位置還原完成前 MUST 回 `null` —— 否則首次的 0% 會覆寫掉正要還原的那個值，
   * 續讀在第一次使用後就自我銷毀（contracts/reader-state-api.md §2）。
   */
  getPercent: () => number | null;
  /** 實際送出。失敗 MUST 被吞掉，MUST NOT 影響閱讀（FR-012） */
  send: (percent: number) => Promise<void> | void;
  intervalMs: number;
}

export interface ProgressReporter {
  /** 立即上報當下百分比（供 `pagehide` 呼叫） */
  flush: () => void;
  stop: () => void;
}

export function createProgressReporter(opts: ProgressReporterOptions): ProgressReporter {
  const { getPercent, send, intervalMs } = opts;

  let lastSent: number | null = null;
  let stopped = false;

  const tick = () => {
    if (stopped) return;

    const percent = getPercent();
    if (percent === null) return;
    // 百分比沒變就不送 —— 讀者停在同一段落一小時不該產生 120 次寫入
    if (percent === lastSent) return;

    lastSent = percent;
    try {
      const result = send(percent);
      if (result instanceof Promise) result.catch(() => {});
    } catch {
      // 上報是背景行為：擲出的話會把「網路斷了」變成一次閱讀中斷
    }
  };

  const timer = setInterval(tick, intervalMs);

  return {
    flush: tick,
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}
