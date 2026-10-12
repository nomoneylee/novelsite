import { MAX_LENGTH } from '@/lib/validation/common';
import { IMPORT_LIMITS } from '@/lib/validation/chapterImport';

/**
 * 批次匯入的解析與判定（純函式，client / server 共用）
 * ======================================================
 * **MUST NOT `import 'server-only'`**，MUST NOT 引用 repository、Prisma 或任何 Node 專屬 API。
 * 這一條是硬需求：本檔要能被 client component 引用，而那正是 FR-002c 的全部意義 ——
 * 前端預覽與伺服器重驗跑的是同一份實作，杜絕「前端說可以、伺服器說不行」的漂移。
 *
 * **對外的單一入口是 `gradePreview()`，不是下層的 `detect*` primitives**
 * （contracts/internal-modules.md §1、data-model §3 表末列）：primitives 各自正確，
 * 不代表**串接順序與級別判定**也一致 —— 兩邊各串一次，漂移就從「哪一種問題先報」開始，
 * 而那不會讓任何測試變紅。
 */

// ─────────────────────────────────────────────
// 型別（形狀見 data-model §2.1／§2.2／§2.3）
//
// **歸屬模組是這裡**：前端面板與服務層皆 `import type` 自本檔，
// MUST NOT 各自就地宣告一份 —— TypeScript 不會為結構相同的兩份宣告報錯，
// 於是「前後端共用同一份判定」會在型別層先破掉。
// ─────────────────────────────────────────────

export interface ParsedChapterFile {
  /** 來源檔名，NFC 正規化後 */
  filename: string;
  /**
   * `File.webkitRelativePath`（資料夾選取模式）；多檔選取模式為 `''`。
   * `IN_SUBDIRECTORY` 判定的唯一依據（research R-13）
   */
  relativePath: string;
  /** 位元組數（上限判定用，非字元數） */
  byteSize: number;
  /** 解析成功時的章號；解析失敗為 null */
  number: number | null;
  /** 解析成功時的標題；解析失敗為 null */
  title: string | null;
  /** UTF-8 解碼並淨化後的正文；解碼失敗為 null */
  body: string | null;
  /** `countWords(body)`；`body` 為 null 時為 0 */
  wordCount: number;
}

/**
 * **12 種**判定代碼，一列恰有一個。
 *
 * **以陣列為真相來源、型別自其推導**：T037(b) 的聯集鎖死案要斷言代碼恰為 12 個，
 * 而型別在執行期不存在。兩者分開宣告時，新增一個代碼只會讓其中一份變動 ——
 * 推導使兩者不可能分岔。
 *
 * **聯集 MUST 恰為這 12 個**：不得新增任何表達「章號落在其他卷既有章號區間內」的代碼
 * （FR-022a 明訂 MUST NOT 判斷跨卷交錯）。這是 FR-022a 唯一落在編譯器手上的守衛。
 *
 * **12 而非 13**（FEAT-7 第五輪 analyze，2026-08-21）：
 * - `DIRECTORY` → `IN_SUBDIRECTORY`：`webkitdirectory` 交出的 `FileList` 只含檔案、
 *   不含目錄項目，且 `ParsedChapterFile` 沒有任何欄位能表達「這是目錄」——
 *   **型別上就回不了那個值**（research R-13）。
 * - `NUMBER_GAP` 移除：缺號是**序列**的性質，掛不到任何一個來源檔上，
 *   只出現在 `ImportPreview.summary.gaps`（FR-022）。
 */
export const PREVIEW_VERDICTS = [
  'OK',
  'FILENAME_MISMATCH',
  'INVALID_NUMBER',
  'ENCODING',
  'TITLE_TOO_LONG',
  'BODY_TOO_LONG',
  'DUPLICATE_IN_BATCH',
  'CONFLICT_EXISTING',
  'FILE_TOO_LARGE',
  'EMPTY_BODY',
  'NOT_MARKDOWN',
  'IN_SUBDIRECTORY',
] as const;

export type PreviewVerdict = (typeof PREVIEW_VERDICTS)[number];

/** 判定級別。`NOT_MARKDOWN` 是唯一會依 `PickMode` 變級別的代碼（FR-001c） */
export type PreviewLevel = 'ok' | 'warning' | 'error' | 'skipped';

export interface ImportPreview {
  rows: Array<ParsedChapterFile & { verdict: PreviewVerdict }>;
  summary: {
    /**
     * 可匯入章數 ＝ 級別為 `ok` 與 `warning` 的列數。
     *
     * **`EMPTY_BODY`（warning）計入**（FEAT-7 T005 實作裁示，2026-08-22）：
     * FR-021 明訂空正文照常建立該章節，故它是「會被建立的章」之一。
     * 排除它的話，一批全是空正文的檔案會得到 `importable === 0` → `canSubmit === false`，
     * 而那正好否定 FR-021。摘要列的讀法亦是「可匯入 48 章，**其中** 2 章正文為空」。
     */
    importable: number;
    /** 正文為空的章數（FR-021）。與 `importable` 是包含關係，非互斥 */
    emptyBody: number;
    /** 已略過的項目數（不計入匯入） */
    skipped: number;
    /** 錯誤筆數 */
    errors: number;
    /** 其中屬章號衝突者 */
    conflicts: number;
    /** 缺號區間，如 `['第 21–99 章']`。**缺號只在此，`rows` 沒有對應的 verdict**（FR-022） */
    gaps: string[];
    /** 會被送往伺服器的位元組數 ＝ 未被略過的列之和 */
    totalBytes: number;
  };
  /** 四個批次級阻擋條件皆不成立時為 true（data-model §2.2） */
  canSubmit: boolean;
}

/**
 * 選檔模式。**判定分級需要它**：`NOT_MARKDOWN` 在 `'folder'` 下是 skipped（不阻擋）、
 * 在 `'files'` 下是 error（阻擋）—— FR-001c。它是唯一會依脈絡變級別的判定，
 * 沒有這個入參就只能在元件層事後改寫級別，而那正是「解析規則只有一份」要防的分岔。
 */
export type PickMode = 'files' | 'folder';

// ─────────────────────────────────────────────
// 純函式
// ─────────────────────────────────────────────

/**
 * 檔名慣例。**來源：`prisma/seed.ts` 的同名常數**，兩處 MUST 保持一致
 * （seed 是離線腳本、不引用 `src/`，故各持一份是可接受的重複；
 * 漂移則不可接受，由 `tests/unit/chapterImport-parse.test.ts` 以真實 seed 檔名鎖死）。
 */
export const CHAPTER_FILE_RE = /^第(\d+)章_(.+)\.md$/;

/**
 * 檔名 → 章號與標題。先 NFC 正規化再比對（research R-8：macOS 以 NFD 儲存檔名，
 * 長度判定會因作者用哪台電腦而異）。不符慣例回 null。
 */
export function parseChapterFilename(filename: string): { number: number; title: string } | null {
  const matched = CHAPTER_FILE_RE.exec(filename.normalize('NFC'));
  if (!matched) return null;

  return { number: Number(matched[1]), title: matched[2].trim() };
}

/**
 * UTF-8 嚴格解碼。**MUST 使用 `fatal: true`** —— 非嚴格模式會把壞位元組換成 U+FFFD
 * 並靜默成功，正是 FR-006 禁止的行為（症狀是作者的正文裡多出一堆「�」，而系統回報成功）。
 * BOM 由 `TextDecoder` 預設行為移除（`ignoreBOM: false` ＝ 移除）。
 * 解碼失敗回 null，MUST NOT 擲出。
 */
export function decodeUtf8Strict(buffer: ArrayBuffer | Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return null;
  }
}

/** 批次內同章號的檔名分組。回傳 `Map<章號, 檔名[]>`，只含長度 > 1 者 */
export function detectBatchDuplicates(
  parsed: ReadonlyArray<{ filename: string; number: number | null }>
): Map<number, string[]> {
  const byNumber = new Map<number, string[]>();
  for (const row of parsed) {
    if (row.number === null) continue;
    const group = byNumber.get(row.number);
    if (group) group.push(row.filename);
    else byNumber.set(row.number, [row.filename]);
  }

  const duplicates = new Map<number, string[]>();
  for (const [number, filenames] of byNumber) {
    if (filenames.length > 1) duplicates.set(number, filenames);
  }
  return duplicates;
}

/** 與既有章節的章號衝突。既有清單帶標題，供錯誤訊息指名撞到哪一章（FR-010(b)） */
export function detectExistingConflicts(
  batchNumbers: readonly number[],
  existing: ReadonlyArray<{ number: number; title: string }>
): Array<{ number: number; existingTitle: string }> {
  const titleByNumber = new Map(existing.map((row) => [row.number, row.title]));
  const seen = new Set<number>();
  const conflicts: Array<{ number: number; existingTitle: string }> = [];

  for (const number of batchNumbers) {
    const existingTitle = titleByNumber.get(number);
    if (existingTitle === undefined || seen.has(number)) continue;
    seen.add(number);
    conflicts.push({ number, existingTitle });
  }
  return conflicts;
}

/** 單點缺號寫成「第 N 章」，區間寫成「第 N–M 章」（連接號為 U+2013） */
function formatGap(from: number, to: number): string {
  return from === to ? `第 ${from} 章` : `第 ${from}–${to} 章`;
}

/**
 * 缺號區間（FR-022）。既有與批次合併去重排序後掃描斷點。
 * **下界自 1 起算** —— 作品既有 5–10、批次 11–20 時，第 1–4 章是缺號，
 * 那正是「作者把第一批檔名全打錯」的樣子（research R-9）。
 */
export function detectNumberGaps(
  batchNumbers: readonly number[],
  existingNumbers: readonly number[]
): string[] {
  const all = [...new Set([...batchNumbers, ...existingNumbers])].sort((a, b) => a - b);
  const gaps: string[] = [];
  let expected = 1;

  for (const number of all) {
    if (number > expected) gaps.push(formatGap(expected, number - 1));
    expected = Math.max(expected, number + 1);
  }
  return gaps;
}

/** 章號有效性（FR-017c）：整數且 1 ≤ n ≤ 9999 */
export function isValidChapterNumber(n: unknown): n is number {
  return (
    typeof n === 'number' &&
    Number.isInteger(n) &&
    n >= IMPORT_LIMITS.minChapterNumber &&
    n <= IMPORT_LIMITS.maxChapterNumber
  );
}

// ─────────────────────────────────────────────
// 判定分級（data-model §2.2）
// ─────────────────────────────────────────────

function isMarkdownFilename(filename: string): boolean {
  return filename.toLowerCase().endsWith('.md');
}

/**
 * 檔案是否位於所選資料夾的**子目錄**內：`webkitRelativePath` 去掉根資料夾後仍含 `/`。
 * 多檔選取模式的 `relativePath` 為 `''`，恆為 false。
 */
function isInSubdirectory(relativePath: string): boolean {
  return relativePath.split('/').length > 2;
}

/** 級別。`NOT_MARKDOWN` 依 `PickMode` 而定（FR-001c）；其餘固定 */
export function levelOfVerdict(verdict: PreviewVerdict, mode: PickMode): PreviewLevel {
  if (verdict === 'IN_SUBDIRECTORY') return 'skipped';
  if (verdict === 'NOT_MARKDOWN') return mode === 'folder' ? 'skipped' : 'error';
  if (verdict === 'EMPTY_BODY') return 'warning';
  if (verdict === 'OK') return 'ok';
  return 'error';
}

/**
 * 逐列判定。**MUST 依 data-model §2.2 的優先序由 1 往下逐項檢查，先命中先勝、命中即停** ——
 * 一列同時命中多項是常態（1.2 MB 且與既有撞號、空正文且批次內重複），
 * 順序未定時回哪一個代碼是實作者當下的選擇，而逐項驗收每一案都只餵單一條件，
 * **任何順序都會綠**，作者卻會看到一個對他沒用的原因。
 */
function verdictOf(
  row: ParsedChapterFile,
  mode: PickMode,
  duplicateNumbers: ReadonlySet<number>,
  existingNumbers: ReadonlySet<number>
): PreviewVerdict {
  // 1：子目錄內的檔案（僅資料夾模式，FR-001a）
  if (mode === 'folder' && isInSubdirectory(row.relativePath)) return 'IN_SUBDIRECTORY';
  // 2：非 .md（級別隨模式而定，FR-001c）
  if (!isMarkdownFilename(row.filename)) return 'NOT_MARKDOWN';
  // 3：單檔超限。**排在解碼之前** —— 沒必要為了報編碼錯誤先把超限的檔案解完
  if (row.byteSize > IMPORT_LIMITS.maxFileBytes) return 'FILE_TOO_LARGE';
  // 4：檔名不符慣例
  if (row.number === null || row.title === null) return 'FILENAME_MISMATCH';
  // 5：章號無效。**排在檔名之後** —— 檔名解不出來時根本沒有章號可判
  if (!isValidChapterNumber(row.number)) return 'INVALID_NUMBER';
  // 6：標題超長（FR-020，不因批次放寬）
  if (row.title.length > MAX_LENGTH.chapterTitle) return 'TITLE_TOO_LONG';
  // 7：無法以 UTF-8 解碼（FR-006）
  if (row.body === null) return 'ENCODING';
  // 8：正文超長。**排在解碼之後** —— 解不開就沒有正文長度
  if (row.body.length > MAX_LENGTH.chapterBody) return 'BODY_TOO_LONG';
  // 9：批次內重複
  if (duplicateNumbers.has(row.number)) return 'DUPLICATE_IN_BATCH';
  // 10：與既有章節衝突
  if (existingNumbers.has(row.number)) return 'CONFLICT_EXISTING';
  // 11：空正文（警告，不阻擋，FR-021）
  if (row.body.trim().length === 0) return 'EMPTY_BODY';
  // 12
  return 'OK';
}

/** 前兩道判定即決定是否略過；略過的列不參與批次內重複、不計入總量與檔案數 */
function isSkippedRow(row: ParsedChapterFile, mode: PickMode): boolean {
  if (mode !== 'folder') return false;
  return isInSubdirectory(row.relativePath) || !isMarkdownFilename(row.filename);
}

/**
 * 逐列判定分級與批次級 `canSubmit`。純函式：既有章號由呼叫端傳入
 * （前端來自頁面 props、伺服器來自交易內查詢）。
 *
 * **前端與伺服器 MUST 呼叫這一支**，MUST NOT 各自串接下層的 `detect*` primitives
 * （FR-002b 的全量重驗與 FR-002c 的「只有一份實作」是同一件事的兩面）。
 * 伺服器只是把 `mode` 固定傳 `'files'`（送到伺服器的都是明確選定的檔案）。
 */
export function gradePreview(
  parsed: readonly ParsedChapterFile[],
  existing: ReadonlyArray<{ number: number; title: string }>,
  mode: PickMode
): ImportPreview {
  // 略過的列不參與批次內重複判定 —— 它們根本不會被匯入
  const duplicateNumbers = new Set(
    detectBatchDuplicates(parsed.filter((row) => !isSkippedRow(row, mode))).keys()
  );
  const existingNumbers = new Set(existing.map((row) => row.number));

  const rows = parsed.map((row) => ({
    ...row,
    verdict: verdictOf(row, mode, duplicateNumbers, existingNumbers),
  }));

  const levels = rows.map((row) => levelOfVerdict(row.verdict, mode));
  const importableRows = rows.filter((_, i) => levels[i] === 'ok' || levels[i] === 'warning');
  const sentRows = rows.filter((_, i) => levels[i] !== 'skipped');

  const totalBytes = sentRows.reduce((sum, row) => sum + row.byteSize, 0);
  const summary = {
    importable: importableRows.length,
    emptyBody: rows.filter((row) => row.verdict === 'EMPTY_BODY').length,
    skipped: levels.filter((level) => level === 'skipped').length,
    errors: levels.filter((level) => level === 'error').length,
    conflicts: rows.filter((row) => row.verdict === 'CONFLICT_EXISTING').length,
    gaps: detectNumberGaps(
      importableRows.flatMap((row) => (row.number === null ? [] : [row.number])),
      existing.map((row) => row.number)
    ),
    totalBytes,
  };

  // 四個批次級阻擋條件（data-model §2.2）。第四個（可匯入章數為 0）少了的話，
  // 一個只有略過項的空資料夾會讓作者對著零章的清單按下匯入
  const canSubmit =
    summary.errors === 0 &&
    sentRows.length <= IMPORT_LIMITS.maxFiles &&
    totalBytes <= IMPORT_LIMITS.maxTotalBytes &&
    summary.importable > 0;

  return { rows, summary, canSubmit };
}

/** 逐列判定的繁中說明（FR-019）。錯誤訊息 MUST 指名來源檔，由呼叫端加上檔名 */
export const VERDICT_MESSAGE: Record<PreviewVerdict, string> = {
  OK: '可匯入',
  FILENAME_MISMATCH: '檔名不符「第N章_標題.md」慣例',
  INVALID_NUMBER: `章號必須是 ${IMPORT_LIMITS.minChapterNumber}–${IMPORT_LIMITS.maxChapterNumber} 的整數`,
  ENCODING: '內容不是有效的 UTF-8 編碼',
  TITLE_TOO_LONG: `標題不得超過 ${MAX_LENGTH.chapterTitle} 個字`,
  BODY_TOO_LONG: `正文不得超過 ${MAX_LENGTH.chapterBody} 個字`,
  DUPLICATE_IN_BATCH: '本批次中有另一個檔案使用相同章號',
  CONFLICT_EXISTING: '章號與作品既有章節重複',
  FILE_TOO_LARGE: `單檔不得超過 ${IMPORT_LIMITS.maxFileBytes} 位元組`,
  EMPTY_BODY: '正文為空，仍會建立章節',
  NOT_MARKDOWN: '不是 .md 檔',
  IN_SUBDIRECTORY: '位於子目錄內',
};
