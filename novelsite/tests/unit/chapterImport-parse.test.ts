import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  CHAPTER_FILE_RE,
  PREVIEW_VERDICTS,
  decodeUtf8Strict,
  detectBatchDuplicates,
  detectExistingConflicts,
  detectNumberGaps,
  gradePreview,
  parseChapterFilename,
  type ParsedChapterFile,
  type PickMode,
} from '@/lib/chapterImport/parse';
import { stripControlChars } from '@/lib/validation/common';
import { sanitizeBody } from '@/lib/services/chapterService';

/**
 * 批次匯入的解析與判定（FEAT-7 T007／T010／T037）
 * ================================================
 * 本檔驗的是 `lib/chapterImport/parse.ts`。三段測試**順序即相依順序**：
 * T007（primitives）→ T010（與 seed 的檔名慣例一致）→ T037（`gradePreview` 的分級）。
 */

const utf8 = (text: string) => new TextEncoder().encode(text);

// ─────────────────────────────────────────────
// T007：檔名解析、解碼、重複、衝突、缺號、淨化等價
// ─────────────────────────────────────────────

describe('T007 parseChapterFilename：檔名 → 章號與標題（FR-005）', () => {
  it('合法檔名解析出章號與標題', () => {
    expect(parseChapterFilename('第1章_序章：廢墟少年.md')).toEqual({
      number: 1,
      title: '序章：廢墟少年',
    });
  });

  it('缺「第…章」前綴不成立', () => {
    expect(parseChapterFilename('1_序章.md')).toBeNull();
    expect(parseChapterFilename('chapter1.md')).toBeNull();
  });

  it('缺底線不成立', () => {
    expect(parseChapterFilename('第1章序章.md')).toBeNull();
  });

  it('副檔名非 .md 不成立', () => {
    expect(parseChapterFilename('第1章_序章.txt')).toBeNull();
    expect(parseChapterFilename('第1章_序章.markdown')).toBeNull();
  });

  it('章號含前導零仍解析為十進位整數', () => {
    expect(parseChapterFilename('第007章_序章.md')).toEqual({ number: 7, title: '序章' });
  });

  it('NFD 與 NFC 檔名的解析結果一致（research R-8：macOS 檔名以 NFD 儲存）', () => {
    const nfc = '第1章_が.md'; // が
    const nfd = '第1章_\u304B\u3099.md'; // 分解形式：假名 + 組合用濁點
    expect(nfd).not.toBe(nfc);
    expect(nfd.normalize('NFC')).toBe(nfc);
    expect(parseChapterFilename(nfd)).toEqual(parseChapterFilename(nfc));
    expect(parseChapterFilename(nfd)?.title).toBe('が');
  });
});

describe('T007 decodeUtf8Strict：嚴格解碼（FR-006、research R-7）', () => {
  it('合法 UTF-8 逐字還原', () => {
    expect(decodeUtf8Strict(utf8('風從斷牆的缺口灌進來'))).toBe('風從斷牆的缺口灌進來');
  });

  it('壞位元組回 null，**不得回含 U+FFFD 的字串**', () => {
    const broken = new Uint8Array([0xc3, 0x28]);
    const decoded = decodeUtf8Strict(broken);

    expect(decoded).toBeNull();
    // 非嚴格模式會把壞位元組換成 U+FFFD 並靜默成功，正是 FR-006 禁止的行為
    expect(typeof decoded === 'string' && decoded.includes('�')).toBe(false);
  });

  it('BOM 不進入正文首字（ignoreBOM 預設 false ＝ 移除）', () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('第一段。')]);
    const decoded = decodeUtf8Strict(withBom);

    expect(decoded).toBe('第一段。');
    expect(decoded?.charCodeAt(0)).toBe('第'.charCodeAt(0));
  });
});

describe('T007 detectBatchDuplicates：批次內同章號分組', () => {
  it('只回長度 > 1 的分組，解析失敗的列不參與', () => {
    const duplicates = detectBatchDuplicates([
      { filename: 'a.md', number: 1 },
      { filename: 'b.md', number: 1 },
      { filename: 'c.md', number: 2 },
      { filename: 'd.md', number: null },
    ]);

    expect([...duplicates.keys()]).toEqual([1]);
    expect(duplicates.get(1)).toEqual(['a.md', 'b.md']);
  });
});

describe('T007 detectExistingConflicts：與既有章節的衝突（FR-010(b)）', () => {
  it('回傳撞號的章號與既有標題', () => {
    expect(detectExistingConflicts([1, 3], [{ number: 3, title: '序章' }])).toEqual([
      { number: 3, existingTitle: '序章' },
    ]);
  });

  it('無衝突回空陣列', () => {
    expect(detectExistingConflicts([1, 2], [{ number: 9, title: '第九章' }])).toEqual([]);
  });
});

describe('T007 detectNumberGaps：缺號區間（FR-022、research R-9）', () => {
  it('無缺號回空陣列', () => {
    expect(detectNumberGaps([1, 2, 3], [])).toEqual([]);
  });

  it('單點缺號寫成「第 N 章」', () => {
    expect(detectNumberGaps([1, 3], [])).toEqual(['第 2 章']);
  });

  it('多段缺號逐段列出', () => {
    expect(detectNumberGaps([1, 5, 9], [])).toEqual(['第 2–4 章', '第 6–8 章']);
  });

  it('下界自 1 起算：既有 5–10、批次 11–20 時第 1–4 章是缺號', () => {
    const existing = [5, 6, 7, 8, 9, 10];
    const batch = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
    expect(detectNumberGaps(batch, existing)).toEqual(['第 1–4 章']);
  });
});

describe('T007 淨化等價：sanitizeBody() 與 stripControlChars() 逐字相同（FR-007a）', () => {
  it('同一組輸入的輸出完全相同', () => {
    // 前端預覽只能用 stripControlChars（sanitizeBody 所在檔為 server-only）。
    // 沒有這一案，sanitizeBody 日後多一步就會讓預覽與入庫漂移，
    // 而症狀只出現在批次路徑 —— 單章的既有測試會照樣全綠
    const inputs = [
      '一般正文',
      '\u0000控制字元\u0007在前後\u007F',
      '保留\t定位\n換行\r歸位',
      '\u000B\u000C混合\u001F',
      '',
    ];

    for (const input of inputs) {
      expect(sanitizeBody(input)).toBe(stripControlChars(input));
    }
  });
});

// ─────────────────────────────────────────────
// T010：與 prisma/seed.ts 的檔名慣例一致（research R-4）
//
// seed 是離線腳本、不引用 `src/`，故兩處各持一份常數是可接受的重複；
// 漂移則不可接受 —— 這一案就是那道鎖。
// ─────────────────────────────────────────────

describe('T010 CHAPTER_FILE_RE 與 prisma/seed.ts 的同名常數一致', () => {
  const seedSource = fs.readFileSync(path.resolve(__dirname, '../../prisma/seed.ts'), 'utf8');
  const literal = /const CHAPTER_FILE_RE = \/(.+)\/;/.exec(seedSource);

  it('自 seed.ts 取得該常數的字面量', () => {
    expect(literal).not.toBeNull();
  });

  it('兩處的樣式來源字串相同', () => {
    expect(literal?.[1]).toBe(CHAPTER_FILE_RE.source);
  });

  it('以 seed-data 的真實檔名驗證兩者解析結果一致', () => {
    const dir = path.resolve(__dirname, '../../prisma/seed-data/featured-1/正文');
    const filenames = fs.readdirSync(dir).filter((name) => name.endsWith('.md'));
    const seedRe = new RegExp(literal?.[1] ?? '(?!)');

    expect(filenames.length).toBeGreaterThan(0);
    for (const filename of filenames) {
      const bySeed = seedRe.exec(filename);
      const byParse = parseChapterFilename(filename);

      expect(bySeed, filename).not.toBeNull();
      expect(byParse, filename).not.toBeNull();
      expect(byParse?.number, filename).toBe(Number(bySeed?.[1]));
      expect(byParse?.title, filename).toBe(bySeed?.[2]);
    }
  });
});

// ─────────────────────────────────────────────
// T037：gradePreview 的逐列判定與批次級 canSubmit（data-model §2.2）
// ─────────────────────────────────────────────

/** 以檔名推導預設欄位，再讓 overrides 覆寫；預設是一個「什麼都沒問題」的列 */
function row(overrides: Partial<ParsedChapterFile> & { filename: string }): ParsedChapterFile {
  const named = parseChapterFilename(overrides.filename);
  return {
    relativePath: '',
    byteSize: 100,
    number: named?.number ?? null,
    title: named?.title ?? null,
    body: '正文內容',
    wordCount: 4,
    ...overrides,
  };
}

const verdictOf = (
  file: ParsedChapterFile,
  existing: Array<{ number: number; title: string }> = [],
  mode: PickMode = 'files'
) => gradePreview([file], existing, mode).rows[0].verdict;

describe('T037 gradePreview：12 種 verdict，共 13 案', () => {
  it('OK：以上皆未命中', () => {
    expect(verdictOf(row({ filename: '第1章_序章.md' }))).toBe('OK');
  });

  it('FILENAME_MISMATCH：檔名不符慣例', () => {
    expect(verdictOf(row({ filename: 'chapter-one.md' }))).toBe('FILENAME_MISMATCH');
  });

  it('INVALID_NUMBER：章號 0（範圍 1–9999，FR-017c）', () => {
    expect(verdictOf(row({ filename: '第0章_序章.md' }))).toBe('INVALID_NUMBER');
  });

  it('ENCODING：無法以 UTF-8 解碼', () => {
    expect(verdictOf(row({ filename: '第1章_序章.md', body: null, wordCount: 0 }))).toBe(
      'ENCODING'
    );
  });

  it('TITLE_TOO_LONG：標題超過 200 字（FR-020）', () => {
    expect(verdictOf(row({ filename: `第1章_${'あ'.repeat(201)}.md` }))).toBe('TITLE_TOO_LONG');
  });

  it('BODY_TOO_LONG：正文超過 100,000 字（FR-020）', () => {
    const body = 'あ'.repeat(100_001);
    expect(verdictOf(row({ filename: '第1章_序章.md', body, wordCount: body.length }))).toBe(
      'BODY_TOO_LONG'
    );
  });

  it('DUPLICATE_IN_BATCH：批次內另有同章號的檔案', () => {
    const preview = gradePreview(
      [row({ filename: '第1章_甲.md' }), row({ filename: '第1章_乙.md' })],
      [],
      'files'
    );
    expect(preview.rows.map((r) => r.verdict)).toEqual([
      'DUPLICATE_IN_BATCH',
      'DUPLICATE_IN_BATCH',
    ]);
  });

  it('CONFLICT_EXISTING：章號與作品既有章節重複', () => {
    expect(verdictOf(row({ filename: '第3章_新篇.md' }), [{ number: 3, title: '序章' }])).toBe(
      'CONFLICT_EXISTING'
    );
  });

  it('FILE_TOO_LARGE：單檔超過 1 MB', () => {
    expect(verdictOf(row({ filename: '第1章_序章.md', byteSize: 1_048_577 }))).toBe(
      'FILE_TOO_LARGE'
    );
  });

  it('EMPTY_BODY：正文僅含空白，為警告而非錯誤（FR-021）', () => {
    const preview = gradePreview([row({ filename: '第1章_序章.md', body: '   \n' })], [], 'files');
    expect(preview.rows[0].verdict).toBe('EMPTY_BODY');
    // 警告不阻擋，且該章仍會被建立
    expect(preview.summary.emptyBody).toBe(1);
    expect(preview.summary.importable).toBe(1);
    expect(preview.canSubmit).toBe(true);
  });

  it('NOT_MARKDOWN（資料夾模式）：skipped，不阻擋（FR-001a）', () => {
    const preview = gradePreview(
      [
        row({ filename: '封面.png', relativePath: '作品/封面.png' }),
        row({ filename: '第1章_甲.md' }),
      ],
      [],
      'folder'
    );
    expect(preview.rows[0].verdict).toBe('NOT_MARKDOWN');
    expect(preview.summary.skipped).toBe(1);
    expect(preview.summary.errors).toBe(0);
    expect(preview.canSubmit).toBe(true);
  });

  it('NOT_MARKDOWN（多檔選取模式）：error，阻擋（FR-001c）', () => {
    const preview = gradePreview(
      [row({ filename: '封面.png' }), row({ filename: '第1章_甲.md' })],
      [],
      'files'
    );
    expect(preview.rows[0].verdict).toBe('NOT_MARKDOWN');
    expect(preview.summary.errors).toBe(1);
    expect(preview.canSubmit).toBe(false);
  });

  it('IN_SUBDIRECTORY：位於所選資料夾的子目錄內（research R-13）', () => {
    const preview = gradePreview(
      [
        row({ filename: '第1章_甲.md', relativePath: '作品/卷一/第1章_甲.md' }),
        row({ filename: '第2章_乙.md', relativePath: '作品/第2章_乙.md' }),
      ],
      [],
      'folder'
    );
    expect(preview.rows.map((r) => r.verdict)).toEqual(['IN_SUBDIRECTORY', 'OK']);
    expect(preview.summary.skipped).toBe(1);
  });
});

describe('T037 canSubmit：四個假值來源各一案，與全數通過的一案', () => {
  it('存在任一 error → false', () => {
    const preview = gradePreview(
      [row({ filename: '第1章_甲.md' }), row({ filename: 'bad.md' })],
      [],
      'files'
    );
    expect(preview.summary.errors).toBe(1);
    expect(preview.canSubmit).toBe(false);
  });

  it('檔案數 > 1000 → false（1000 為真、1001 為假）', () => {
    const files = Array.from({ length: 1001 }, (_, i) => row({ filename: `第${i + 1}章_甲.md` }));

    expect(gradePreview(files.slice(0, 1000), [], 'files').canSubmit).toBe(true);
    expect(gradePreview(files, [], 'files').canSubmit).toBe(false);
  });

  it('總大小 > 50 MB → false（貼齊 50 MB 為真、+1 位元組為假）', () => {
    const atLimit = Array.from({ length: 50 }, (_, i) =>
      row({ filename: `第${i + 1}章_甲.md`, byteSize: 1_048_576 })
    );
    const overLimit = [...atLimit, row({ filename: '第51章_乙.md', byteSize: 1 })];

    expect(gradePreview(atLimit, [], 'files').summary.totalBytes).toBe(52_428_800);
    expect(gradePreview(atLimit, [], 'files').canSubmit).toBe(true);
    expect(gradePreview(overLimit, [], 'files').canSubmit).toBe(false);
  });

  it('可匯入章數為 0 → false', () => {
    const preview = gradePreview([], [], 'files');
    expect(preview.summary.importable).toBe(0);
    expect(preview.summary.errors).toBe(0);
    expect(preview.canSubmit).toBe(false);
  });

  it('全數通過 → true', () => {
    const preview = gradePreview(
      [row({ filename: '第1章_甲.md' }), row({ filename: '第2章_乙.md' })],
      [],
      'files'
    );
    expect(preview.canSubmit).toBe(true);
  });
});

describe('T037(a) 空資料夾：只含子目錄檔案與非 .md 檔（spec Edge Case 3）', () => {
  it('importable 為 0 且 canSubmit 為 false —— 供「此資料夾沒有可匯入的章節檔」有判定依據', () => {
    const preview = gradePreview(
      [
        row({ filename: '第1章_甲.md', relativePath: '作品/卷一/第1章_甲.md' }),
        row({ filename: '封面.png', relativePath: '作品/封面.png' }),
        row({ filename: 'notes.txt', relativePath: '作品/notes.txt' }),
      ],
      [],
      'folder'
    );

    expect(preview.summary.skipped).toBe(3);
    // 每一列都是 skipped、一個 error 也沒有 —— 少了「可匯入章數為 0」這個條件，
    // canSubmit 會是 true，等於讓作者對著一張零章的清單按下匯入
    expect(preview.summary.errors).toBe(0);
    expect(preview.summary.importable).toBe(0);
    expect(preview.canSubmit).toBe(false);
  });
});

describe('T037(b) verdict 聯集鎖死：代碼恰為 12 個（FR-022a）', () => {
  it('代碼集合逐字相符', () => {
    // 這是 FR-022a（MUST NOT 判斷跨卷交錯）唯一會變紅的地方 ——
    // 日後有人加一個 CROSS_VOLUME_OVERLAP，這一案會擋下
    expect([...PREVIEW_VERDICTS].sort()).toEqual(
      [
        'BODY_TOO_LONG',
        'CONFLICT_EXISTING',
        'DUPLICATE_IN_BATCH',
        'EMPTY_BODY',
        'ENCODING',
        'FILENAME_MISMATCH',
        'FILE_TOO_LARGE',
        'INVALID_NUMBER',
        'IN_SUBDIRECTORY',
        'NOT_MARKDOWN',
        'OK',
        'TITLE_TOO_LONG',
      ].sort()
    );
    expect(PREVIEW_VERDICTS).toHaveLength(12);
  });
});

describe('T037(c) 優先序：一列同時命中多項時，回優先序較前的代碼', () => {
  it('1.2 MB 且與既有章節撞號 → FILE_TOO_LARGE（3 早於 10）', () => {
    expect(
      verdictOf(row({ filename: '第3章_新篇.md', byteSize: 1_258_291 }), [
        { number: 3, title: '序章' },
      ])
    ).toBe('FILE_TOO_LARGE');
  });

  it('空正文且批次內重複 → DUPLICATE_IN_BATCH（9 早於 11）', () => {
    const preview = gradePreview(
      [
        row({ filename: '第1章_甲.md', body: '  ', wordCount: 0 }),
        row({ filename: '第1章_乙.md', body: '  ', wordCount: 0 }),
      ],
      [],
      'files'
    );
    expect(preview.rows.map((r) => r.verdict)).toEqual([
      'DUPLICATE_IN_BATCH',
      'DUPLICATE_IN_BATCH',
    ]);
  });
});
