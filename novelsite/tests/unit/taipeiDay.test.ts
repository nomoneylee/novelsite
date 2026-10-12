import { describe, expect, it } from 'vitest';
import {
  TAIPEI_OFFSET_MS,
  taipeiDayStart,
  taipeiDayRange,
  taipeiDaysBetween,
  yesterdayTaipei,
} from '@/lib/time/taipeiDay';

/**
 * T084：台北日界線（contracts/internal-modules.md §3、research R-2、FR-036b）
 * ==========================================================================
 * 這個模組是整個統計域唯一的「哪一天」定義。彙總只處理已結束的日期、回補要逐日列出、
 * 成效期間要對齊日界 —— 三者都靠它，錯一毫秒就是整批數字歸到隔壁那一天。
 *
 * **為何整檔不出現 `Intl` 與 `toLocaleString`**：台灣自 1980 年起無日光節約時間，
 * 台北恆為 UTC+8，故正確實作是固定偏移的純算術；而 `Intl` 的時區支援取決於 Node 建置的
 * ICU 資料，`small-icu` 建置會**靜默退化為 UTC**（research R-2）——
 * 那種錯誤在開發機上永遠不出現，只在部署環境把每一天都平移八小時。
 * 本檔的每一個期望值都是手算的 UTC 絕對時刻，不經任何時區 API 產生；
 * 用 `Intl` 算期望值等於拿被測物去驗被測物。
 *
 * **語意約定**（本檔即為其規格，實作 MUST 照此）：
 *  - `taipeiDayStart(at)` → `at` 所屬台北日的 00:00 對應的 UTC 絕對時刻
 *  - `taipeiDayRange(day)` → `{ start, end }`，`end` 為**開區間上界**（start + 24h），
 *    查詢寫作 `viewedAt >= start AND viewedAt < end`；用閉區間會使 23:59:59.999 之後的
 *    那一毫秒同時落在兩天
 *  - `taipeiDaysBetween(from, to)` → 兩端**皆含**的日起點陣列，入參為任意時刻（自動正規化）
 *  - `yesterdayTaipei(now)` → 「已結束的最後一天」的日起點
 */

/** 手算的 UTC 絕對時刻常數，MUST NOT 由任何時區 API 產生 */
const D = (iso: string) => new Date(iso);
const DAY_MS = 24 * 3_600_000;

describe('TAIPEI_OFFSET_MS', () => {
  it('恆為 +8 小時的毫秒數（固定偏移，不隨日期變動）', () => {
    expect(TAIPEI_OFFSET_MS).toBe(8 * 3_600_000);
    expect(TAIPEI_OFFSET_MS).toBe(28_800_000);
  });
});

describe('taipeiDayStart：UTC 16:00 的日界線', () => {
  /**
   * 邊界的兩側各差一毫秒，卻分屬**不同的兩天** —— 這一對是整個模組的核心斷言。
   * 用 UTC 的午夜當日界（最容易寫錯的實作）會讓這兩筆落在同一天。
   */
  it('UTC 15:59:59.999 屬前一個台北日', () => {
    expect(taipeiDayStart(D('2026-08-07T15:59:59.999Z')).toISOString()).toBe(
      '2026-08-06T16:00:00.000Z'
    );
  });

  it('UTC 16:00:00.000 起屬新的台北日（其本身即為該日的起點）', () => {
    expect(taipeiDayStart(D('2026-08-07T16:00:00.000Z')).toISOString()).toBe(
      '2026-08-07T16:00:00.000Z'
    );
  });

  it('同一台北日內的任何時刻皆回同一個起點（冪等）', () => {
    const start = taipeiDayStart(D('2026-08-07T16:00:00.000Z'));
    for (const at of [
      '2026-08-07T16:00:00.001Z',
      '2026-08-07T20:00:00.000Z',
      '2026-08-08T00:00:00.000Z',
      '2026-08-08T15:59:59.999Z',
    ]) {
      expect(taipeiDayStart(D(at)).getTime()).toBe(start.getTime());
    }
    // 對自己的輸出再取一次仍為同值 —— 回補迴圈會反覆這樣呼叫
    expect(taipeiDayStart(start).getTime()).toBe(start.getTime());
  });

  it('UTC 午夜（台北早上 8 點）仍屬同一個台北日，MUST NOT 被當成新的一天', () => {
    // 這一筆是「誤用 UTC 午夜當日界」的專屬探針：那種實作會在此回傳 2026-08-08T00:00:00Z
    expect(taipeiDayStart(D('2026-08-08T00:00:00.000Z')).toISOString()).toBe(
      '2026-08-07T16:00:00.000Z'
    );
  });

  it('跨月：UTC 8/31 16:00 起為台北 9/1', () => {
    expect(taipeiDayStart(D('2026-08-31T15:59:59.999Z')).toISOString()).toBe(
      '2026-08-30T16:00:00.000Z'
    );
    expect(taipeiDayStart(D('2026-08-31T16:00:00.000Z')).toISOString()).toBe(
      '2026-08-31T16:00:00.000Z'
    );
  });

  it('跨年：UTC 12/31 16:00 起為台北隔年 1/1', () => {
    expect(taipeiDayStart(D('2026-12-31T15:59:59.999Z')).toISOString()).toBe(
      '2026-12-30T16:00:00.000Z'
    );
    expect(taipeiDayStart(D('2026-12-31T16:00:00.000Z')).toISOString()).toBe(
      '2026-12-31T16:00:00.000Z'
    );
  });

  it('不修改入參（呼叫端會把同一個 Date 傳給多個函式）', () => {
    const at = D('2026-08-07T15:59:59.999Z');
    const before = at.getTime();
    taipeiDayStart(at);
    expect(at.getTime()).toBe(before);
  });
});

describe('taipeiDayRange：單日的查詢區間', () => {
  it('start 為該日起點、end 為隔日起點（開區間上界），寬度恰為 24 小時', () => {
    const { start, end } = taipeiDayRange(D('2026-08-07T20:00:00.000Z'));
    expect(start.toISOString()).toBe('2026-08-07T16:00:00.000Z');
    expect(end.toISOString()).toBe('2026-08-08T16:00:00.000Z');
    expect(end.getTime() - start.getTime()).toBe(DAY_MS);
  });

  it('入參為任意時刻皆正規化到日起點（呼叫端不必先自行對齊）', () => {
    const a = taipeiDayRange(D('2026-08-07T16:00:00.000Z'));
    const b = taipeiDayRange(D('2026-08-08T15:59:59.999Z'));
    expect(a.start.getTime()).toBe(b.start.getTime());
    expect(a.end.getTime()).toBe(b.end.getTime());
  });

  it('相鄰兩日的區間首尾相接且不重疊：前一日的 end 恰為次日的 start', () => {
    const first = taipeiDayRange(D('2026-08-07T16:00:00.000Z'));
    const second = taipeiDayRange(D('2026-08-08T16:00:00.000Z'));
    expect(first.end.getTime()).toBe(second.start.getTime());
    // 上界為開區間：邊界那一毫秒只屬於次日
    expect(taipeiDayStart(first.end).getTime()).toBe(second.start.getTime());
  });
});

describe('taipeiDaysBetween：回補用的逐日序列', () => {
  it('兩端皆含，逐日遞增且無空洞（連續四日）', () => {
    const days = taipeiDaysBetween(D('2026-08-04T16:00:00.000Z'), D('2026-08-07T16:00:00.000Z'));
    expect(days.map((d) => d.toISOString())).toEqual([
      '2026-08-04T16:00:00.000Z',
      '2026-08-05T16:00:00.000Z',
      '2026-08-06T16:00:00.000Z',
      '2026-08-07T16:00:00.000Z',
    ]);
  });

  it('入參為任意時刻時先正規化，序列內容與傳日起點時相同', () => {
    const days = taipeiDaysBetween(D('2026-08-04T23:12:34.567Z'), D('2026-08-07T09:00:00.000Z'));
    expect(days.map((d) => d.toISOString())).toEqual([
      '2026-08-04T16:00:00.000Z',
      '2026-08-05T16:00:00.000Z',
      '2026-08-06T16:00:00.000Z',
    ]);
  });

  it('同一天 → 恰一個元素（彙總只落後一日時的常態）', () => {
    const days = taipeiDaysBetween(D('2026-08-07T18:00:00.000Z'), D('2026-08-08T02:00:00.000Z'));
    expect(days).toHaveLength(1);
    expect(days[0].toISOString()).toBe('2026-08-07T16:00:00.000Z');
  });

  it('from 晚於 to → 空陣列，MUST NOT 擲出（起點取 min(…, 昨日) 時本就可能反序）', () => {
    expect(taipeiDaysBetween(D('2026-08-09T16:00:00.000Z'), D('2026-08-07T16:00:00.000Z'))).toEqual(
      []
    );
  });

  it('跨月：8/30 → 9/1 共三日，日界不因月長而漂移', () => {
    const days = taipeiDaysBetween(D('2026-08-29T16:00:00.000Z'), D('2026-08-31T16:00:00.000Z'));
    expect(days.map((d) => d.toISOString())).toEqual([
      '2026-08-29T16:00:00.000Z', // 台北 8/30
      '2026-08-30T16:00:00.000Z', // 台北 8/31
      '2026-08-31T16:00:00.000Z', // 台北 9/1
    ]);
  });

  it('跨年：台北 2026/12/31 → 2027/1/2 共三日', () => {
    const days = taipeiDaysBetween(D('2026-12-30T16:00:00.000Z'), D('2027-01-01T16:00:00.000Z'));
    expect(days.map((d) => d.toISOString())).toEqual([
      '2026-12-30T16:00:00.000Z', // 台北 2026/12/31
      '2026-12-31T16:00:00.000Z', // 台北 2027/1/1
      '2027-01-01T16:00:00.000Z', // 台北 2027/1/2
    ]);
  });

  it('長區間（30 日）逐日相差恰 24 小時，無重複無跳號', () => {
    const from = D('2026-07-08T16:00:00.000Z');
    const to = D('2026-08-06T16:00:00.000Z');
    const days = taipeiDaysBetween(from, to);
    expect(days).toHaveLength(30);
    for (let i = 1; i < days.length; i++) {
      expect(days[i].getTime() - days[i - 1].getTime()).toBe(DAY_MS);
    }
    expect(new Set(days.map((d) => d.getTime())).size).toBe(30);
  });
});

describe('yesterdayTaipei：已結束的最後一天', () => {
  it('回傳今日起點的前一日起點', () => {
    expect(yesterdayTaipei(D('2026-08-07T18:00:00.000Z')).toISOString()).toBe(
      '2026-08-06T16:00:00.000Z'
    );
  });

  it('剛跨過日界線的那一毫秒，昨日即為剛結束的那一天', () => {
    // 台北 8/8 00:00:00.000 → 昨日為台北 8/7（起點 UTC 8/6 16:00）
    expect(yesterdayTaipei(D('2026-08-07T16:00:00.000Z')).toISOString()).toBe(
      '2026-08-06T16:00:00.000Z'
    );
    // 日界線前一毫秒仍在台北 8/7 → 昨日為台北 8/6
    expect(yesterdayTaipei(D('2026-08-07T15:59:59.999Z')).toISOString()).toBe(
      '2026-08-05T16:00:00.000Z'
    );
  });

  it('昨日恆早於今日起點，且相差恰一日（FR-036b：當日 MUST NOT 建列）', () => {
    const now = D('2026-08-07T18:00:00.000Z');
    const today = taipeiDayStart(now);
    const yesterday = yesterdayTaipei(now);
    expect(yesterday.getTime()).toBeLessThan(today.getTime());
    expect(today.getTime() - yesterday.getTime()).toBe(DAY_MS);
  });

  it('與 taipeiDaysBetween 串起來的回補序列不含今日', () => {
    const now = D('2026-08-07T18:00:00.000Z'); // 台北 8/8 02:00
    const days = taipeiDaysBetween(D('2026-08-04T16:00:00.000Z'), yesterdayTaipei(now));
    const todayStart = taipeiDayStart(now).getTime();
    expect(days.length).toBeGreaterThan(0);
    expect(days.some((d) => d.getTime() >= todayStart)).toBe(false);
    expect(days[days.length - 1].toISOString()).toBe('2026-08-06T16:00:00.000Z');
  });

  it('跨年：台北 2027/1/1 的昨日為 2026/12/31', () => {
    expect(yesterdayTaipei(D('2026-12-31T20:00:00.000Z')).toISOString()).toBe(
      '2026-12-30T16:00:00.000Z'
    );
  });
});
