/**
 * 登入時的本機資料合併（FEAT-4 4-A / T037 的核心，FR-015／FR-015b／FR-016a）
 * ============================================================================
 * 觸發判定、截斷、告知、清除時機全部在這裡；`useReaderStateMerge` 只負責
 * 「掛載時呼叫一次」。無 React 相依，故可用假的 `localStorage` 與假的 `fetch` 直接驗。
 */

import { apiUrl } from '@/lib/apiUrl';

/**
 * 四個本機鍵，**分兩類**（contracts/reader-state-api.md §5 的 2026-08-07 第四輪裁示）：
 *
 * - **甲（`bookshelf`／`history`）**：納入觸發判定，合併成功後**清除**。
 *   它們在登入態不被任何 Hook 回寫（`useBookshelf`／`useReadingHistory` 登入後只走 API），
 *   清除後即恆為空 —— FR-015b 的冪等由此自然成立。
 * - **乙（`prefs`／`theme`）**：隨附上傳，但 **MUST NOT** 納入觸發判定、**MUST NOT** 清除。
 *   它們在登入態是離線快取與首次繪製的防閃爍來源（`useTheme` 必須在 hydration 前
 *   讀到值，否則每次載入先閃一次錯誤主題）。把它們納入觸發判定，等於讓合併
 *   每次登入都被自己回寫的快取重新命中，「下次登入不再觸發」恆假。
 */
export const READER_LOCAL_KEYS = {
  bookshelf: 'novelsite-bookshelf',
  history: 'novelsite-reading-history',
  prefs: 'novelsite-reader-prefs',
  theme: 'novelsite-theme',
} as const;

/** 觸發判定與清除只涵蓋這兩個鍵 */
const TRIGGER_KEYS = [READER_LOCAL_KEYS.bookshelf, READER_LOCAL_KEYS.history] as const;

// 前綴在常數這一層補上（FR-074）——理由同 `preferenceApi.ts`。
// 漏掉的症狀：子路徑部署下登入時的本機資料合併永遠失敗，
// 而使用者看到的只是「登入後書架是空的」
export const MERGE_ENDPOINT = apiUrl('/api/reader-state/merge');

export interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

export interface MergeDeps {
  loggedIn: boolean;
  storage: StorageLike;
  fetchImpl: typeof fetch;
  /** `MERGE_BATCH_MAX`（預設 200）。超出時由客戶端先截斷 */
  batchMax: number;
  /** 截斷時告知使用者（既有 Toast）。MUST NOT 靜默捨棄（FR-016a） */
  notify: (message: string) => void;
}

export type MergeOutcome = 'skipped' | 'merged' | 'failed';

interface LocalHistoryEntry {
  novelId: string;
  chapterId: string;
  readAt: string;
}

function readJson<T>(storage: StorageLike, key: string, fallback: T): T {
  const raw = storage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // 壞掉的本機資料不該讓登入流程整個停住
    return fallback;
  }
}

function collectHistory(storage: StorageLike): LocalHistoryEntry[] {
  const entries = readJson<Partial<LocalHistoryEntry>[]>(storage, READER_LOCAL_KEYS.history, []);
  return entries
    .filter((e): e is LocalHistoryEntry => Boolean(e?.novelId && e?.chapterId && e?.readAt))
    .map((e) => ({ novelId: e.novelId, chapterId: e.chapterId, readAt: e.readAt }));
}

function collectPreference(
  storage: StorageLike
): { fontSize?: string; theme?: string } | undefined {
  // 字級與主題分屬兩個鍵：主題自始由全站的 useTheme 獨立管理，不在 reader-prefs 裡。
  // 漏掉 `novelsite-theme` 的話 `theme` 就沒有寫入端（T036／T037 的第四輪裁示）
  const prefs = readJson<{ fontSize?: string }>(storage, READER_LOCAL_KEYS.prefs, {});
  const theme = storage.getItem(READER_LOCAL_KEYS.theme) ?? undefined;

  const preference: { fontSize?: string; theme?: string } = {};
  if (prefs.fontSize) preference.fontSize = prefs.fontSize;
  if (theme) preference.theme = theme;

  return Object.keys(preference).length > 0 ? preference : undefined;
}

/**
 * 執行一次合併。
 *
 * 回傳 `'skipped'`（無事可做）／`'merged'`（已同步並清除甲類鍵）／
 * `'failed'`（四個鍵全數留存，下次登入續行）。**不擲出** ——
 * 合併是登入的附帶行為，失敗不該讓使用者看到一個壞掉的頁面。
 */
export async function runReaderStateMerge(deps: MergeDeps): Promise<MergeOutcome> {
  const { loggedIn, storage, fetchImpl, batchMax, notify } = deps;
  if (!loggedIn) return 'skipped';

  const bookshelfAll = readJson<string[]>(storage, READER_LOCAL_KEYS.bookshelf, []);
  const historyAll = collectHistory(storage);
  if (bookshelfAll.length === 0 && historyAll.length === 0) return 'skipped';

  // 截斷一律「取最近者」。書架本機無時間戳（純識別碼陣列），
  // 最近加入者在陣列尾端（`useBookshelf` 以 append 寫入），故取尾端 N 筆。
  const bookshelf = bookshelfAll.slice(-batchMax);
  const history = [...historyAll]
    .sort((a, b) => Date.parse(b.readAt) - Date.parse(a.readAt))
    .slice(0, batchMax);

  const truncated = {
    bookshelf: bookshelfAll.length > bookshelf.length,
    history: historyAll.length > history.length,
  };

  let response: Response;
  try {
    response = await fetchImpl(MERGE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bookshelf,
        history,
        preference: collectPreference(storage),
        truncated,
      }),
    });
  } catch {
    return 'failed';
  }

  // 清除 MUST NOT 早於伺服器確認寫入成功（FR-015b）
  if (!response.ok) return 'failed';

  for (const key of TRIGGER_KEYS) storage.removeItem(key);

  const result = (await response.json().catch(() => null)) as {
    truncated?: { bookshelf?: boolean; history?: boolean };
  } | null;

  if (result?.truncated?.bookshelf || result?.truncated?.history) {
    notify('本機資料較多，僅同步了最近的部分，其餘未同步');
  }

  return 'merged';
}
