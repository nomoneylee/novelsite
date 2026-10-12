'use client';

import { useState, useCallback, useId, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  TextB,
  TextItalic,
  TextHOne,
  ListBullets,
  FloppyDisk,
  Rocket,
  ArrowCounterClockwise,
  CalendarBlank,
} from '@phosphor-icons/react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SafeMarkdown } from '@/components/ui/SafeMarkdown';
import {
  saveChapterDraftAction,
  publishChapterAction,
  unpublishChapterAction,
  cancelScheduleAction,
} from '@/app/author/actions';
import type { AuthorChapterSummary } from '@/lib/types';
import styles from './ChapterEditor.module.css';

/** 排程時刻的顯示格式；作者看的是自己所在時區的「幾月幾號幾點」 */
function formatScheduled(iso: string): string {
  return new Date(iso).toLocaleString('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const TOOLBAR_ACTIONS = [
  { icon: TextHOne, label: '標題', wrap: ['## ', ''] as [string, string] },
  { icon: TextB, label: '粗體', wrap: ['**', '**'] as [string, string] },
  { icon: TextItalic, label: '斜體', wrap: ['_', '_'] as [string, string] },
  { icon: ListBullets, label: '清單', wrap: ['- ', ''] as [string, string] },
];

interface ChapterEditorProps {
  draft: AuthorChapterSummary;
}

type ActionFailure = {
  success: false;
  error: { message: string; fields?: Record<string, string> };
};

function isFailure(result: unknown): result is ActionFailure {
  return (
    typeof result === 'object' &&
    result !== null &&
    (result as { success?: boolean }).success === false
  );
}

/**
 * 章節編輯器（FR-013、FR-012b、FR-017）。
 *
 * **控制項依章節狀態切換**：草稿顯示「儲存草稿／發佈章節」，已發佈顯示「儲存／下架此章」。
 * 兩組不可混用 —— 對一篇已經上線的章節顯示「發佈章節」，作者按下去之前無從知道
 * 那到底是「重新發佈」還是「什麼都不會發生」。
 *
 * **預覽與讀者端共用 `<SafeMarkdown>`**（FR-017）：原本這裡直接用 `ReactMarkdown`
 * 且未帶 `rehype-sanitize`，等於預覽窗是全站唯一沒有淨化的渲染路徑；
 * 作者在預覽看到的與讀者實際讀到的，現在保證是同一套規則。
 *
 * **排程發佈**（FEAT-4 4-D / T140，FR-049～FR-050）：草稿可指定未來時間排程；
 * 已排程的章節以**文字**顯示「已排程於 X 發佈」並提供取消 —— 非只靠 Badge 顏色（FR-064）。
 * 過去時間由服務層回 400，此處 MUST NOT 自行放行或悄悄改成立即發佈。
 */
export function ChapterEditor({ draft }: ChapterEditorProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const [title, setTitle] = useState(draft.title);
  const [content, setContent] = useState(draft.contentMarkdown);
  const status = draft.status;

  const scheduleInputId = useId();
  const [scheduleOpen, setScheduleOpen] = useState(false);
  // `datetime-local` 的值是**本地時間**字串（無時區），`new Date(值)` 依瀏覽器時區解讀 ——
  // 作者輸入的就是自己看到的時間，這正是要的
  const [scheduleAt, setScheduleAt] = useState('');

  const run = (action: () => Promise<unknown>, successMessage: string) => {
    setMessage(null);
    setFieldError(null);
    startTransition(async () => {
      const result = await action();
      if (isFailure(result)) {
        const fields = result.error.fields;
        setFieldError(fields ? Object.values(fields)[0] : null);
        setMessage(result.error.message);
        return;
      }
      setMessage(successMessage);
      router.refresh();
    });
  };

  const save = () =>
    run(
      () => saveChapterDraftAction({ chapterId: draft.id, title, bodyMarkdown: content }),
      status === 'published' ? '已儲存' : '草稿已儲存'
    );

  /**
   * 發佈前先儲存目前的標題與正文 —— 否則作者剛打完字直接按發佈，
   * 上線的會是上一次儲存的版本，而畫面上看起來完全正常。
   */
  const publish = () =>
    run(async () => {
      const saved = await saveChapterDraftAction({
        chapterId: draft.id,
        title,
        bodyMarkdown: content,
      });
      if (isFailure(saved)) return saved;
      return publishChapterAction({ chapterId: draft.id });
    }, '章節已發佈');

  const unpublish = () =>
    run(() => unpublishChapterAction({ chapterId: draft.id }), '章節已下架，回到草稿');

  /**
   * 排程發佈：與立即發佈同樣**先儲存**目前的標題與正文 ——
   * 到期時發佈的會是資料庫裡的版本，而作者按下排程時看到的是編輯器裡的版本。
   */
  const schedule = () =>
    run(async () => {
      const saved = await saveChapterDraftAction({
        chapterId: draft.id,
        title,
        bodyMarkdown: content,
      });
      if (isFailure(saved)) return saved;
      return publishChapterAction({
        chapterId: draft.id,
        scheduledAt: new Date(scheduleAt).toISOString(),
      });
    }, '已排程發佈');

  const cancelScheduleClick = () =>
    run(() => cancelScheduleAction({ chapterId: draft.id }), '已取消排程，章節維持草稿');

  const insertWrap = useCallback((before: string, after: string) => {
    const textarea = document.getElementById('chapter-content') as HTMLTextAreaElement | null;
    if (!textarea) return;
    const { selectionStart, selectionEnd, value } = textarea;
    const selected = value.slice(selectionStart, selectionEnd);
    const next =
      value.slice(0, selectionStart) + before + selected + after + value.slice(selectionEnd);
    setContent(next);
    requestAnimationFrame(() => {
      textarea.focus();
      const cursor = selectionStart + before.length + selected.length;
      textarea.setSelectionRange(cursor, cursor);
    });
  }, []);

  const wordCount = content.replace(/\s/g, '').length;

  return (
    <div className={styles.editor}>
      <header className={styles.editor__header}>
        {/* 返回作品管理頁而非作品列表（FR-012b）—— 作者是從那一頁進來的 */}
        <Link href={`/author/novels/${draft.novelId}`} className={styles.editor__back}>
          <ArrowLeft size={16} />
          返回《{draft.novelTitle}》管理
        </Link>

        <div className={styles.editor__headerRow}>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="章節標題"
            fullWidth
            className={styles.editor__titleInput}
          />
          <div className={styles.editor__actions}>
            <span className={`${styles.editor__status} ${styles[`editor__status--${status}`]}`}>
              {status === 'published' ? '已發佈' : '草稿'}
            </span>

            <Button
              variant="secondary"
              size="sm"
              leftIcon={<FloppyDisk size={16} />}
              onClick={save}
              disabled={pending}
            >
              {status === 'published' ? '儲存' : '儲存草稿'}
            </Button>

            {status === 'published' ? (
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<ArrowCounterClockwise size={16} />}
                onClick={unpublish}
                disabled={pending}
              >
                下架此章
              </Button>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={<CalendarBlank size={16} />}
                  onClick={() => setScheduleOpen((open) => !open)}
                  disabled={pending}
                  aria-expanded={scheduleOpen}
                >
                  排程發佈
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  leftIcon={<Rocket size={16} />}
                  onClick={publish}
                  disabled={pending}
                >
                  發佈章節
                </Button>
              </>
            )}
          </div>
        </div>

        {/* 已排程的狀態以**文字**呈現（FR-064）：Badge 的顏色在單色列印、
            高對比模式與色覺差異下都可能消失，而「幾點會發佈」是不能靠猜的資訊 */}
        {status === 'draft' && draft.scheduledAt && (
          <p className={styles.editor__schedule} role="status">
            已排程於 {formatScheduled(draft.scheduledAt)} 發佈
            <button
              type="button"
              className={styles.editor__scheduleCancel}
              onClick={cancelScheduleClick}
              disabled={pending}
            >
              取消排程
            </button>
          </p>
        )}

        {status === 'draft' && scheduleOpen && (
          <div className={styles.editor__scheduleForm}>
            <label htmlFor={scheduleInputId} className={styles.editor__scheduleLabel}>
              發佈時間（須為未來時間）
            </label>
            <input
              id={scheduleInputId}
              type="datetime-local"
              className={styles.editor__scheduleInput}
              value={scheduleAt}
              onChange={(e) => setScheduleAt(e.target.value)}
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={schedule}
              disabled={pending || !scheduleAt}
            >
              確認排程
            </Button>
          </div>
        )}

        <p className={styles.editor__disabledNote} role="status" aria-live="polite">
          {fieldError ?? message}
        </p>
      </header>

      <div className={styles.editor__toolbar} role="toolbar" aria-label="Markdown 格式工具">
        {TOOLBAR_ACTIONS.map(({ icon: Icon, label, wrap }) => (
          <button
            key={label}
            type="button"
            className={styles.editor__toolbarBtn}
            onClick={() => insertWrap(wrap[0], wrap[1])}
            aria-label={label}
            title={label}
          >
            <Icon size={16} />
          </button>
        ))}
        <span className={styles.editor__wordCount}>{wordCount} 字</span>
      </div>

      <div className={styles.editor__panes}>
        <textarea
          id="chapter-content"
          className={styles.editor__textarea}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="開始輸入章節內容，支援 Markdown 語法……"
          spellCheck={false}
          aria-label="章節正文"
        />
        {/*
          MUST 為 `<section>` 而非 `<div>`：帶了 `aria-label` 的無角色 `div` 觸發 axe 的
          `aria-prohibited-attr` —— 一般容器不支援命名，那個標籤等於寫了沒用。
          `<section>` 有可及名稱時即成為 `region` landmark，標籤才真的被輔助技術讀到。
          （先前未被發現，是因為舊測試指向的示範草稿有內容；空章節才讓它現形。）
        */}
        <section className={styles.editor__preview} aria-label="Markdown 即時預覽">
          <SafeMarkdown>{content}</SafeMarkdown>
        </section>
      </div>
    </div>
  );
}
