import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { runReaderStateMerge, READER_LOCAL_KEYS } from '@/lib/reader/readerStateMerge';

/**
 * T015b：登入時的本機資料合併（SC-002、FR-015b、FR-016a）
 * ========================================================
 * **SC-002 的後半（本機為空、再次登入不再觸發）先前零驗證**：T011 是伺服器端整合測試，
 * 看不見 `localStorage`；T147 的 E2E 不走合併路徑。
 *
 * 測的是 `lib/reader/readerStateMerge`，即 `useReaderStateMerge`（T037）**全部的判斷**
 * ——觸發、截斷、Toast、2xx 後才清除都在這裡；Hook 只做「掛載時呼叫一次」的接線。
 * 單元套件以 `react-server` 條件執行，該條件下的 react 不提供 `useEffect`，
 * 直接 import Hook 檔會在載入期就爆（見 `vitest.config.mts` 註解）。
 */

type Store = Map<string, string>;

function fakeStorage(initial: Record<string, string> = {}) {
  const map: Store = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

const HISTORY_ENTRY = (novelId: string, readAt: string) => ({
  novelId,
  novelTitle: `作品 ${novelId}`,
  coverColor: 'linear-gradient(135deg,#000,#111)',
  chapterId: `${novelId}-ch1`,
  chapterTitle: '第 1 章',
  readAt,
});

function okResponse(body: unknown = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      merged: { bookshelf: 0, history: 0, preference: 0 },
      skipped: { bookshelf: 0, history: 0 },
      truncated: { bookshelf: false, history: false },
      ...(body as object),
    }),
  } as unknown as Response;
}

let notify: Mock<(message: string) => void>;

beforeEach(() => {
  notify = vi.fn<(message: string) => void>();
});

describe('T015b（1）觸發判定', () => {
  it('未登入 → 不送出', async () => {
    const storage = fakeStorage({ [READER_LOCAL_KEYS.bookshelf]: JSON.stringify(['a']) });
    const fetchImpl = vi.fn();

    const outcome = await runReaderStateMerge({
      loggedIn: false,
      storage,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      batchMax: 200,
      notify,
    });

    expect(outcome).toBe('skipped');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('已登入但書架與歷史兩鍵皆空 → 不送出（即使偏好與主題兩鍵有值）', async () => {
    const storage = fakeStorage({
      [READER_LOCAL_KEYS.bookshelf]: JSON.stringify([]),
      [READER_LOCAL_KEYS.history]: JSON.stringify([]),
      [READER_LOCAL_KEYS.prefs]: JSON.stringify({ fontSize: 'lg', distractionFree: false }),
      [READER_LOCAL_KEYS.theme]: 'dark',
    });
    const fetchImpl = vi.fn();

    const outcome = await runReaderStateMerge({
      loggedIn: true,
      storage,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      batchMax: 200,
      notify,
    });

    expect(outcome).toBe('skipped');
    expect(fetchImpl, '乙類鍵在登入態被持續回寫，納入觸發判定會使冪等恆假').not.toHaveBeenCalled();
  });

  it.each([
    ['只有書架有值', { [READER_LOCAL_KEYS.bookshelf]: JSON.stringify(['a']) }],
    [
      '只有歷史有值',
      {
        [READER_LOCAL_KEYS.history]: JSON.stringify([
          HISTORY_ENTRY('a', '2026-08-01T00:00:00.000Z'),
        ]),
      },
    ],
  ])('%s → 送出恰一次', async (_label, initial) => {
    const storage = fakeStorage(initial);
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());

    const outcome = await runReaderStateMerge({
      loggedIn: true,
      storage,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      batchMax: 200,
      notify,
    });

    expect(outcome).toBe('merged');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('/api/reader-state/merge');
    expect((init as RequestInit).method).toBe('POST');
  });

  it('酬載同時帶上偏好與主題兩個鍵（主題不與字級同鍵，漏掉則 theme 沒有寫入端）', async () => {
    const storage = fakeStorage({
      [READER_LOCAL_KEYS.bookshelf]: JSON.stringify(['a']),
      [READER_LOCAL_KEYS.prefs]: JSON.stringify({ fontSize: 'lg', distractionFree: true }),
      [READER_LOCAL_KEYS.theme]: 'eyecare',
    });
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());

    await runReaderStateMerge({
      loggedIn: true,
      storage,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      batchMax: 200,
      notify,
    });

    const body = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string);
    expect(body.preference).toEqual({ fontSize: 'lg', theme: 'eyecare' });
    expect(body.preference, '無干擾模式明訂不跨章節記憶，MUST NOT 同步').not.toHaveProperty(
      'distractionFree'
    );
    expect(body.bookshelf).toEqual(['a']);
  });
});

describe('T015b（2）清除時機', () => {
  const initial = {
    [READER_LOCAL_KEYS.bookshelf]: JSON.stringify(['a', 'b']),
    [READER_LOCAL_KEYS.history]: JSON.stringify([HISTORY_ENTRY('a', '2026-08-01T00:00:00.000Z')]),
    [READER_LOCAL_KEYS.prefs]: JSON.stringify({ fontSize: 'sm', distractionFree: false }),
    [READER_LOCAL_KEYS.theme]: 'dark',
  };

  it('2xx 後只清除書架與歷史；偏好與主題兩鍵保留（首次繪製的防閃爍來源）', async () => {
    const storage = fakeStorage(initial);
    const outcome = await runReaderStateMerge({
      loggedIn: true,
      storage,
      fetchImpl: vi.fn().mockResolvedValue(okResponse()) as unknown as typeof fetch,
      batchMax: 200,
      notify,
    });

    expect(outcome).toBe('merged');
    expect(storage.getItem(READER_LOCAL_KEYS.bookshelf)).toBeNull();
    expect(storage.getItem(READER_LOCAL_KEYS.history)).toBeNull();
    expect(storage.getItem(READER_LOCAL_KEYS.prefs)).toBe(initial[READER_LOCAL_KEYS.prefs]);
    expect(storage.getItem(READER_LOCAL_KEYS.theme)).toBe('dark');
  });

  it('回應非 2xx → 四個鍵全數留存（下次登入續行）', async () => {
    const storage = fakeStorage(initial);
    const outcome = await runReaderStateMerge({
      loggedIn: true,
      storage,
      fetchImpl: vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
      }) as unknown as typeof fetch,
      batchMax: 200,
      notify,
    });

    expect(outcome).toBe('failed');
    for (const key of Object.values(READER_LOCAL_KEYS)) {
      expect(storage.getItem(key), key).not.toBeNull();
    }
  });

  it('fetch 擲錯 → 四個鍵全數留存，且不向外擲出', async () => {
    const storage = fakeStorage(initial);
    const outcome = await runReaderStateMerge({
      loggedIn: true,
      storage,
      fetchImpl: vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch,
      batchMax: 200,
      notify,
    });

    expect(outcome).toBe('failed');
    for (const key of Object.values(READER_LOCAL_KEYS)) {
      expect(storage.getItem(key), key).not.toBeNull();
    }
  });
});

describe('T015b（3）不重複觸發（SC-002 末句）', () => {
  it('成功一次後再次執行 → 不送出', async () => {
    const storage = fakeStorage({
      [READER_LOCAL_KEYS.bookshelf]: JSON.stringify(['a']),
      [READER_LOCAL_KEYS.prefs]: JSON.stringify({ fontSize: 'lg' }),
      [READER_LOCAL_KEYS.theme]: 'dark',
    });
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    const deps = {
      loggedIn: true,
      storage,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      batchMax: 200,
      notify,
    };

    expect(await runReaderStateMerge(deps)).toBe('merged');
    expect(await runReaderStateMerge(deps)).toBe('skipped');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('失敗後再次執行 → 會重試（本機資料仍在）', async () => {
    const storage = fakeStorage({ [READER_LOCAL_KEYS.bookshelf]: JSON.stringify(['a']) });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) })
      .mockResolvedValueOnce(okResponse());
    const deps = {
      loggedIn: true,
      storage,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      batchMax: 200,
      notify,
    };

    expect(await runReaderStateMerge(deps)).toBe('failed');
    expect(await runReaderStateMerge(deps)).toBe('merged');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('T015b（4）截斷告知（FR-016a：MUST NOT 靜默捨棄）', () => {
  it('超過上限時依時間取最近者截斷，並在酬載標示 truncated', async () => {
    const history = [
      HISTORY_ENTRY('old', '2026-01-01T00:00:00.000Z'),
      HISTORY_ENTRY('new', '2026-08-01T00:00:00.000Z'),
      HISTORY_ENTRY('mid', '2026-04-01T00:00:00.000Z'),
    ];
    const storage = fakeStorage({
      [READER_LOCAL_KEYS.bookshelf]: JSON.stringify(['n1', 'n2', 'n3']),
      [READER_LOCAL_KEYS.history]: JSON.stringify(history),
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(okResponse({ truncated: { bookshelf: true, history: true } }));

    await runReaderStateMerge({
      loggedIn: true,
      storage,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      batchMax: 2,
      notify,
    });

    const body = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string);
    expect(body.history).toHaveLength(2);
    expect(body.history.map((h: { novelId: string }) => h.novelId)).toEqual(['new', 'mid']);
    expect(body.bookshelf).toHaveLength(2);
    expect(body.bookshelf, '書架本機無時間戳，最近加入者在陣列尾端').toEqual(['n2', 'n3']);
    expect(body.truncated).toEqual({ bookshelf: true, history: true });
  });

  it('伺服器回 truncated: true → 呼叫 Toast 告知使用者', async () => {
    const storage = fakeStorage({ [READER_LOCAL_KEYS.bookshelf]: JSON.stringify(['a', 'b', 'c']) });

    await runReaderStateMerge({
      loggedIn: true,
      storage,
      fetchImpl: vi
        .fn()
        .mockResolvedValue(
          okResponse({ truncated: { bookshelf: true, history: false } })
        ) as unknown as typeof fetch,
      batchMax: 1,
      notify,
    });

    expect(notify).toHaveBeenCalledTimes(1);
    expect(String(notify.mock.calls[0][0])).toContain('未同步');
  });

  it('未截斷時不打擾使用者', async () => {
    const storage = fakeStorage({ [READER_LOCAL_KEYS.bookshelf]: JSON.stringify(['a']) });

    await runReaderStateMerge({
      loggedIn: true,
      storage,
      fetchImpl: vi.fn().mockResolvedValue(okResponse()) as unknown as typeof fetch,
      batchMax: 200,
      notify,
    });

    expect(notify).not.toHaveBeenCalled();
  });
});
