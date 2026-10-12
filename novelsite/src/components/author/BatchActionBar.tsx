'use client';

import React, { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Modal } from '@/components/ui';
import { publishChaptersAction, deleteChaptersAction } from '@/app/author/actions';
import { toChapterRanges, formatChapterRanges } from '@/lib/chapterBatch/ranges';
import { BATCH_LIMITS } from '@/lib/validation/chapterBatch';
import type { AuthorManageChapter } from '@/lib/types';
import styles from './BatchActionBar.module.css';

/**
 * 卷內批次操作列（FEAT-8 8-C，contracts/batch-operations-actions.md §3）
 * ======================================================================
 * 選取狀態**不放在本元件內**：它屬於 `NovelManageView`（章節列的核取方塊在那裡），
 * 本元件只讀它、並在成功後請它清空（FR-006）。
 *
 * **章號區段一律取自 `@/lib/chapterBatch/ranges`**，MUST NOT 在此另寫一份 ——
 * 確認畫面、結果摘要與伺服器紀錄三處要的是同一份規則，各寫一份必然漂移，
 * 而漂移不會讓任何測試變紅（research R-6）。
 */

/** 逾時門檻（FR-026）。逾時**不重試**，改重查該卷章節清單判定實際結果 */
const TIMEOUT_MS = 15_000;

/** 成功回傳的形狀自 Action 推導 —— 服務層的型別是 `server-only`，client 端不引用 */
type PublishResult = Extract<
  Awaited<ReturnType<typeof publishChaptersAction>>,
  { success: true }
>['data'];

type DeleteResult = Extract<
  Awaited<ReturnType<typeof deleteChaptersAction>>,
  { success: true }
>['data'];

/** 兩種操作各自的結果。以 `kind` 區分 —— 摘要要說的話完全不同 */
type BatchOutcome =
  { kind: 'publish'; data: PublishResult } | { kind: 'delete'; data: DeleteResult };

type BatchKind = 'publish' | 'delete';

export interface BatchActionBarProps {
  volume: { id: string; number: number };
  /** 該卷全部章節。判空、統計已發佈數與組章號區段所需的欄位皆已在其中，零額外查詢 */
  chapters: AuthorManageChapter[];
  /** 本卷目前被選取的章節識別碼（不屬本卷時，呼叫端傳空集合） */
  selectedIds: Set<string>;
  /**
   * 以整組識別碼**取代**本卷的選取（三個輔助動作用，FR-001）。
   * 呼叫端一併把選取歸屬換成本卷 —— 前一卷的選取因此清空（FR-002）
   */
  onReplaceSelection: (ids: string[]) => void;
  /** 操作**成功**後清空選取；失敗時本元件不呼叫它（FR-006） */
  onClearSelection: () => void;
}

export function BatchActionBar({
  volume,
  chapters,
  selectedIds,
  onReplaceSelection,
  onClearSelection,
}: BatchActionBarProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<BatchKind | null>(null);
  const [outcome, setOutcome] = useState<BatchOutcome | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  /** 逾時後仍未收到回傳；此時畫面改以重查結果說話（FR-026） */
  const [timedOut, setTimedOut] = useState(false);
  /** 送出當下的選取快照與操作別，供逾時重查時比對「有沒有變化」 */
  const [submitted, setSubmitted] = useState<{ kind: BatchKind; ids: string[] } | null>(null);
  /**
   * 刪除的二次確認（FR-016）。**只在選取含已發佈章節時要求** ——
   * 對一批草稿施加同等摩擦，只會讓作者學會無視所有確認步驟（FR-017）
   */
  const [acknowledged, setAcknowledged] = useState(false);
  const acknowledgeId = useId();
  /** 停用原因的錨點。`aria-describedby` 指過去，停用原因因此讀得出來（FR-005a／FR-031） */
  const hintPrefix = useId();
  const selectAllHintId = `${hintPrefix}-select-all`;
  const draftsHintId = `${hintPrefix}-drafts`;
  const limitHintId = `${hintPrefix}-limit`;

  const selected = chapters.filter((chapter) => selectedIds.has(chapter.id));
  const selectedCount = selected.length;
  const publishedCount = selected.filter((chapter) => chapter.status === 'published').length;
  // 「正文為空」的判定基準 MUST 為該章 `wordCount === 0`（FR-014a）。
  // 資料已在 props 內，MUST NOT 為了判空另讀正文、MUST NOT 另訂第二套判定
  const emptyBodyCount = selected.filter((chapter) => chapter.wordCount === 0).length;
  const selectedRanges = formatChapterRanges(toChapterRanges(selected.map((c) => c.number)));

  const busy = pending && !timedOut;
  /** 含已發佈章節的刪除，未完成二次確認前 MUST NOT 送得出去（FR-016） */
  const deleteBlocked = publishedCount > 0 && !acknowledged;

  const draftChapters = chapters.filter((chapter) => chapter.status === 'draft');
  /**
   * 選取輔助動作的停用判定（FR-005a）。
   *
   * **MUST NOT 截斷成前 1000 章**：截斷會讓「全選本卷」名實不符；
   * 而讓作者選出一個永遠送不出去的集合，唯一出路是手動取消數百個勾選 ——
   * 那正是本功能要消滅的操作量。故超限時停用該動作並說明原因與實際章節數。
   */
  const selectAllOverLimit = chapters.length > BATCH_LIMITS.maxChapters;
  const draftsOverLimit = draftChapters.length > BATCH_LIMITS.maxChapters;
  /**
   * 逐章勾選也可能勾過上限（FR-005）。此時 MUST 於前端阻擋送出，
   * 並顯示**實際選取數與上限值** —— 只說「太多了」，作者無從得知要取消幾章
   */
  const selectionOverLimit = selectedCount > BATCH_LIMITS.maxChapters;

  const openConfirm = (kind: BatchKind) => {
    setAcknowledged(false);
    setConfirming(kind);
  };

  const submit = (kind: BatchKind) => {
    const ids = selected.map((chapter) => chapter.id);
    setConfirming(null);
    setOutcome(null);
    setErrorMessage(null);
    setTimedOut(false);
    setAcknowledged(false);
    setSubmitted({ kind, ids });

    // **MUST NOT 自動重試**（FR-026）：逾時只是「還沒看到回應」，
    // 而伺服器很可能已經寫完了 —— 再送一次就是第二批
    const timer = setTimeout(() => {
      setTimedOut(true);
      router.refresh();
    }, TIMEOUT_MS);

    startTransition(async () => {
      try {
        const payload = { volumeId: volume.id, chapterIds: ids };
        if (kind === 'publish') {
          const response = await publishChaptersAction(payload);
          if (!response.success) {
            // 失敗後**保留**選取（FR-006）—— 清空等於要作者重新勾選上百個核取方塊
            setErrorMessage(response.error.message);
            return;
          }
          setOutcome({ kind: 'publish', data: response.data });
        } else {
          const response = await deleteChaptersAction(payload);
          if (!response.success) {
            setErrorMessage(response.error.message);
            return;
          }
          setOutcome({ kind: 'delete', data: response.data });
        }
        onClearSelection();
        router.refresh();
      } finally {
        clearTimeout(timer);
      }
    });
  };

  return (
    <div className={styles.bar}>
      {/*
        選取數 MUST 隨時可見（FR-003），變動以 aria-live 播報（FR-031）。
        **上限訊息寫在同一個即時區域內**：它隨選取數變動，而作者需要知道的正是
        「現在幾章、上限幾章」——分到區域外，讀螢幕的作者只會聽到數字變大而不知被擋
      */}
      <div className={styles.status} role="status" aria-live="polite">
        <p className={styles.count}>已選 {selectedCount} 章</p>
        {selectionOverLimit && (
          <p id={limitHintId} className={styles.hint}>
            已選 {selectedCount} 章，超過單次上限 {BATCH_LIMITS.maxChapters}{' '}
            章，請取消部分選取後再送出。
          </p>
        )}
      </div>

      {/*
        三個選取輔助動作（FR-001）。存在的理由就是把「勾 200 次」降成「按 1 次」。
        「清除選取」沿用成功後的同一條清空路徑（`onClearSelection`），
        另兩個以整組識別碼取代選取 —— 一併把選取歸屬換到本卷（FR-002）
      */}
      <div className={styles.helpers}>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={busy || selectAllOverLimit}
          aria-describedby={selectAllOverLimit ? selectAllHintId : undefined}
          onClick={() => onReplaceSelection(chapters.map((chapter) => chapter.id))}
        >
          全選本卷
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={busy || draftsOverLimit}
          aria-describedby={draftsOverLimit ? draftsHintId : undefined}
          onClick={() => onReplaceSelection(draftChapters.map((chapter) => chapter.id))}
        >
          只選草稿
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy || selectedCount === 0}
          onClick={onClearSelection}
        >
          清除選取
        </Button>
      </div>

      {/* 停用原因 MUST 可被輔助技術讀出（FR-005a／FR-031），故是畫面上的文字而非 title 屬性 */}
      {selectAllOverLimit && (
        <p id={selectAllHintId} className={styles.hint}>
          本卷共 {chapters.length} 章，超過單次上限 {BATCH_LIMITS.maxChapters} 章，請分段選取。
        </p>
      )}
      {draftsOverLimit && (
        <p id={draftsHintId} className={styles.hint}>
          本卷共 {draftChapters.length} 章草稿，超過單次上限 {BATCH_LIMITS.maxChapters}{' '}
          章，請分段選取。
        </p>
      )}

      <div className={styles.actions}>
        <Button
          type="button"
          size="sm"
          variant="primary"
          disabled={selectedCount === 0 || busy || selectionOverLimit}
          aria-describedby={selectionOverLimit ? limitHintId : undefined}
          onClick={() => openConfirm('publish')}
        >
          {busy && submitted?.kind === 'publish' ? '發佈中…' : '批次發佈'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="danger"
          disabled={selectedCount === 0 || busy || selectionOverLimit}
          aria-describedby={selectionOverLimit ? limitHintId : undefined}
          onClick={() => openConfirm('delete')}
        >
          {busy && submitted?.kind === 'delete' ? '刪除中…' : '批次刪除'}
        </Button>
      </div>

      <BatchResultMessage
        outcome={outcome}
        errorMessage={errorMessage}
        timedOut={timedOut && pending}
        chapters={chapters}
        submitted={submitted}
      />

      <Modal
        isOpen={confirming === 'publish'}
        onClose={() => setConfirming(null)}
        title="批次發佈章節"
        description={`將立即發佈選取的 ${selectedCount} 章，其中 ${publishedCount} 章已發佈（會被略過）、${emptyBodyCount} 章正文為空。`}
        size="md"
      >
        <p className={styles.stats}>
          第 {volume.number} 卷，共 <strong>{selectedCount} 章</strong>； 其中{' '}
          <strong>{publishedCount} 章</strong>已發佈、
          <strong>{emptyBodyCount} 章</strong>正文為空。
          {/*
            確認畫面的基準是「**選取集合**」，結果摘要的基準是「**本批實際發佈集合**」——
            兩個數不一定相同（選取內的已發佈章節會被略過），故 MUST 各自標明基準，
            否則作者會把「確認說 2 章、摘要說 0 章」讀成系統算錯（data-model §3.2）
          */}
          <span className={styles.stats__note}>
            以上為「選取的 {selectedCount} 章」的統計；已發佈的章節不會被重複發佈。
          </span>
        </p>

        {/* 區段 MUST 全部列出於可捲動容器，不設門檻、不摺疊、不截斷（FR-025b） */}
        <p className={styles.ranges}>{selectedRanges}</p>

        <div className={styles.dialogActions}>
          <Button type="button" variant="ghost" onClick={() => setConfirming(null)}>
            取消
          </Button>
          <Button type="button" variant="primary" disabled={busy} onClick={() => submit('publish')}>
            確認發佈
          </Button>
        </div>
      </Modal>

      {/*
        批次刪除的確認（FR-016／FR-017）。
        **警語 MUST 是 `aria-describedby` 目標的一部分** —— `Modal` 把 `description`
        接到 `aria-describedby`，故「其中 M 章已發佈」與「刪除後無法復原」寫在那裡；
        只放在內文的話，讀螢幕的作者聽不到，這道加強確認對他們就等於不存在（FR-032）。

        **全為草稿時 MUST NOT 出現「無法復原」與二次確認**（FR-017）：
        對低風險操作施加同等摩擦，只會讓作者學會無視所有確認步驟。
      */}
      <Modal
        isOpen={confirming === 'delete'}
        onClose={() => setConfirming(null)}
        title="批次刪除章節"
        description={
          publishedCount > 0
            ? `將刪除 ${selectedCount} 章，其中 ${publishedCount} 章已發佈。刪除後無法復原。`
            : `將刪除 ${selectedCount} 章，全部為草稿。`
        }
        size="md"
      >
        <p className={styles.stats}>
          第 {volume.number} 卷，將刪除 <strong>{selectedCount} 章</strong>
          {publishedCount > 0 ? (
            <>
              ，其中 <strong>{publishedCount} 章已發佈</strong>。
            </>
          ) : (
            <>，全部為草稿。</>
          )}
          <span className={styles.stats__note}>
            各章正文與其留言會一併移除；讀者的續讀進度與閱讀歷史不受影響，
            剩餘章節的章號也不會自動補正。
          </span>
        </p>

        <p className={styles.ranges}>{selectedRanges}</p>

        {publishedCount > 0 && <p className={styles.warning}>刪除後無法復原。</p>}

        {publishedCount > 0 && (
          <div className={styles.ack}>
            <input
              type="checkbox"
              id={acknowledgeId}
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
            />
            <label htmlFor={acknowledgeId}>
              我了解其中 {publishedCount} 章已發佈，刪除後無法復原。
            </label>
          </div>
        )}

        <div className={styles.dialogActions}>
          <Button type="button" variant="ghost" onClick={() => setConfirming(null)}>
            取消
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={busy || deleteBlocked}
            onClick={() => submit('delete')}
          >
            確認刪除
          </Button>
        </div>
      </Modal>
    </div>
  );
}

/**
 * 結果摘要（FR-027、FR-010b、FR-026）。
 *
 * 三種收場各有一句話：成功、失敗、**逾時但伺服器可能已經做完**。
 * 第三種的措辭 MUST 為「尚未看到變更」而非「操作失敗」——
 * 講成失敗，作者就會再按一次，而那正是 FR-026 要擋的第二批。
 */
function BatchResultMessage({
  outcome,
  errorMessage,
  timedOut,
  chapters,
  submitted,
}: {
  outcome: BatchOutcome | null;
  errorMessage: string | null;
  timedOut: boolean;
  chapters: AuthorManageChapter[];
  submitted: { kind: BatchKind; ids: string[] } | null;
}) {
  if (timedOut && submitted) {
    const ids = new Set(submitted.ids);
    // 發佈看「有幾章轉為已發佈」，刪除看「有幾章已經不在清單裡」——
    // 兩者都是重查之後才問得出來的問題，MUST NOT 由送出當下的選取反推
    const changedCount =
      submitted.kind === 'publish'
        ? chapters.filter((c) => ids.has(c.id) && c.status === 'published').length
        : submitted.ids.length - chapters.filter((c) => ids.has(c.id)).length;
    const verb = submitted.kind === 'publish' ? '轉為已發佈' : '被刪除';

    return (
      <p className={styles.result} role="status" aria-live="polite">
        {changedCount > 0
          ? `重查後已看到 ${changedCount} 章${verb}，本次不會重送。`
          : '尚未看到變更。已重新查詢這一卷的章節清單，系統不會自動重送這一批。'}
      </p>
    );
  }

  if (errorMessage) {
    return (
      <p className={`${styles.result} ${styles.result__error}`} role="status" aria-live="polite">
        {errorMessage}（選取已保留，修正後可再送出）
      </p>
    );
  }

  if (!outcome) return null;

  if (outcome.kind === 'delete') {
    return (
      <p className={styles.result} role="status" aria-live="polite">
        已刪除 {outcome.data.deleted} 章。剩餘章節的章號未變動。
      </p>
    );
  }

  const result = outcome.data;
  return (
    <p className={styles.result} role="status" aria-live="polite">
      {/*
        **基準 MUST 標明**（contracts §3.2）：確認畫面數的是「選取集合」、
        摘要數的是「本批實際發佈集合」，選取內的已發佈章節會被略過而不計入摘要 ——
        兩個數都誠實，但不寫基準的話，作者會把「確認說 2 章、摘要說 0 章」讀成系統算錯
      */}
      已發佈 {result.published} 章、略過 {result.skipped} 章；本批發佈的 {result.published} 章中有{' '}
      {result.emptyBody} 章正文為空。
      {/*
        章號指名（FR-027a）。**資料來源 MUST 是回傳的 `skippedNumbers`／`emptyBodyNumbers`**，
        MUST NOT 從選取狀態反推 —— 成功後選取已依 FR-006 清空，反推的那一刻沒有東西可推。
        「已發佈 197 章、略過 3 章」看不出那 3 章是被排程掃描搶先（沒事）還是選錯範圍（有事）。
        區段很多時 MUST 全部列出於可捲動容器，不設門檻、不摺疊、不截斷（FR-025b）
      */}
      {result.skippedNumbers.length > 0 && (
        <span className={styles.result__ranges}>
          略過：{formatChapterRanges(toChapterRanges(result.skippedNumbers))}
        </span>
      )}
      {result.emptyBodyNumbers.length > 0 && (
        <span className={styles.result__ranges}>
          正文為空：{formatChapterRanges(toChapterRanges(result.emptyBodyNumbers))}
        </span>
      )}
      {/* 通知沒送出不影響發佈本身，但作者必須知道（FR-010b） */}
      {!result.notified && (
        <span className={styles.result__warning}>追更通知未送出，章節已正常發佈。</span>
      )}
    </p>
  );
}
