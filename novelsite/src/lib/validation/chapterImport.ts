import { z } from 'zod';

/**
 * 批次匯入的上限常數與寫入前的形狀驗證（FEAT-7 FR-017、FR-020、contracts/internal-modules.md §2）
 * ==============================================================================================
 * 沿用 `validation/` 的既有語意：client / server 共用的純模組，MUST NOT `import 'server-only'`。
 */

/**
 * 三項上限（FR-017）。MUST NOT 於各處重複字面量 —— 重複的必然結果是漂移。
 *
 * **取值理由的唯一出處是 spec FR-017a**，此處 MUST NOT 另抄一份
 * （FEAT-7 analyze（2026-08-20）：原本六份文件各抄一份，調整時得同步六處）。
 * 只就地保留其中最容易被推翻的那一句：
 *
 * **`maxTotalBytes` MUST NOT 由 `maxFiles` × `maxFileBytes` 推導**（1000 × 1 MB = 1 GB）。
 * 總大小是獨立的護欄，它存在的目的正是擋下「每一檔都貼著單檔上限」這種前兩項擋不住的情況。
 */
export const IMPORT_LIMITS = {
  /** 單次可選檔案數上限。理由見 spec FR-017a(b) */
  maxFiles: 1000,
  /** 單檔位元組上限（1 MB）。理由見 spec FR-017a(a) */
  maxFileBytes: 1_048_576,
  /** 單次總位元組上限（50 MB）。理由見 spec FR-017a(c)，並見上方註解 */
  maxTotalBytes: 52_428_800,
  /** 章節編號下界（FR-017c） */
  minChapterNumber: 1,
  /** 章節編號上界（FR-017c） */
  maxChapterNumber: 9999,
} as const;

/**
 * 伺服器寫入前的逐章形狀驗證。
 *
 * **只驗形狀與型別**：欄位在不在、`number` 是不是整數、其餘三欄是不是字串。
 * **MUST NOT 判定長度或任何內容規則** —— 長度上限（`MAX_LENGTH`，不放寬，FR-020）
 * 與其餘內容判定一律由 `gradePreview()`（`@/lib/chapterImport/parse`）產出 verdict
 * （FEAT-7 第五輪 analyze 裁示，2026-08-21）。
 * **兩份判定並存等於沒有真相來源**：一份回 Zod issue（手上只有陣列索引 `rows[7]`）、
 * 一份回 verdict（帶 `filename`），而作者的檔案總管裡沒有「第 7 列」這種東西。
 *
 * **MUST NOT 複用 `validation/chapter.ts` 的 `bodyMarkdownField`** —— 該欄位帶
 * `.refine(v => v.trim().length > 0)`，會把 FR-021 明訂為警告的空正文升級為錯誤（research R-5）。
 *
 * `filename` 為必填：FR-019 要求逐檔判定類的錯誤指名來源檔。
 * 它**只供錯誤訊息與判定使用，MUST NOT 落庫**（`Chapter` 無此欄，data-model §1.2）。
 */
export const importChapterRowSchema = z.object({
  filename: z.string(),
  number: z.number().int(),
  title: z.string(),
  // 允許空字串（FR-021）；長度上限由 gradePreview 判定，見上方註解
  bodyMarkdown: z.string(),
});

/** 寫入前的整批形狀驗證。內容判定一律已由 `gradePreview()` 完成，見 `importChapterRowSchema` */
export const importChaptersSchema = z.object({
  volumeId: z.string().trim().min(1, '缺少卷識別碼'),
  rows: z.array(importChapterRowSchema),
});

export type ImportChapterRow = z.infer<typeof importChapterRowSchema>;
