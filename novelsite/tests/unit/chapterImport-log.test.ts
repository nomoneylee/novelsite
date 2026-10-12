import { describe, expect, it, vi, afterEach } from 'vitest';
import { logImportEvent } from '@/lib/chapterImport/log';

/**
 * 匯入紀錄的欄位白名單（FEAT-7 T009，FR-016b／FR-016d）
 * ======================================================
 * 比照 `tests/unit/audit.test.ts` 以 `Object.keys(parsed).sort()` 鎖死欄位集合。
 */

afterEach(() => {
  vi.restoreAllMocks();
});

const FIELDS = [
  'actorId',
  'at',
  'durationMs',
  'event',
  'fileCount',
  'novelId',
  'result',
  'totalBytes',
  'volumeId',
];

describe('logImportEvent', () => {
  it('輸出單行 JSON 且**恰含九個欄位**', () => {
    // 七是入參的欄位數，不是輸出的欄位數 —— `event` 與 `at` 由函式自填
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logImportEvent({
      actorId: 'user_1',
      novelId: 'novel_1',
      volumeId: 'vol_1',
      fileCount: 5,
      totalBytes: 12_840,
      result: 'ok',
      durationMs: 137,
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const output = spy.mock.calls[0][0] as string;
    expect(output.split('\n')).toHaveLength(1);

    const parsed = JSON.parse(output);
    expect(Object.keys(parsed).sort()).toEqual(FIELDS);
    expect(parsed).toHaveProperty('event', 'chapter.import');
    expect(parsed).toHaveProperty('at');
    expect(parsed).toHaveProperty('actorId', 'user_1');
    expect(parsed).toHaveProperty('novelId', 'novel_1');
    expect(parsed).toHaveProperty('volumeId', 'vol_1');
    expect(parsed).toHaveProperty('fileCount', 5);
    expect(parsed).toHaveProperty('totalBytes', 12_840);
    expect(parsed).toHaveProperty('result', 'ok');
    expect(parsed).toHaveProperty('durationMs', 137);
  });

  it('actorId／novelId 為 null 時該兩欄仍出現在輸出中（值為 null，非省略）', () => {
    // 身分驗證之前的提前返回正是異常流量唯一的樣子；略過它們等於只記錄了正常使用者
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logImportEvent({
      actorId: null,
      novelId: null,
      volumeId: 'vol_1',
      fileCount: 0,
      totalBytes: 0,
      result: 'origin_rejected',
      durationMs: 2,
    });

    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(Object.keys(parsed).sort()).toEqual(FIELDS);
    expect(parsed.actorId).toBeNull();
    expect(parsed.novelId).toBeNull();
  });

  it('傳入含 filename／bodyMarkdown／title 的物件時，輸出字串內不得出現其值（FR-016d）', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const withExtraFields = {
      actorId: 'user_1',
      novelId: 'novel_1',
      volumeId: 'vol_1',
      fileCount: 1,
      totalBytes: 100,
      result: 'ok' as const,
      durationMs: 1,
      filename: '第1章_序章：廢墟少年.md',
      bodyMarkdown: '風從斷牆的缺口灌進來',
      title: '序章：廢墟少年',
    };

    logImportEvent(withExtraFields);

    const output = spy.mock.calls[0][0] as string;
    expect(output).not.toContain('第1章_序章：廢墟少年.md');
    expect(output).not.toContain('風從斷牆的缺口灌進來');
    expect(output).not.toContain('序章：廢墟少年');
    expect(Object.keys(JSON.parse(output)).sort()).toEqual(FIELDS);
  });
});
