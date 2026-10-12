import 'server-only';
import {
  getVolumeOwnerNovelId,
  getNovelChapterNumbers,
  createChaptersBulk,
  getNovelCounters,
  refreshNovelCounters,
  touchNovel,
  withTransaction,
} from '@/lib/repositories';
import { assertNovelOwner, NotFoundError } from '@/lib/auth/ownership';
import { invalidateNovel } from '@/lib/cache';
import { countWords } from '@/lib/validation/common';
import { IMPORT_LIMITS, importChaptersSchema } from '@/lib/validation/chapterImport';
import {
  decodeUtf8Strict,
  gradePreview,
  levelOfVerdict,
  parseChapterFilename,
  VERDICT_MESSAGE,
  type ImportPreview,
  type ParsedChapterFile,
} from '@/lib/chapterImport/parse';
import { sanitizeBody } from './chapterService';
import { ServiceError, parseOrThrow, translateDbError } from './errors';

/**
 * 批次匯入的授權、重驗與交易編排（FEAT-7 7-B，contracts/internal-modules.md §7）
 * ==============================================================================
 * 授權順序：身分與角色（Route Handler 已驗）→ **反查 `novelId`** → 擁有權（此處）。
 * **反查在先**：擁有權判定的入參就是反查的結果，順序反過來那一行沒有 `novelId` 可用。
 * **MUST NOT 接受客戶端傳入的 `novelId`**（契約 §1.1）—— 接受了就得比對它與 `volumeId`
 * 的歸屬，而少寫那一步的後果是作者能把章節掛到別人的作品下。反查沒有這個分支。
 *
 * **全量重驗一律走 `gradePreview()`**（FR-002b／FR-002c）：MUST NOT 自行串接
 * `parseChapterFilename`／`detectBatchDuplicates`／`detectExistingConflicts` 等 primitives ——
 * 那等於在伺服器端另寫一份分級邏輯。primitives 各自正確，不代表串接順序與級別判定也一致，
 * 而漂移會從「同一個檔案，前端說 `INVALID_NUMBER`、伺服器說 `FILENAME_MISMATCH`」開始，
 * 且沒有任何測試會變紅。前端呼叫同一支，只有 `mode` 不同。
 *
 * **MUST NOT `import { prisma }`**：資料存取一律經 `@/lib/repositories` barrel（憲章第 III 條）。
 */

/**
 * 單一來源檔的原始輸入。Route Handler 自 multipart part 組出，**未解碼、未淨化** ——
 * 解碼（`decodeUtf8Strict`）、淨化（`sanitizeBody`）與字數（`countWords`）皆在本層完成，
 * 與單章寫入路徑用的是同一組函式（FR-007、FR-007a、FR-008）。
 */
export interface ImportFileInput {
  filename: string;
  byteSize: number;
  bytes: Uint8Array;
}

export interface ImportChaptersInput {
  volumeId: string;
  files: readonly ImportFileInput[];
}

export interface ImportChaptersResult {
  /**
   * 作品識別碼。**不在契約 §1.2 的回應主體裡**，Route Handler MUST NOT 把它放進 JSON ——
   * 它只供匯入紀錄的 `novelId` 欄使用（契約 §4、FR-016b）。
   * Route Handler 自己取不到：`novelId` 由本層自 `volumeId` 反查而得，
   * 而端點層 MUST NOT 直接觸及資料存取層（憲章第 III 條）。
   * 出處：FEAT-7 T015／T017 實作裁示（2026-08-22），已回寫 `contracts/internal-modules.md` §7。
   */
  novelId: string;
  created: number;
  numbers: number[];
  /** 作品層級計數。**正常情形下與匯入前相同** —— 只彙總已發佈章節，而匯入產出全為草稿（FR-013） */
  chapterCount: number;
  wordCount: number;
}

/** 逐檔錯誤訊息最多列這麼多個檔名，其餘以總數帶過 —— 1000 列的訊息沒有人讀得完 */
const MAX_LISTED_FILES = 10;

const NOT_FOUND = () => new ServiceError('NOT_FOUND', '找不到指定的資源');

/**
 * 卷 → 作品，並確認擁有權。
 * 不存在與非擁有者匯流成同一個 `NOT_FOUND`，訊息與資源不存在時**逐字相同**（FR-016）——
 * 403 等於告訴對方「這個 volumeId 是有效的，只是不是你的」。
 */
async function ownerNovelOfVolume(uid: string, volumeId: string): Promise<string> {
  const novelId = await getVolumeOwnerNovelId(volumeId);
  if (!novelId) throw NOT_FOUND();

  try {
    await assertNovelOwner(uid, novelId);
  } catch (err) {
    if (err instanceof NotFoundError) throw NOT_FOUND();
    throw err;
  }
  return novelId;
}

/**
 * 原始輸入 → `ParsedChapterFile`。伺服器端的 `relativePath` 一律為 `''`：
 * 送到這裡的都是明確選定的檔案，`IN_SUBDIRECTORY` 在伺服器端不會命中。
 */
function toParsedChapterFile(file: ImportFileInput): ParsedChapterFile {
  const filename = file.filename.normalize('NFC');
  const named = parseChapterFilename(filename);
  const decoded = decodeUtf8Strict(file.bytes);
  // **與單章路徑同一支淨化**（FR-007）：另訂規則或略過的症狀只出現在批次路徑，
  // 單章的既有測試會照樣全綠（FR-007a）
  const body = decoded === null ? null : sanitizeBody(decoded);

  return {
    filename,
    relativePath: '',
    byteSize: file.byteSize,
    number: named?.number ?? null,
    title: named?.title ?? null,
    body,
    wordCount: body === null ? 0 : countWords(body),
  };
}

/** 逐檔訊息 MUST 指名來源檔（FR-019）；超過上限只留總數 */
function describeFiles(entries: readonly string[]): string {
  if (entries.length <= MAX_LISTED_FILES) return entries.join('；');
  return `${entries.slice(0, MAX_LISTED_FILES).join('；')}；等共 ${entries.length} 個檔案有問題`;
}

/**
 * 批次級與逐列判定的把關。順序：批次級上限 → 逐列非衝突錯誤（400）→ 章號衝突（409）。
 *
 * **非衝突錯誤排在衝突之前**：400 說的是「你送來的東西本身不合規格」，
 * 409 說的是「東西沒問題，但和現有資料撞上了」—— 前者不修好，後者的訊息也沒有意義。
 */
function assertSubmittable(
  preview: ImportPreview,
  existing: ReadonlyArray<{ number: number; title: string }>
): void {
  const { summary } = preview;

  if (summary.totalBytes > IMPORT_LIMITS.maxTotalBytes) {
    // FR-018：訊息 MUST 同時含實際值與上限值
    throw new ServiceError(
      'VALIDATION_ERROR',
      `總大小 ${summary.totalBytes} 位元組，上限 ${IMPORT_LIMITS.maxTotalBytes} 位元組`
    );
  }
  if (preview.rows.length > IMPORT_LIMITS.maxFiles) {
    throw new ServiceError(
      'VALIDATION_ERROR',
      `已選 ${preview.rows.length} 個，上限 ${IMPORT_LIMITS.maxFiles} 個`
    );
  }

  const errorRows = preview.rows.filter((row) => levelOfVerdict(row.verdict, 'files') === 'error');
  const nonConflict = errorRows.filter((row) => row.verdict !== 'CONFLICT_EXISTING');
  if (nonConflict.length > 0) {
    throw new ServiceError(
      'VALIDATION_ERROR',
      describeFiles(nonConflict.map((row) => `${row.filename}：${VERDICT_MESSAGE[row.verdict]}`))
    );
  }

  const conflicts = errorRows.filter((row) => row.verdict === 'CONFLICT_EXISTING');
  if (conflicts.length > 0) {
    const titleByNumber = new Map(existing.map((row) => [row.number, row.title]));
    throw new ServiceError(
      'CONFLICT',
      describeFiles(
        conflicts.map((row) => {
          const existingTitle = row.number === null ? '' : (titleByNumber.get(row.number) ?? '');
          return `${row.filename}：第 ${row.number} 章已存在（${existingTitle}）`;
        })
      )
    );
  }

  if (summary.importable === 0) {
    throw new ServiceError('VALIDATION_ERROR', '沒有可匯入的章節檔');
  }
  // 上面四項已覆蓋 canSubmit 的全部阻擋條件；剩下的不成立即是判定與此處漂移
  if (!preview.canSubmit) {
    throw new ServiceError('VALIDATION_ERROR', '這批檔案無法匯入，請依預覽的說明修正後再試');
  }
}

/**
 * 匯入編排（FEAT-7 T013／T015／T016）。
 *
 * 授權 → 全量重驗 → **單一交易內**寫入。交易內再查一次既有章號是為了錯誤訊息指得出
 * 是哪一章；**正確性由 `@@unique([novelId, number])` 兜底** —— 查詢與寫入之間仍有
 * 別的連線插隊的空間，那一筆會撞上唯一鍵，於是整批回滾（FR-012 的全有全無）。
 *
 * 交易的 `timeout` 放寬到 30 秒：1000 章的上界下，Prisma 互動式交易預設的 5 秒必然逾時，
 * 而全有全無不允許把交易拆開（research R-3）。
 */
export async function importChapters(
  uid: string,
  input: ImportChaptersInput
): Promise<ImportChaptersResult> {
  const novelId = await ownerNovelOfVolume(uid, input.volumeId);
  const existing = await getNovelChapterNumbers(novelId);

  const parsed = input.files.map(toParsedChapterFile);
  const preview = gradePreview(parsed, existing, 'files');
  assertSubmittable(preview, existing);

  // 會被寫入的列 ＝ 級別不是 error 的列（伺服器的 mode 為 'files'，不會有 skipped）
  const importable = preview.rows.filter((row) => levelOfVerdict(row.verdict, 'files') !== 'error');

  // 寫入前的最後一道**形狀**驗證（長度與內容判定已由 gradePreview 完成，
  // 兩者 MUST NOT 各判一次 —— 見 validation/chapterImport.ts）。
  // 它同時把 `number`／`title`／`body` 的 `null` 收斂掉：能走到這裡的列一律非 null。
  const validated = parseOrThrow(importChaptersSchema, {
    volumeId: input.volumeId,
    rows: importable.map((row) => ({
      filename: row.filename,
      number: row.number,
      title: row.title,
      bodyMarkdown: row.body,
    })),
  });

  // 字數取自預覽列（`countWords(sanitizeBody(decodeUtf8Strict(bytes)))`，與單章路徑同一組
  // 函式，FR-007／FR-008）。兩個陣列同序，索引即對應
  const toCreate = validated.rows.map((row, i) => ({
    number: row.number,
    title: row.title,
    bodyMarkdown: row.bodyMarkdown,
    wordCount: importable[i].wordCount,
  }));
  const filenameByNumber = new Map(validated.rows.map((row) => [row.number, row.filename]));

  try {
    const written = await withTransaction(
      async (tx) => {
        // 預覽在客戶端產生、重驗在交易外，兩者之間都可能被插隊 —— 故交易內再查一次
        const current = await getNovelChapterNumbers(novelId, tx);
        const taken = new Set(current.map((row) => row.number));
        const titleByNumber = new Map(current.map((row) => [row.number, row.title]));
        const collided = toCreate.filter((row) => taken.has(row.number));
        if (collided.length > 0) {
          throw new ServiceError(
            'CONFLICT',
            describeFiles(
              collided.map(
                (row) =>
                  `${filenameByNumber.get(row.number) ?? ''}：第 ${row.number} 章已存在（${titleByNumber.get(row.number) ?? ''}）`
              )
            )
          );
        }

        const bulk = await createChaptersBulk(novelId, input.volumeId, toCreate, tx);
        // **跑完 chapterCount／wordCount 不會有任何變化，這是正確結果**（FR-013／FR-013a）：
        // 該函式只彙總 `status='published'`，而匯入產出一律 draft。仍呼叫它是因為它
        // 「依實際資料重算」而非「加 N」，成本一次 aggregate。
        // **MUST NOT 為了讓數字動起來而改它的 published-only 語意** ——
        // 那會靜默改變單章儲存／發佈／下架／刪除／排程發佈共 5 條既有寫入路徑的計數行為
        await refreshNovelCounters(novelId, tx);
        await touchNovel(novelId, new Date(), tx);
        const counters = await getNovelCounters(novelId, tx);
        return { ...bulk, ...counters };
      },
      { timeout: 30_000, maxWait: 5_000 }
    );

    // 快取失效在交易外：交易尚未 commit 時失效，重新產生的頁面會讀到舊資料
    invalidateNovel(novelId);

    return { novelId, ...written };
  } catch (err) {
    // 併發撞號 → 唯一約束 → CONFLICT（沿用單章路徑的既有文案）
    throw translateDbError(err, '章節編號重複，請重試');
  }
}
