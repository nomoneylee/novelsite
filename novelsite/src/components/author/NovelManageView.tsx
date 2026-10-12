'use client';

import React, { useEffect, useId, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  CaretRight,
  Plus,
  Trash,
  PencilSimple,
  UploadSimple,
} from '@phosphor-icons/react';
import { Badge, Button, Input, Modal, Textarea } from '@/components/ui';
import {
  updateNovelAction,
  publishNovelAction,
  deleteNovelAction,
  createVolumeAction,
  updateVolumeAction,
  deleteVolumeAction,
  createChapterAction,
  reorderChaptersAction,
  deleteChapterAction,
} from '@/app/author/actions';
import { COVER_COLORS } from '@/lib/validation/novel';
import type { AuthorNovelManage, AuthorManageVolume, Category, TagOption } from '@/lib/types';
import { BatchImportPanel } from './BatchImportPanel';
import { BatchActionBar } from './BatchActionBar';
import styles from './NovelManageView.module.css';

/**
 * 卷內批次操作的選取狀態（FEAT-8 T039，data-model.md §3.2）。
 *
 * **`volumeId` 與 `ids` 綁在同一個物件**：批次操作限單一卷（伺服器端不變量），
 * 而分成兩個 state 的寫法遲早會出現「ids 屬於 A 卷、volumeId 已是 B 卷」的中間態，
 * 那一刻送出的就是一批跨卷的識別碼 —— 伺服器會整批拒絕，作者看到的是「找不到」。
 */
interface BatchSelection {
  volumeId: string | null;
  ids: Set<string>;
}

/** 非選取中的卷共用同一個空集合，避免每次 render 造出新參考 */
const NO_SELECTION: ReadonlySet<string> = new Set<string>();

interface NovelManageViewProps {
  novel: AuthorNovelManage;
  categories: Category[];
  tags: TagOption[];
}

/** Action 的失敗回傳形狀（成功時多半以 redirect 或 `{ success: true }` 收尾） */
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
 * 作品管理頁的主體（FR-012a～FR-012d）。
 *
 * 五個區塊共用一組送出機制：**每一次寫入成功都 `router.refresh()`**。
 * 這一點是刻意的 —— 卷編號、章節編號與計數都由伺服器指派或回算，
 * 用本地 state 猜測「按下去之後應該長什麼樣」遲早會與資料庫分歧，
 * 而分歧的表現形式是「作者以為排好了，重新整理後又跳回去」。
 */
export function NovelManageView({ novel, categories, tags }: NovelManageViewProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  /**
   * 送出一次寫入；失敗時把訊息與欄位錯誤攤在畫面上，成功則重新取伺服器資料。
   *
   * `leaveTo` 供刪除作品使用 —— 那之後這一頁指向的資源已經不存在，
   * `refresh()` 只會換來一個 404 畫面。
   *
   * `onSuccess` 供作品資訊表單立起重填旗標用（FEAT-10 T031、FR-020、research R-9）。
   * **MUST 是可選參數**：其餘四個區塊一律不傳，行為一字不變。
   * **MUST NOT 改成回傳 Promise 讓呼叫端 await** —— 內部是 `startTransition`，
   * 把它變成可等待的東西會讓 `pending` 的語意跟著散掉。
   * **MUST NOT 讓表單繞過 `run()` 自己呼叫 action** —— 那會失去統一的
   * `setFields`／`setMessage` 與 `pending` 節流，等於為了一個旗標複製一份送出邏輯。
   */
  const run = (
    action: () => Promise<unknown>,
    successMessage: string,
    leaveTo?: string,
    onSuccess?: () => void
  ) => {
    setMessage(null);
    setFields({});
    startTransition(async () => {
      const result = await action();
      if (isFailure(result)) {
        setFields(result.error.fields ?? {});
        setMessage(result.error.message);
        return;
      }
      setMessage(successMessage);
      onSuccess?.();
      if (leaveTo) router.push(leaveTo);
      else router.refresh();
    });
  };

  const [selection, setSelection] = useState<BatchSelection>({ volumeId: null, ids: new Set() });

  /**
   * 勾選／取消勾選一章（FR-001）。
   *
   * **勾到別卷即清空前一卷的選取**（FR-002）：批次操作限單一卷，
   * 保留舊卷的識別碼只會讓下一次送出整批被拒。
   */
  const toggleChapter = (volumeId: string, chapterId: string) => {
    setSelection((prev) => {
      const ids = prev.volumeId === volumeId ? new Set(prev.ids) : new Set<string>();
      if (ids.has(chapterId)) ids.delete(chapterId);
      else ids.add(chapterId);
      return { volumeId, ids };
    });
  };

  /**
   * 以整組識別碼取代選取（「全選本卷」「只選草稿」，FR-001）。
   *
   * **`volumeId` 一併換成該卷**（FR-002）：對 B 卷按「全選本卷」時，
   * A 卷的選取就此消失 —— 兩卷各留一半的話，送出的是一批跨卷識別碼，會被整批拒絕。
   */
  const replaceSelection = (volumeId: string, ids: string[]) =>
    setSelection({ volumeId, ids: new Set(ids) });

  /** 操作**成功**後清空（FR-006）。失敗時 MUST NOT 呼叫 —— 見 `BatchActionBar` */
  const clearSelection = () => setSelection({ volumeId: null, ids: new Set() });

  const hasVolumes = novel.volumes.length > 0;
  const totalChapters = novel.volumes.reduce((sum, v) => sum + v.chapters.length, 0);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/author/novels" className={styles.back}>
          <ArrowLeft size={16} />
          返回作品列表
        </Link>

        <div className={styles.header__row}>
          <h1 className={styles.title}>{novel.title}</h1>
          <Badge variant={novel.status === 'published' ? 'success' : 'warning'} size="sm">
            {novel.status === 'published' ? '已上架' : '草稿'}
          </Badge>
        </div>
        <p className={styles.meta}>
          {novel.category}・{novel.chapterCount} 章已發佈・{novel.wordCount} 字
        </p>
      </header>

      {/* 送出結果。role="status" 使螢幕閱讀器在不搶焦點的前提下讀出變化 */}
      <p className={styles.status} role="status" aria-live="polite">
        {message}
      </p>

      <NovelInfoSection
        novel={novel}
        categories={categories}
        tags={tags}
        fields={fields}
        pending={pending}
        run={run}
      />

      <VolumeSection novel={novel} pending={pending} run={run} notify={setMessage} />

      <ChapterSection
        novel={novel}
        hasVolumes={hasVolumes}
        totalChapters={totalChapters}
        pending={pending}
        run={run}
        selection={selection}
        onToggleChapter={toggleChapter}
        onReplaceSelection={replaceSelection}
        onClearSelection={clearSelection}
      />

      <DangerZone novel={novel} pending={pending} run={run} />
    </div>
  );
}

type RunFn = (
  action: () => Promise<unknown>,
  successMessage: string,
  leaveTo?: string,
  onSuccess?: () => void
) => void;

// ─────────────────────────────────────────────
// 作品資訊（T048、FR-012c）
// ─────────────────────────────────────────────

function NovelInfoSection({
  novel,
  categories,
  tags,
  fields,
  pending,
  run,
}: {
  novel: AuthorNovelManage;
  categories: Category[];
  tags: TagOption[];
  fields: Record<string, string>;
  pending: boolean;
  run: RunFn;
}) {
  const categoryId = useId();
  const coverGroupId = useId();
  const tagGroupId = useId();

  const [form, setForm] = useState({
    title: novel.title,
    categoryId: novel.categoryId,
    excerpt: novel.excerpt,
    description: novel.description,
    coverColor: novel.coverColor,
    serialStatus: novel.serialStatus,
  });
  const [tagIds, setTagIds] = useState<string[]>(novel.tagIds);

  /**
   * FormResyncFlag（FEAT-10 T032、FR-020、contracts §7、research R-9）。
   *
   * **缺陷是什麼**：`title`／`excerpt`／`description` 在伺服器端會被 `trim()`
   * （`validation/novel.ts`），表單狀態不會。存了「` 標題 `」之後資料庫是「標題」、
   * 畫面仍是「` 標題 `」，且下一次儲存會再送一次未修剪的值。
   *
   * **MUST NOT 改成「props 一變就重填」**：本頁其他操作（新增章節、排序、批次發佈、
   * 上下架）也都會 `router.refresh()`，那樣會在作者打字打到一半時清掉未儲存的輸入——
   * 用一個空白字元的問題換一個資料遺失的問題。**MUST NOT 對表單加 `key` 強制重建**，
   * 那連焦點都會掉（本專案 2026-09-06 才因為 `key` 重建造成搜尋框失焦）。
   */
  const [resyncPending, setResyncPending] = useState(false);

  /**
   * 上一次看到的 `novel` **身分**，用來認出「伺服器資料換了一份」的那一次渲染。
   *
   * **這不違反 research R-3 的第二條 MUST NOT**：那一條擋的是「把 `novel` 複製進 state
   * **並改為從那份副本渲染**」（複製之後刷新的新資料上不了畫面）。這裡存的是參考本身、
   * 只拿來比對身分，畫面上的每一個欄位仍然來自 `form`／`tagIds`。
   */
  const [prevNovel, setPrevNovel] = useState(novel);

  /*
    渲染期間直接調整狀態，**不是**用 `useEffect` —— 這是 React 官方對
    「props 變了要重設 state」給的作法（Adjusting state when a prop changes），
    也是本專案 `useSyncedList`（`components/admin/useAdminList.ts`）的既有寫法。
    寫成 effect 會多一次「先用舊值畫一遍、再用新值重畫」的閃爍，
    而且會被 `react-hooks/set-state-in-effect` 擋下。
  */
  if (novel !== prevNovel) {
    setPrevNovel(novel);
    if (resyncPending) {
      setResyncPending(false);
      setForm({
        title: novel.title,
        categoryId: novel.categoryId,
        excerpt: novel.excerpt,
        description: novel.description,
        coverColor: novel.coverColor,
        serialStatus: novel.serialStatus,
      });
      setTagIds(novel.tagIds);
    }
  }

  const toggleTag = (id: string) => {
    setTagIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  };

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    /*
      旗標 MUST 在**送出成功**時才立（第四個參數，T031）—— 失敗時重填等於把作者
      剛改的內容換回伺服器上的舊值，而他正要修正的就是那個錯誤。
      第三個參數 `leaveTo` 不適用於本表單，故傳 undefined。
    */
    run(
      () => updateNovelAction({ novelId: novel.id, ...form, tagIds }),
      '作品資訊已更新',
      undefined,
      () => setResyncPending(true)
    );
  };

  return (
    <section className={styles.section} aria-labelledby="section-info">
      <h2 id="section-info" className={styles.section__title}>
        作品資訊
      </h2>

      <form className={styles.form} onSubmit={onSubmit} noValidate>
        <Input
          label="作品名稱"
          value={form.title}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          error={fields.title}
          fullWidth
        />

        <div className={styles.field}>
          <label className={styles.field__label} htmlFor={categoryId}>
            分類
          </label>
          <select
            id={categoryId}
            className={styles.select}
            value={form.categoryId}
            onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.emoji} {c.label}
              </option>
            ))}
          </select>
        </div>

        <Textarea
          label="作品簡介"
          value={form.excerpt}
          onChange={(e) => setForm((f) => ({ ...f, excerpt: e.target.value }))}
          error={fields.excerpt}
          rows={3}
          fullWidth
        />

        <Textarea
          label="完整描述（選填）"
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          error={fields.description}
          rows={5}
          fullWidth
        />

        {/* 標籤：只能自既有集合多選，MUST NOT 提供「新增標籤」入口（FR-012c） */}
        <fieldset className={styles.fieldset} aria-describedby={tagGroupId}>
          <legend className={styles.field__label}>標籤</legend>
          <p id={tagGroupId} className={styles.hint}>
            只能自既有標籤中挑選；若清單裡沒有合適的，請聯絡站方新增
          </p>
          {fields.tagIds && <p className={styles.error}>{fields.tagIds}</p>}
          <div className={styles.tagGrid}>
            {tags.map((tag) => (
              <label key={tag.id} className={styles.tagOption}>
                <input
                  type="checkbox"
                  checked={tagIds.includes(tag.id)}
                  onChange={() => toggleTag(tag.id)}
                />
                <span>{tag.name}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* 封面色：白名單色票，非任意輸入（FR-012） */}
        <fieldset className={styles.fieldset} aria-describedby={coverGroupId}>
          <legend className={styles.field__label}>封面色</legend>
          <p id={coverGroupId} className={styles.hint}>
            自既有色票中挑選，作為無封面圖時的漸層底色
          </p>
          <div className={styles.swatchGrid}>
            {COVER_COLORS.map((color, index) => (
              <label key={color} className={styles.swatch}>
                <input
                  type="radio"
                  name="coverColor"
                  value={color}
                  checked={form.coverColor === color}
                  onChange={() => setForm((f) => ({ ...f, coverColor: color }))}
                />
                <span
                  className={styles.swatch__chip}
                  style={{ background: color }}
                  aria-hidden="true"
                />
                <span className="sr-only">色票 {index + 1}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className={styles.actions}>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? '儲存中…' : '儲存作品資訊'}
          </Button>
        </div>
      </form>
    </section>
  );
}

// ─────────────────────────────────────────────
// 卷管理（T049、FR-003c／FR-012d）
// ─────────────────────────────────────────────

function VolumeSection({
  novel,
  pending,
  run,
  notify,
}: {
  novel: AuthorNovelManage;
  pending: boolean;
  run: RunFn;
  /**
   * 把一句話送到頁首的 `role="status"` 區。批次匯入不走 `run()`（它不是 Server Action，
   * 而是 XHR 上傳），成功訊息因此沒有其他管道 —— 少了它，作者按完確認只會看到面板消失
   * （FEAT-7 T045 實作補述，2026-08-22：quickstart §3 US1 表寫的是「導回管理頁，顯示
   * 『已建立 N 章』」，而面板一收起，它自己那句訊息就隨元件卸載了）
   */
  notify: (message: string) => void;
}) {
  const newVolumeId = useId();
  const [newTitle, setNewTitle] = useState('');
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [importing, setImporting] = useState<string | null>(null);

  /**
   * 批次匯入的既有章號比對對象是**整部作品**，不是單一卷（`@@unique([novelId, number])`）。
   * 資料已在本頁的 props 裡，**MUST NOT 為此新增 GET 端點**（FEAT-7 research R-2）。
   */
  const existingChapters = novel.volumes.flatMap((v) =>
    v.chapters.map((chapter) => ({ number: chapter.number, title: chapter.title }))
  );

  return (
    <section className={styles.section} aria-labelledby="section-volumes">
      <h2 id="section-volumes" className={styles.section__title}>
        分卷
      </h2>

      {novel.volumes.length === 0 ? (
        <p className={styles.empty}>
          這部作品還沒有任何卷。<strong>先建立第一卷</strong>，才能開始新增章節。
        </p>
      ) : (
        <ul className={styles.volumeList}>
          {novel.volumes.map((volume) => (
            <li key={volume.id} className={styles.volumeRow}>
              {editing?.id === volume.id ? (
                <form
                  className={styles.inlineForm}
                  onSubmit={(e) => {
                    e.preventDefault();
                    run(
                      () => updateVolumeAction({ volumeId: volume.id, title: editing.title }),
                      '卷標題已更新'
                    );
                    setEditing(null);
                  }}
                >
                  <Input
                    value={editing.title}
                    onChange={(e) => setEditing({ id: volume.id, title: e.target.value })}
                    aria-label={`第 ${volume.number} 卷的新標題`}
                    fullWidth
                  />
                  <Button type="submit" size="sm" variant="primary" disabled={pending}>
                    儲存
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
                    取消
                  </Button>
                </form>
              ) : (
                <>
                  <span className={styles.volumeRow__name}>
                    第 {volume.number} 卷・{volume.title}
                    <span className={styles.volumeRow__count}>（{volume.chapters.length} 章）</span>
                  </span>
                  <div className={styles.rowActions}>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      leftIcon={<PencilSimple size={14} />}
                      onClick={() => setEditing({ id: volume.id, title: volume.title })}
                      aria-label={`重新命名第 ${volume.number} 卷`}
                    >
                      重新命名
                    </Button>
                    {/* 批次匯入入口（FEAT-7 FR-001）。就地展開，不另開頁 */}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      leftIcon={<UploadSimple size={14} />}
                      onClick={() =>
                        setImporting((current) => (current === volume.id ? null : volume.id))
                      }
                      aria-expanded={importing === volume.id}
                      aria-label={`批次上傳章節到第 ${volume.number} 卷`}
                    >
                      批次上傳
                    </Button>
                    {/*
                      刪除卷為**單層按鈕確認**（FR-012d）：按一下變成「確認刪除」，再按一下才真的送出。
                      MUST NOT 要求輸入卷名 —— 那個強度是保留給刪除整部作品的（T051）；
                      對一個空卷施加同等摩擦，只會讓作者學會無視所有確認步驟。
                    */}
                    {confirmDelete === volume.id ? (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          variant="danger"
                          disabled={pending}
                          onClick={() => {
                            run(
                              () => deleteVolumeAction({ volumeId: volume.id }),
                              `第 ${volume.number} 卷已刪除`
                            );
                            setConfirmDelete(null);
                          }}
                        >
                          確認刪除
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setConfirmDelete(null)}
                        >
                          取消
                        </Button>
                      </>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        leftIcon={<Trash size={14} />}
                        onClick={() => setConfirmDelete(volume.id)}
                        aria-label={`刪除第 ${volume.number} 卷`}
                      >
                        刪除
                      </Button>
                    )}
                  </div>
                </>
              )}

              {importing === volume.id && (
                <div className={styles.importPanel}>
                  <BatchImportPanel
                    volume={{ id: volume.id, number: volume.number, title: volume.title }}
                    existingChapters={existingChapters}
                    onImported={(created) => {
                      setImporting(null);
                      notify(`已建立 ${created} 章`);
                    }}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <form
        className={styles.inlineForm}
        onSubmit={(e) => {
          e.preventDefault();
          run(() => createVolumeAction({ novelId: novel.id, title: newTitle }), '已新增一卷');
          setNewTitle('');
        }}
      >
        <div className={styles.field}>
          <label className={styles.field__label} htmlFor={newVolumeId}>
            新增卷（編號由系統指派）
          </label>
          <Input
            id={newVolumeId}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="例如：第一卷 少年篇"
            fullWidth
          />
        </div>
        <Button
          type="submit"
          size="sm"
          variant="secondary"
          leftIcon={<Plus size={14} />}
          disabled={pending}
        >
          新增卷
        </Button>
      </form>
    </section>
  );
}

// ─────────────────────────────────────────────
// 章節列表與卷內排序（T050、FR-003a／FR-003b）
// ─────────────────────────────────────────────

function ChapterSection({
  novel,
  hasVolumes,
  totalChapters,
  pending,
  run,
  selection,
  onToggleChapter,
  onReplaceSelection,
  onClearSelection,
}: {
  novel: AuthorNovelManage;
  hasVolumes: boolean;
  totalChapters: number;
  pending: boolean;
  run: RunFn;
  selection: BatchSelection;
  onToggleChapter: (volumeId: string, chapterId: string) => void;
  onReplaceSelection: (volumeId: string, ids: string[]) => void;
  onClearSelection: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  /**
   * 核取方塊 id 的前綴（FR-030）。**MUST 由 `useId()` 產生**（憲章第 V 條）——
   * `Math.random()` 在伺服器與瀏覽器會給出不同的值，hydration 時 `htmlFor` 與 `id` 對不上，
   * 而那正好只壞掉「點標籤能勾選」與螢幕閱讀器的名稱關聯，畫面上看不出來
   */
  const checkboxIdPrefix = useId();
  /** 章節清單容器 id 的前綴（`aria-controls` 的目標）。同上，MUST 由 `useId()` 產生 */
  const chapterListIdPrefix = useId();

  /**
   * 展開中的卷（FEAT-10 T013，FR-004／FR-005）。
   *
   * **MUST 用 lazy initializer**：一般初值每次 render 都會重新算一次那個 `new Set(...)`，
   * `router.refresh()` 之後就會把作者展開的卷打回預設。
   *
   * **MUST NOT 加任何「卷數變了就重算」的 effect**（FR-004 明訂「預設」＝**頁面載入時**）。
   * 連帶的已知行為：0 卷的作品在本頁建立第一卷之後，那一卷是**收合**的——
   * 建立卷走的是軟刷新，不是載入。**這是刻意的，MUST NOT 當成 bug 去修**：
   * 剛建好的卷必然沒有章節，展開它只會看到空狀態文案；而「卷數一變就重算」
   * 會在作者展開第 4 卷、接著刪掉第 5 卷時把展開狀態打回預設，直接違反 FR-011。
   */
  const [expandedVolumeIds, setExpandedVolumeIds] = useState<Set<string>>(() =>
    novel.volumes.length === 1 ? new Set([novel.volumes[0].id]) : new Set<string>()
  );

  const toggleVolume = (volumeId: string) => {
    setExpandedVolumeIds((prev) => {
      const next = new Set(prev);
      if (!next.delete(volumeId)) next.add(volumeId);
      return next;
    });
  };

  /**
   * 收合狀態下的卷摘要（FEAT-10 T015，FR-002、contracts §1.2）。
   *
   * **計數規則**：`published` 計入已發佈，**其餘一律計入草稿**——`admin_suspended` 亦然。
   * MUST NOT 自行拆出第三個數字：既有的章節列徽章已經是「非 `published` 一律顯示草稿」，
   * 摘要若拆三欄，就會出現「摘要說有 1 章被下架、展開後每一列都寫草稿」的自相矛盾，
   * 而要消除它就得連帶改既有徽章——本階段範圍外（spec FR-002 的已知取捨）。
   *
   * 0 章時只回「0 章」：「（已發佈 0・草稿 0）」除了佔位之外不帶任何資訊。
   */
  const volumeSummary = (volume: AuthorManageVolume): string => {
    const total = volume.chapters.length;
    if (total === 0) return '0 章';
    const published = volume.chapters.filter((c) => c.status === 'published').length;
    return `${total} 章（已發佈 ${published}・草稿 ${total - published}）`;
  };

  /**
   * 剛被移動、資料回來後要確保仍看得見的那一章（FEAT-10 T024，FR-012、contracts §4、
   * data-model「PendingScrollTarget」）。
   *
   * **只靠「`scrollTop` 沒變」是不夠的**：`scrollTop` 確實不變，但被移動的那一列
   * 換到了上／下一個位置——在清單邊緣時它就會離開可視範圍，而那正是最常按上移的位置
   * （把某章往清單頂端搬）。
   *
   * **持有方式是 `useRef` 而非 `useState`**（`/speckit-implement` T024 裁示，2026-09-06）：
   * 這個值從不參與渲染，改變它不該引發重新渲染；而 `useState` 版本要在 effect 內清為 null，
   * 那正是 `react-hooks/set-state-in-effect` 擋下的寫法（本專案 lint 視為 **error**，
   * 不是風格建議）。同 data-model 對 `ScrollPosition`「放進 state 只是白付渲染成本」的取捨。
   */
  const pendingScrollTarget = useRef<string | null>(null);

  /** 章節列的節點，供上一行的目標查回 DOM。同樣只讀不渲染，MUST NOT 改用 state */
  const chapterRowRefs = useRef(new Map<string, HTMLLIElement>());

  /**
   * 資料更新後把剛移動的那一章捲回可視範圍（FEAT-10 T025、research R-4）。
   *
   * **依賴 MUST 只有 `novel`**：每次 `router.refresh()` 都給來新物件，正好是「伺服器
   * 資料已回來、新順序已上畫面」的那一刻。目標放在 ref 裡而不在依賴陣列中，
   * 正好避開「送出當下就先跑一次」——那時清單還是舊順序，捲了等於白捲。
   *
   * **`block: 'nearest'` 是契約的一部分**（contracts §4）：它只在目標真的跑出可視範圍時
   * 才捲動。用 `'center'`／`'start'` 的話，作者連按十次上移調順序時畫面每次都跳一下，
   * 那比看不到還煩。
   */
  useEffect(() => {
    const chapterId = pendingScrollTarget.current;
    if (!chapterId) return;
    // 捲完 MUST 立即清掉，否則後續任何無關的 refresh() 都會再捲一次
    pendingScrollTarget.current = null;
    chapterRowRefs.current.get(chapterId)?.scrollIntoView({ block: 'nearest' });
  }, [novel]);

  /** 把某一章在卷內上移或下移一格，並把**整批新順序**送出（契約要求集合完全相同） */
  const move = (volume: AuthorManageVolume, index: number, delta: number) => {
    const ids = volume.chapters.map((c) => c.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    // 送出前記下被移動的是哪一章——送出後 `volume.chapters` 就換人了（T024）
    pendingScrollTarget.current = volume.chapters[index].id;
    run(
      () => reorderChaptersAction({ volumeId: volume.id, orderedChapterIds: ids }),
      '章節順序已更新'
    );
  };

  return (
    <section className={styles.section} aria-labelledby="section-chapters">
      <h2 id="section-chapters" className={styles.section__title}>
        章節
      </h2>

      {/* 空狀態：無卷時的下一步指引 MUST 指向建卷，而不是給一個按了會失敗的新增章節鈕 */}
      {!hasVolumes && (
        <p className={styles.empty}>
          章節必須歸屬於某一卷。請先於上方<strong>建立第一卷</strong>
          ，之後這裡就會出現「新增章節」。
        </p>
      )}

      {hasVolumes && totalChapters === 0 && (
        <p className={styles.empty}>
          還沒有任何章節。在下方任一卷按<strong>新增章節</strong>
          ，系統會建立一篇空白草稿並直接進入編輯器。
        </p>
      )}

      {novel.volumes.map((volume) => {
        const expanded = expandedVolumeIds.has(volume.id);
        const chapterListId = `${chapterListIdPrefix}-${volume.id}`;

        return (
          <div key={volume.id} className={styles.volumeBlock}>
            <div className={styles.volumeBlock__head}>
              {/*
              摺疊控制（FEAT-10 T014、contracts §1.1）。
              **MUST 與「新增章節」是彼此獨立的互動點**：把整列做成展開控制
              （或用 `<details>/<summary>` 包住）的話，點新增章節會連帶開闔，
              而要擋就得攔截事件——鍵盤與滑鼠的觸發路徑不同，擋了一種常漏掉另一種。

              按鈕包在 `<h3>` 之內而非反過來：`<button>` 的內容模型是 phrasing content，
              把 `<h3>` 塞進按鈕裡是無效的 HTML；ARIA 手風琴模式本來就是「標題內含按鈕」。
            */}
              <h3 className={styles.volumeBlock__title}>
                <button
                  type="button"
                  className={styles.volumeToggle}
                  aria-expanded={expanded}
                  aria-controls={chapterListId}
                  onClick={() => toggleVolume(volume.id)}
                >
                  <CaretRight
                    size={14}
                    weight="bold"
                    aria-hidden="true"
                    className={`${styles.volumeToggle__icon} ${
                      expanded ? styles['volumeToggle__icon--open'] : ''
                    }`}
                  />
                  <span className={styles.volumeToggle__name}>
                    第 {volume.number} 卷・{volume.title}
                  </span>
                  <span className={styles.volumeToggle__summary}>{volumeSummary(volume)}</span>
                </button>
              </h3>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                leftIcon={<Plus size={14} />}
                disabled={pending}
                onClick={() =>
                  run(
                    () => createChapterAction({ novelId: novel.id, volumeId: volume.id }),
                    '已建立新章節'
                  )
                }
              >
                新增章節
              </Button>
            </div>

            {/*
            收合以**條件渲染**達成（FEAT-10 T016、research R-3）。
            MUST NOT 改用 `hidden` 保留 DOM：120 章的列留在樹中會被 `Ctrl+F` 搜到卻看不見。

            收合時連同批次操作列一起收起——它操作的是這一卷的章節，
            而那些章節此刻一章也看不到。留著一條「全選本卷／批次刪除」在收合的卷底下，
            正是 contracts §3 警告的那種「涵蓋範圍與可見範圍脫節」的反面。
            **選取狀態不受影響**：它持有於 `NovelManageView` 而非此處（FR-015、T029）。
          */}
            {expanded &&
              (volume.chapters.length === 0 ? (
                <p className={styles.empty} id={chapterListId}>
                  這一卷還沒有章節。
                </p>
              ) : (
                /*
                  捲動容器（FEAT-10 T020／T021、contracts §2.1～§2.3）。

                  **MUST 只包住 `<ul>`**：卷標題列、「新增章節」與 `<BatchActionBar>`
                  留在容器之外，捲到第 80 章時它們才會位置不變（FR-009）。
                  把整個卷區塊設成 `overflow: auto` 會把它們一起捲走。

                  **`tabIndex` MUST 有**：Chromium 與 WebKit 不會自動讓可捲動的 `<div>`
                  可聚焦（Firefox 會）——少了它就是在 Firefox 上測全綠、其他瀏覽器的
                  鍵盤使用者方向鍵捲的是整頁，那 110 章對他們等同不存在（research R-5）。

                  `aria-controls` 的目標由 `<ul>` 移到本容器：容器才是那個被展開／收合的區域。
                */
                <div
                  id={chapterListId}
                  className={styles.chapterScroll}
                  tabIndex={0}
                  aria-label={`第 ${volume.number} 卷的章節清單`}
                >
                  <ul className={styles.chapterList}>
                    {volume.chapters.map((chapter, index) => (
                      <li
                        key={chapter.id}
                        className={styles.chapterRow}
                        ref={(el) => {
                          // 供 T025 的 `scrollIntoView` 查回節點；卸載時要移除，否則指向已離開 DOM 的列
                          if (el) chapterRowRefs.current.set(chapter.id, el);
                          else chapterRowRefs.current.delete(chapter.id);
                        }}
                      >
                        {/*
                    批次選取（FR-001／FR-030）。可辨識名稱 MUST 含**章號與標題** ——
                    只有「選取」兩個字的話，螢幕閱讀器使用者聽到的是一排一模一樣的核取方塊
                  */}
                        <input
                          type="checkbox"
                          id={`${checkboxIdPrefix}-${chapter.id}`}
                          checked={
                            selection.volumeId === volume.id && selection.ids.has(chapter.id)
                          }
                          onChange={() => onToggleChapter(volume.id, chapter.id)}
                        />
                        <label htmlFor={`${checkboxIdPrefix}-${chapter.id}`} className="sr-only">
                          選取第 {chapter.number} 章〈{chapter.title}〉
                        </label>
                        <span className={styles.chapterRow__num}>第 {chapter.number} 章</span>
                        <Link
                          href={`/author/editor/${chapter.id}`}
                          className={styles.chapterRow__title}
                        >
                          {chapter.title}
                        </Link>
                        <Badge
                          variant={chapter.status === 'published' ? 'success' : 'warning'}
                          size="sm"
                        >
                          {chapter.status === 'published' ? '已發佈' : '草稿'}
                        </Badge>
                        <span className={styles.chapterRow__words}>{chapter.wordCount} 字</span>

                        <div className={styles.rowActions}>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={pending || index === 0}
                            onClick={() => move(volume, index, -1)}
                            aria-label={`將〈${chapter.title}〉往前移一位`}
                          >
                            <ArrowUp size={14} />
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={pending || index === volume.chapters.length - 1}
                            onClick={() => move(volume, index, 1)}
                            aria-label={`將〈${chapter.title}〉往後移一位`}
                          >
                            <ArrowDown size={14} />
                          </Button>

                          {/* 刪除章節同為單層按鈕確認（FR-012d） */}
                          {confirmDelete === chapter.id ? (
                            <>
                              <Button
                                type="button"
                                size="sm"
                                variant="danger"
                                disabled={pending}
                                onClick={() => {
                                  run(
                                    () => deleteChapterAction({ chapterId: chapter.id }),
                                    `〈${chapter.title}〉已刪除`
                                  );
                                  setConfirmDelete(null);
                                }}
                              >
                                確認刪除
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => setConfirmDelete(null)}
                              >
                                取消
                              </Button>
                            </>
                          ) : (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => setConfirmDelete(chapter.id)}
                              aria-label={`刪除〈${chapter.title}〉`}
                            >
                              <Trash size={14} />
                            </Button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}

            {/*
            批次操作列（FEAT-8 T025a）。**不只是 UI 的最後一哩**：Server Action 要被
            client component 實際引用，才會進 `.next/server/server-reference-manifest.json`，
            而整合測試的 `callAction` 是由匯出名反查該檔取得派送 id 的。

            **`chapters` MUST 是 `volume.chapters` 完整陣列**，MUST NOT 改成任何
            「已渲染」或「可見」的子集（contracts §3、FR-014）：作者在 120 章的卷按全選
            並批次發佈時，若只送畫面上那十幾章，畫面上不會有任何跡象顯示漏了 100 章。
          */}
            {expanded && volume.chapters.length > 0 && (
              <BatchActionBar
                volume={{ id: volume.id, number: volume.number }}
                chapters={volume.chapters}
                selectedIds={
                  selection.volumeId === volume.id ? selection.ids : (NO_SELECTION as Set<string>)
                }
                onReplaceSelection={(ids) => onReplaceSelection(volume.id, ids)}
                onClearSelection={onClearSelection}
              />
            )}
          </div>
        );
      })}
    </section>
  );
}

// ─────────────────────────────────────────────
// 上架／下架與刪除作品（T051、FR-012d、US1 AC12）
// ─────────────────────────────────────────────

function DangerZone({
  novel,
  pending,
  run,
}: {
  novel: AuthorNovelManage;
  pending: boolean;
  run: RunFn;
}) {
  const confirmInputId = useId();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [typed, setTyped] = useState('');

  const isPublished = novel.status === 'published';
  /** 送出鈕的解鎖條件：輸入的字串與作品標題**完全相同**（FR-012d、US1 AC12） */
  const canDelete = typed === novel.title;

  return (
    <section className={styles.section} aria-labelledby="section-danger">
      <h2 id="section-danger" className={styles.section__title}>
        上架與刪除
      </h2>

      <div className={styles.dangerRow}>
        <div>
          <p className={styles.dangerRow__label}>
            {isPublished ? '目前已上架，讀者可以在書庫與搜尋中找到' : '目前為草稿，只有你看得到'}
          </p>
          <p className={styles.hint}>
            下架後，作品詳情頁與所有章節頁對讀者一律顯示「找不到」，並自書庫、搜尋與網站地圖移除。
          </p>
        </div>
        <Button
          type="button"
          variant={isPublished ? 'secondary' : 'primary'}
          disabled={pending}
          onClick={() =>
            run(
              () =>
                publishNovelAction({
                  novelId: novel.id,
                  status: isPublished ? 'draft' : 'published',
                }),
              isPublished ? '作品已下架' : '作品已上架'
            )
          }
        >
          {isPublished ? '下架作品' : '上架作品'}
        </Button>
      </div>

      <div className={styles.dangerRow}>
        <div>
          <p className={styles.dangerRow__label}>刪除這部作品</p>
          <p className={styles.hint}>此操作無法復原。</p>
        </div>
        <Button type="button" variant="danger" onClick={() => setDialogOpen(true)}>
          刪除作品
        </Button>
      </div>

      <Modal
        isOpen={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
          setTyped('');
        }}
        title="刪除作品"
        size="md"
      >
        {/*
          刪除作品是本頁唯一要求**輸入作品標題**的操作（FR-012d、US1 AC12）。
          級聯範圍明示於此 —— 作者需要知道被刪掉的不只是那一列作品資料。
        */}
        <p className={styles.dialogText}>
          即將刪除《{novel.title}》，連同它的 <strong>{novel.volumes.length} 卷</strong>、
          <strong>{novel.volumes.reduce((s, v) => s + v.chapters.length, 0)} 章</strong>
          （含全部章節正文）、標籤關聯與讀者留言。<strong>此操作無法復原。</strong>
        </p>
        <label className={styles.field__label} htmlFor={confirmInputId}>
          請輸入作品標題「{novel.title}」以確認
        </label>
        <Input
          id={confirmInputId}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={novel.title}
          fullWidth
        />
        <div className={styles.actions}>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setDialogOpen(false);
              setTyped('');
            }}
          >
            取消
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={!canDelete || pending}
            onClick={() => {
              setDialogOpen(false);
              run(() => deleteNovelAction({ novelId: novel.id }), '作品已刪除', '/author/novels');
            }}
          >
            永久刪除
          </Button>
        </div>
      </Modal>
    </section>
  );
}
