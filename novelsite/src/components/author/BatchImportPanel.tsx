'use client';

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Progress } from '@/components/ui';
import { apiUrl } from '@/lib/apiUrl';
import {
  decodeUtf8Strict,
  gradePreview,
  levelOfVerdict,
  parseChapterFilename,
  VERDICT_MESSAGE,
  type ImportPreview,
  type ParsedChapterFile,
  type PickMode,
} from '@/lib/chapterImport/parse';
import { IMPORT_LIMITS } from '@/lib/validation/chapterImport';
import { countWords, stripControlChars } from '@/lib/validation/common';
import styles from './BatchImportPanel.module.css';

/**
 * 批次匯入面板（FEAT-7 7-C，contracts/internal-modules.md §8）
 * ============================================================
 * **判定一律呼叫 `gradePreview`**，MUST NOT 在本層另算一次（FR-002c）——
 * 伺服器呼叫的是同一支，只有 `mode` 不同。元件層自己判一次的後果是
 * 「畫面說可以匯入、伺服器說不行」，而兩邊都「用了同一組純函式」。
 *
 * **既有章號由 props 傳入**（FR-002a、research R-2）：作品管理頁的 server component
 * 已經帶著 `novel.volumes[].chapters[]`，MUST NOT 為此新增 GET 端點。
 *
 * **正文淨化用 `stripControlChars`** —— 伺服器端 `sanitizeBody()` 所在的檔案帶
 * `server-only`，client 引用不到。兩者輸出逐字相同，由
 * `tests/unit/chapterImport-parse.test.ts` 的等價案鎖死（FR-007a）。
 */

interface BatchImportPanelProps {
  volume: { id: string; number: number; title: string };
  /**
   * **整部作品**的既有章號與標題，不是這一卷的。
   * 章號的唯一鍵是 `@@unique([novelId, number])` —— 只比對本卷會讓預覽說可以匯入、
   * 伺服器回 409。
   */
  existingChapters: ReadonlyArray<{ number: number; title: string }>;
  /** 匯入成功後通知父層（收起面板並回到章節管理畫面，FR-004c） */
  onImported?: (created: number) => void;
}

/** 選定的檔案與其解析結果。`file` 保留原件供送出使用（正文自始不重新編碼） */
interface PickedFile {
  file: File;
  row: ParsedChapterFile;
}

/**
 * 作業階段。`verifying` 是逾時／中斷後的重查（FR-004e），**不是重試**。
 * 送出控制項在非 `idle` 的每一個階段都停用（FR-004a）
 */
type Phase = 'idle' | 'reading' | 'uploading' | 'writing' | 'verifying';

/**
 * XHR 逾時。上界情境（1000 章／50 MB）的單一交易本身就以 30 秒計，
 * 加上傳輸時間後 10 分鐘是「已經不對勁」的門檻，不是預期耗時。
 * 逾時之後 MUST NOT 自動重試（FR-004d）—— 伺服器交易可能已經成功。
 */
const REQUEST_TIMEOUT_MS = 600_000;

/**
 * 重查前的等待時間。`router.refresh()` 不回 Promise，拿不到「伺服器元件已重新渲染完」
 * 這個時點，故以一次短等待後讀取最新的 props（`existingRef`）。
 * 查不到 MUST NOT 說成「匯入失敗」（FR-004e）—— 全有全無的交易在 commit 前查不到。
 */
const VERIFY_DELAY_MS = 1_500;

const LEVEL_CLASS = {
  ok: styles['row__verdict--ok'],
  warning: styles['row__verdict--warning'],
  error: styles['row__verdict--error'],
  skipped: styles['row__verdict--skipped'],
} as const;

/** 檔案 → `ParsedChapterFile`。解析規則一律取自 `@/lib/chapterImport/parse`（FR-002c） */
async function readFile(file: File): Promise<PickedFile> {
  const filename = file.name.normalize('NFC');
  const named = parseChapterFilename(filename);
  const decoded = decodeUtf8Strict(await file.arrayBuffer());
  const body = decoded === null ? null : stripControlChars(decoded);

  return {
    file,
    row: {
      filename,
      relativePath: file.webkitRelativePath ?? '',
      byteSize: file.size,
      number: named?.number ?? null,
      title: named?.title ?? null,
      body,
      wordCount: body === null ? 0 : countWords(body),
    },
  };
}

/**
 * 摘要列文字（FR-002d）。**組成單一字串**：`aria-live` 播報的是節點的純文字內容，
 * 拆成多個節點時輔助技術唸出的順序與停頓不受控。
 * 缺號措辭為「匯入後第 21–99 章缺號」（US3 AC4b）—— 只寫區間看不出那是匯入**之後**的狀態。
 */
function summaryText(summary: ImportPreview['summary']): string {
  let text = `可匯入 ${summary.importable} 章`;
  if (summary.emptyBody > 0) text += `，其中 ${summary.emptyBody} 章正文為空`;
  if (summary.skipped > 0) text += `；已略過 ${summary.skipped} 項`;
  if (summary.errors > 0) text += `；${summary.errors} 項有錯誤`;
  if (summary.conflicts > 0) text += `（含 ${summary.conflicts} 項章號衝突）`;
  if (summary.gaps.length > 0) text += `；匯入後${summary.gaps.join('、')}缺號`;
  return text;
}

export function BatchImportPanel({ volume, existingChapters, onImported }: BatchImportPanelProps) {
  const router = useRouter();
  const filesInputId = useId();
  const folderInputId = useId();

  const filesInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const verifyTimerRef = useRef<number | null>(null);
  /**
   * 摘要列。送出後焦點交給它（FR-004a 的無障礙配套，T046）——
   * **停用一個正被聚焦的元素會讓焦點掉回 `<body>`**，鍵盤與螢幕閱讀器使用者
   * 得從頭 Tab 一遍才找得回作業進度。摘要列在整個作業期間都在，且是 aria-live 的播報點
   */
  const summaryRef = useRef<HTMLParagraphElement>(null);

  /** 重查時要讀的是**當下最新**的 props，而非閉包捕捉到的那一份 */
  const existingRef = useRef(existingChapters);

  const [picked, setPicked] = useState<{ mode: PickMode; files: PickedFile[] } | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [notice, setNotice] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);

  // 同步最新的 props 進 ref（render 期間 MUST NOT 寫 ref）
  useEffect(() => {
    existingRef.current = existingChapters;
  }, [existingChapters]);

  useEffect(() => {
    return () => {
      if (verifyTimerRef.current !== null) window.clearTimeout(verifyTimerRef.current);
    };
  }, []);

  const preview = useMemo(
    () =>
      picked === null
        ? null
        : gradePreview(
            picked.files.map((entry) => entry.row),
            existingChapters,
            picked.mode
          ),
    [picked, existingChapters]
  );

  /**
   * 批次級上限的前端預判（FR-002b、T040）。三項上限中，**單檔**屬逐檔判定，
   * 已由 `FILE_TOO_LARGE` 逐列標示；此處補的是另外兩項 —— 它們是整批的性質，
   * 掛不到任何一列上，少了這兩行的話作者只會看到一個停用的送出鈕而不知道為什麼。
   *
   * 措辭 MUST 與伺服器逐字相同（`route.ts` 第 6 步與服務層 `assertSubmittable`）——
   * 同一件事在兩處給出不同說法，作者會以為是兩個不同的問題。
   *
   * **MUST NOT 取代伺服器判定**：這裡只是不讓明知會被拒的請求出門，
   * 伺服器仍以同一組 `IMPORT_LIMITS` 重驗一次（FR-002b）。
   */
  const limitNotices = useMemo(() => {
    if (preview === null) return [];
    // 略過的列不會被送出，故不計入檔案數 —— 與 `gradePreview` 的 `canSubmit` 同一組判準
    const sentCount = preview.rows.length - preview.summary.skipped;
    const notices: string[] = [];

    if (sentCount > IMPORT_LIMITS.maxFiles) {
      notices.push(`已選 ${sentCount} 個，上限 ${IMPORT_LIMITS.maxFiles} 個`);
    }
    if (preview.summary.totalBytes > IMPORT_LIMITS.maxTotalBytes) {
      notices.push(
        `總大小 ${preview.summary.totalBytes} 位元組，上限 ${IMPORT_LIMITS.maxTotalBytes} 位元組`
      );
    }
    return notices;
  }, [preview]);

  /** 衝突列要指名撞到的是哪一章，故需要既有標題（FR-002a 帶標題的理由） */
  const existingTitleByNumber = useMemo(
    () => new Map(existingChapters.map((chapter) => [chapter.number, chapter.title])),
    [existingChapters]
  );

  /**
   * 逐列訊息。**衝突列 MUST 指名撞到的既有章節**（FR-010(b)、US3 AC3）——
   * `VERDICT_MESSAGE` 是前後端共用的通用文案，帶不出既有標題，
   * 而只說「章號與作品既有章節重複」的話，作者得自己回作品目錄查那一章是哪一章。
   */
  const messageOf = (row: ImportPreview['rows'][number]): string => {
    if (row.verdict !== 'CONFLICT_EXISTING' || row.number === null) {
      return VERDICT_MESSAGE[row.verdict];
    }
    return `與既有第 ${row.number} 章《${existingTitleByNumber.get(row.number) ?? ''}》衝突`;
  };

  /**
   * 資料夾模式下**每一列都被略過**（非 `.md` 或位於子目錄內）。
   * 此時光顯示「可匯入 0 章」等於一片空白的預覽，作者看不出是選錯資料夾還是程式沒反應。
   * 判準取自 `summary.importable === 0`（data-model §2.2 的第四個阻擋條件）；
   * 併記 `errors === 0` 是為了不把「有 .md 但全部有錯」誤報成「沒有章節檔」
   */
  const emptyFolder =
    picked?.mode === 'folder' &&
    preview !== null &&
    preview.summary.importable === 0 &&
    preview.summary.errors === 0;

  const busy = phase !== 'idle';

  /** 清空選檔（取消時亦用此，FR-004：取消不發任何請求） */
  const clearPicked = () => {
    setPicked(null);
    setProgress(0);
    if (filesInputRef.current) filesInputRef.current.value = '';
    if (folderInputRef.current) folderInputRef.current.value = '';
  };

  const onPick = async (fileList: FileList | null, mode: PickMode) => {
    setNotice(null);
    const files = Array.from(fileList ?? []);
    if (files.length === 0) {
      clearPicked();
      return;
    }
    setPhase('reading');
    const read = await Promise.all(files.map(readFile));
    setPicked({ mode, files: read });
    setPhase('idle');
  };

  /**
   * 逾時或連線中斷後的處置（FR-004d、FR-004e）。
   * **MUST NOT 自動重試** —— 伺服器交易可能已經成功，重試只會整批撞號中止。
   */
  const verifyAfterFailure = (expected: number[]) => {
    setPhase('verifying');
    setNotice({ tone: 'info', text: '連線中斷，正在確認伺服器狀態…' });
    router.refresh();

    verifyTimerRef.current = window.setTimeout(() => {
      const landedNumbers = new Set(existingRef.current.map((chapter) => chapter.number));
      const landed = expected.filter((number) => landedNumbers.has(number));
      if (landed.length > 0) {
        setNotice({ tone: 'info', text: `已建立 ${landed.length} 章` });
        clearPicked();
      } else {
        // 措辭是這條需求的全部內容：查不到並不等於失敗，
        // 斷言失敗會誘使作者重送，而重送必然整批撞號中止
        setNotice({ tone: 'info', text: '尚未看到新章節，請稍後重新整理確認' });
      }
      setPhase('idle');
    }, VERIFY_DELAY_MS);
  };

  const submit = () => {
    if (picked === null || preview === null || !preview.canSubmit) return;

    const sent = preview.rows.filter(
      (row) => levelOfVerdict(row.verdict, picked.mode) !== 'skipped'
    );
    const expected = sent.flatMap((row) => (row.number === null ? [] : [row.number]));
    const sentNames = new Set(sent.map((row) => row.filename));

    const form = new FormData();
    for (const entry of picked.files) {
      if (sentNames.has(entry.row.filename)) form.append('files', entry.file, entry.row.filename);
    }

    // `fetch()` 沒有上傳進度事件（research R-6），故走 XMLHttpRequest
    const xhr = new XMLHttpRequest();
    xhr.open('POST', apiUrl(`/api/author/volumes/${volume.id}/chapters/import`));
    xhr.timeout = REQUEST_TIMEOUT_MS;

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) setProgress(Math.round((event.loaded / event.total) * 100));
    };
    // 上傳完成之後是伺服器的單一交易，進度無法分段回報 ——
    // 誠實的忙碌指示勝過假的百分比（FR-004b）
    xhr.upload.onload = () => setPhase('writing');

    xhr.onload = () => {
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(xhr.responseText) as unknown;
      } catch {
        parsed = null;
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        const created = (parsed as { created?: number } | null)?.created ?? 0;
        setPhase('idle');
        setNotice({ tone: 'info', text: `已建立 ${created} 章` });
        clearPicked();
        router.refresh();
        onImported?.(created);
        return;
      }

      const message =
        (parsed as { error?: { message?: string } } | null)?.error?.message ??
        '匯入失敗，請稍後再試';
      setPhase('idle');
      setNotice({ tone: 'error', text: message });
    };

    xhr.onerror = () => verifyAfterFailure(expected);
    xhr.ontimeout = () => verifyAfterFailure(expected);

    // 送出控制項在此之後即停用，直到作業結束（FR-004a）
    setPhase('uploading');
    setProgress(0);
    setNotice(null);
    // 停用之前先把焦點移開，否則它會隨著停用掉回 <body>（見 summaryRef 的說明）
    summaryRef.current?.focus();
    xhr.send(form);
  };

  return (
    <div className={styles.panel}>
      <div className={styles.pickers}>
        <div className={styles.field}>
          <label className={styles.field__label} htmlFor={filesInputId}>
            選擇章節檔（可多選）
          </label>
          <input
            id={filesInputId}
            ref={filesInputRef}
            className={styles.input}
            type="file"
            multiple
            accept=".md"
            disabled={busy}
            onChange={(event) => void onPick(event.target.files, 'files')}
          />
          <p className={styles.field__hint}>檔名慣例：第N章_標題.md</p>
        </div>

        <div className={styles.field}>
          <label className={styles.field__label} htmlFor={folderInputId}>
            選擇整個資料夾
          </label>
          {/*
            `webkitdirectory` 不在 React 的 HTML 屬性型別裡（非標準屬性，但三大瀏覽器皆支援）。
            以展開語法傳入，屬性名 MUST 全小寫 —— React 對未知屬性原樣輸出（research R-13）
          */}
          <input
            id={folderInputId}
            ref={folderInputRef}
            className={styles.input}
            type="file"
            multiple
            disabled={busy}
            onChange={(event) => void onPick(event.target.files, 'folder')}
            {...({ webkitdirectory: '' } as Record<string, string>)}
          />
          <p className={styles.field__hint}>非 .md 與子目錄內的檔案會列為已略過</p>
        </div>
      </div>

      {/* 摘要列。上千列的逐列標示會被滑過去，這一行是作者唯一會讀到的（FR-002d） */}
      {preview !== null && (
        <p className={styles.summary} ref={summaryRef} tabIndex={-1} aria-live="polite">
          {emptyFolder
            ? `此資料夾沒有可匯入的章節檔；已略過 ${preview.summary.skipped} 項`
            : summaryText(preview.summary)}
        </p>
      )}

      {limitNotices.length > 0 && (
        <ul className={styles.limits} aria-live="polite">
          {limitNotices.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      )}

      {preview !== null && (
        <ul className={styles.rows}>
          {preview.rows.map((row) => {
            const level = levelOfVerdict(row.verdict, picked?.mode ?? 'files');
            return (
              <li key={row.relativePath || row.filename} className={styles.row}>
                <span className={styles.row__name}>{row.filename}</span>
                <span className={styles.row__meta}>
                  {row.number === null ? '章號未知' : `第 ${row.number} 章`}
                  {row.title !== null && `・${row.title}`}・{row.wordCount} 字
                </span>
                <span className={`${styles.row__verdict} ${LEVEL_CLASS[level]}`}>
                  {messageOf(row)}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {phase === 'uploading' && (
        <div className={styles.progress}>
          <Progress value={progress} showLabel label="上傳中" aria-label="上傳進度" />
        </div>
      )}
      {phase === 'writing' && (
        <p className={styles.notice} role="status">
          寫入中，請勿關閉此頁…
        </p>
      )}

      <p
        className={`${styles.notice} ${notice?.tone === 'error' ? styles['notice--error'] : ''}`}
        role="status"
        aria-live="polite"
      >
        {notice?.text ?? ''}
      </p>

      <div className={styles.actions}>
        <Button
          type="button"
          size="sm"
          variant="primary"
          disabled={busy || preview === null || !preview.canSubmit}
          onClick={submit}
        >
          確認匯入
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={clearPicked}>
          取消
        </Button>
      </div>
    </div>
  );
}
