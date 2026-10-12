import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createProgressReporter } from '@/lib/reader/progressReporter';

/**
 * T014：進度節流上報（SC-021）
 * ==============================
 * **這是唯一一條時間相關的成功標準，E2E 測不到它** —— 沒有人會讓一個瀏覽器
 * 真的閒置 30 秒再斷言。故節流本身由假時鐘驗證，Hook 只負責把 `pagehide`
 * 與 `setInterval` 接到這個純粹的上報器上。
 *
 * `getPercent()` 回 `null` 代表「尚未就緒」（續讀位置還原完成前），
 * 上報器 MUST 跳過 —— 否則首次的 0% 會覆寫掉正要還原的那個值（T042、FR-011）。
 *
 * **為何測 `lib/reader/progressReporter` 而非 `hooks/useProgressReporter`**：
 * 單元測試套件以 `react-server` 解析條件執行（見 `vitest.config.mts` 的註解），
 * 該條件下的 react 不提供 `useEffect`／`useRef`，import 一個 Hook 檔會在載入期就爆。
 * 故上報的**全部行為**放在這支無 React 相依的純模組，Hook 只做事件接線與生命週期
 * —— 那一層沒有分支可測，而這一層是 SC-021 的實際落點。
 */

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('T014：createProgressReporter', () => {
  it('未觸發 pagehide 時，節流上報仍於每 30 秒間隔落地（裝置休眠情境）', () => {
    let percent = 0;
    const send = vi.fn().mockResolvedValue(undefined);
    const reporter = createProgressReporter({
      getPercent: () => percent,
      send,
      intervalMs: 30_000,
    });

    percent = 10;
    vi.advanceTimersByTime(29_999);
    expect(send).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith(10);

    percent = 40;
    vi.advanceTimersByTime(30_000);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith(40);

    reporter.stop();
  });

  it('百分比無變化時不送出（同一個值只上報一次）', () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const reporter = createProgressReporter({ getPercent: () => 55, send, intervalMs: 30_000 });

    vi.advanceTimersByTime(90_000);
    expect(send).toHaveBeenCalledTimes(1);

    reporter.stop();
  });

  it('尚未就緒（getPercent 回 null）時完全不送出', () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const reporter = createProgressReporter({ getPercent: () => null, send, intervalMs: 30_000 });

    vi.advanceTimersByTime(120_000);
    reporter.flush();
    expect(send).not.toHaveBeenCalled();

    reporter.stop();
  });

  it('上報失敗被吞掉，不擲出也不產生未捕捉的 rejection（FR-012）', async () => {
    const rejected = vi.fn().mockRejectedValue(new Error('network down'));
    const reporter = createProgressReporter({
      getPercent: () => 12,
      send: rejected,
      intervalMs: 30_000,
    });

    expect(() => vi.advanceTimersByTime(30_000)).not.toThrow();
    expect(rejected).toHaveBeenCalledTimes(1);

    // 同步擲出的版本同樣不得逸出
    const thrown = vi.fn(() => {
      throw new Error('boom');
    });
    const reporter2 = createProgressReporter({
      getPercent: () => 34,
      send: thrown,
      intervalMs: 30_000,
    });
    expect(() => reporter2.flush()).not.toThrow();

    reporter.stop();
    reporter2.stop();
  });

  it('flush() 立即上報當下百分比（供 pagehide 呼叫）', () => {
    let percent = 3;
    const send = vi.fn().mockResolvedValue(undefined);
    const reporter = createProgressReporter({
      getPercent: () => percent,
      send,
      intervalMs: 30_000,
    });

    reporter.flush();
    expect(send).toHaveBeenCalledWith(3);

    percent = 77;
    reporter.flush();
    expect(send).toHaveBeenLastCalledWith(77);

    reporter.stop();
  });

  it('stop() 之後不再有任何上報', () => {
    let percent = 1;
    const send = vi.fn().mockResolvedValue(undefined);
    const reporter = createProgressReporter({
      getPercent: () => percent,
      send,
      intervalMs: 30_000,
    });

    reporter.stop();
    percent = 90;
    vi.advanceTimersByTime(300_000);
    reporter.flush();
    expect(send).not.toHaveBeenCalled();
  });
});
