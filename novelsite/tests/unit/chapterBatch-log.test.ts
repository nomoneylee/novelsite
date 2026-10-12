import { describe, expect, it, vi, afterEach } from 'vitest';
import { BATCH_RESULTS, logBatchEvent, type BatchLogInput } from '@/lib/chapterBatch/log';

/**
 * 批次紀錄的欄位白名單與結果聯集（FEAT-8 T008，FR-028／FR-028a）
 * ==============================================================
 * 比照 `tests/unit/audit.test.ts`／`chapterImport-log.test.ts`，
 * 以 `Object.keys(parsed).sort()` 鎖死欄位集合。
 */

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * **輸出恰 10 欄** ＝ 入參 8 欄 ＋ 函式自填的 `event`、`at`。
 *
 * **不是 9 欄**（實作裁示 2026-08-23）：9 是 FEAT-7 `chapter.import` 的數字，
 * 那邊的入參是 7 欄（`fileCount`／`totalBytes`）。本階段拿掉那兩欄、
 * 換上 `operation`／`chapterCount`／`ranges` 三欄，入參因此是 8 欄。
 * 三份 FEAT-8 文件把 9 連同「入參 7 欄」一起抄了過來，與它們自己宣告的介面互相矛盾。
 */
const FIELDS = [
  'actorId',
  'at',
  'chapterCount',
  'durationMs',
  'event',
  'novelId',
  'operation',
  'ranges',
  'result',
  'volumeId',
];

/** 一筆成功發佈的紀錄入參 */
function okInput(): BatchLogInput {
  return {
    actorId: 'user_1',
    novelId: 'novel_1',
    volumeId: 'vol_1',
    operation: 'publish',
    chapterCount: 12,
    ranges: '第 1–10、第 20–21 章',
    result: 'ok',
    durationMs: 137,
  };
}

describe('T008 logBatchEvent：輸出形狀', () => {
  it('輸出單行 JSON 且**恰含十個欄位**', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logBatchEvent(okInput());

    expect(spy).toHaveBeenCalledTimes(1);
    const output = spy.mock.calls[0][0] as string;
    expect(output.split('\n')).toHaveLength(1);

    const parsed = JSON.parse(output);
    expect(Object.keys(parsed).sort()).toEqual(FIELDS);
    expect(parsed).toHaveProperty('event', 'chapter.batch');
    expect(parsed).toHaveProperty('at');
    expect(parsed).toHaveProperty('actorId', 'user_1');
    expect(parsed).toHaveProperty('novelId', 'novel_1');
    expect(parsed).toHaveProperty('volumeId', 'vol_1');
    expect(parsed).toHaveProperty('operation', 'publish');
    expect(parsed).toHaveProperty('chapterCount', 12);
    expect(parsed).toHaveProperty('ranges', '第 1–10、第 20–21 章');
    expect(parsed).toHaveProperty('result', 'ok');
    expect(parsed).toHaveProperty('durationMs', 137);
  });

  it('actorId／novelId／volumeId 為 null 時該三欄仍出現在輸出中（值為 null，非省略）', () => {
    // 身分驗證之前的提前返回正是異常流量唯一的樣子；略過它們等於只記錄了正常使用者。
    // `volumeId` 一併納入（analyze 第二輪 2026-08-23／findings U3）：它在**未經 Zod 的
    // 請求主體**內，不像 FEAT-7 是路徑參數，未登入的出口取不到保證是字串的值
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logBatchEvent({
      actorId: null,
      novelId: null,
      volumeId: null,
      operation: 'publish',
      chapterCount: 0,
      ranges: '',
      result: 'unauthenticated',
      durationMs: 2,
    });

    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(Object.keys(parsed).sort()).toEqual(FIELDS);
    expect(parsed.actorId).toBeNull();
    expect(parsed.novelId).toBeNull();
    expect(parsed.volumeId).toBeNull();
  });

  it('入參尚未經 Zod 解析的出口：chapterCount 為 0、ranges 為空字串', () => {
    // 兩欄的對稱規定（analyze 第三輪 2026-08-23／findings U1）：那些出口的入參型別是
    // `unknown`，`input.chapterIds.length` 取不到 —— 沒訂就會各自寫成 `-1`／`NaN`／擲錯
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logBatchEvent({
      actorId: 'user_1',
      novelId: null,
      volumeId: null,
      operation: 'delete',
      chapterCount: 0,
      ranges: '',
      result: 'validation_error',
      durationMs: 1,
    });

    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed.chapterCount).toBe(0);
    expect(parsed.ranges).toBe('');
    expect(Object.keys(parsed).sort()).toEqual(FIELDS);
  });
});

describe('T008 logBatchEvent：白名單（FR-028）', () => {
  it('呼叫端誤傳 title／bodyMarkdown／chapterIds 時，輸出字串內不得出現其值', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const withExtraFields = {
      ...okInput(),
      title: '序章：廢墟少年',
      bodyMarkdown: '風從斷牆的缺口灌進來',
      chapterIds: ['ch_secret_1', 'ch_secret_2'],
    };

    logBatchEvent(withExtraFields);

    const output = spy.mock.calls[0][0] as string;
    expect(output).not.toContain('序章：廢墟少年');
    expect(output).not.toContain('風從斷牆的缺口灌進來');
    expect(output).not.toContain('ch_secret_1');
    expect(Object.keys(JSON.parse(output)).sort()).toEqual(FIELDS);
  });
});

describe('T008 BATCH_RESULTS：結果聯集恰為 8 個值', () => {
  it('值的集合鎖死', () => {
    // **以陣列為真相來源、型別自其推導**（沿用 FEAT-7 `PREVIEW_VERDICTS` 的手法）：
    // 型別在執行期不存在，若另外手寫一份陣列供比對，兩份必然分岔
    expect([...BATCH_RESULTS].sort()).toEqual(
      [
        'conflict',
        'forbidden',
        'internal_error',
        'not_found',
        'notify_failed',
        'ok',
        'unauthenticated',
        'validation_error',
      ].sort()
    );
  });

  it('恰 8 個值（原記 7 個，analyze 修正 2026-08-22／findings I1 補入 `conflict`）', () => {
    // 少了 `conflict`，交易寫入衝突只能記成 `internal_error`，與「程式壞了」不可區分
    expect(BATCH_RESULTS).toHaveLength(8);
    expect(BATCH_RESULTS).toContain('conflict');
  });

  it('無重複值', () => {
    expect(new Set(BATCH_RESULTS).size).toBe(BATCH_RESULTS.length);
  });
});
