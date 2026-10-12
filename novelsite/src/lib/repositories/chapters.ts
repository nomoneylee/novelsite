/**
 * 章節與正文資料存取（Chapters Repository）
 * ============================================
 * 正文（`ChapterContent`）與 `Chapter` 為 1:1 分表，只有閱讀頁會載入正文；
 * 目錄／列表查詢 MUST NOT include 正文大欄位（FR-010）。
 *
 * 可見性只取決於 `Chapter.status`，**無任何付費／授權分支**（FR-014）：
 * 查詢一律 `where status = 'published'`，未發佈或不存在皆回 null，
 * 由呼叫端轉 `notFound()` → 404（不是 403，不揭露草稿是否存在）。
 */
import 'server-only';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/db';
import type { Chapter, Volume } from '@/lib/types';
import { toChapter, toVolume } from './mappers';
import { db, type TxClient } from './tx';

/**
 * 取單章 + 正文（閱讀頁用）；未發佈或不存在皆回 null。
 * 缺正文列時 `bodyMarkdown = ''`（Edge Case）。
 *
 * **回傳 Markdown 原文而非切好的段落**（FEAT-3 FR-017、research R-8）：
 * 原本的 `splitParagraphs()` 已移除 —— 它讓閱讀頁走一條「先切段、再逐段 `<p>`」的
 * 專屬路徑，與編輯器預覽的 Markdown 轉譯永遠不會是同一個結果。
 * 現在兩邊都吃這份原文、都交給 `<SafeMarkdown>`。
 */
export async function getPublishedChapterWithContent(
  novelId: string,
  chapterId: string
): Promise<{ chapter: Chapter; bodyMarkdown: string } | null> {
  const row = await prisma.chapter.findFirst({
    where: { id: chapterId, novelId, status: 'published' },
    include: { content: { select: { bodyMarkdown: true } } },
  });
  if (!row) return null;

  return {
    chapter: toChapter(row),
    bodyMarkdown: row.content?.bodyMarkdown ?? '',
  };
}

/** 作品目錄：只回已發佈章節，且 MUST NOT 載入正文大欄位（FR-010） */
export async function getPublishedChaptersByNovel(novelId: string): Promise<Volume[]> {
  const volumes = await prisma.volume.findMany({
    where: { novelId },
    orderBy: { number: 'asc' },
    include: {
      chapters: {
        where: { status: 'published' },
        orderBy: { number: 'asc' },
      },
    },
  });

  const latestChapterId = volumes
    .flatMap((v) => v.chapters)
    .reduce<{ id: string; number: number } | null>(
      (acc, ch) => (acc === null || ch.number > acc.number ? ch : acc),
      null
    )?.id;

  return volumes.map((v) => toVolume(v, latestChapterId));
}

// ─────────────────────────────────────────────
// 卷與章節寫入（FEAT-3 3-B）
//
// 卷與章節的擁有權**經作品推導**（`chapter.novel.authorId`），不另存擁有者欄位。
// 故本層提供「這個卷／章節屬於哪一部作品」的查詢，由服務層據此呼叫擁有者守衛；
// 查不到時回 `null`，讓「不存在」與「別人的」在服務層匯流成同一個結果。
// ─────────────────────────────────────────────

/** 卷所屬的作品識別碼；不存在回 null */
export async function getVolumeOwnerNovelId(
  volumeId: string,
  tx?: TxClient
): Promise<string | null> {
  const row = await db(tx).volume.findUnique({
    where: { id: volumeId },
    select: { novelId: true },
  });
  return row?.novelId ?? null;
}

/** 章節所屬的作品與卷；不存在回 null */
export async function getChapterOwnerRefs(
  chapterId: string,
  tx?: TxClient
): Promise<{ novelId: string; volumeId: string; status: string } | null> {
  return db(tx).chapter.findUnique({
    where: { id: chapterId },
    select: { novelId: true, volumeId: true, status: true },
  });
}

/**
 * 建立卷：編號 = 該作品目前最大卷編號 + 1（FR-003d）。
 * 併發撞號由 `@@unique([novelId, number])` 擋下，服務層轉譯為 CONFLICT。
 */
export async function createVolumeRow(
  novelId: string,
  title: string,
  tx?: TxClient
): Promise<string> {
  const client = db(tx);
  const max = await client.volume.aggregate({ where: { novelId }, _max: { number: true } });
  const row = await client.volume.create({
    data: {
      id: randomUUID(),
      novelId,
      title,
      number: (max._max.number ?? 0) + 1,
    },
    select: { id: true },
  });
  return row.id;
}

/** 更新卷標題（編號不可編輯） */
export async function updateVolumeTitle(
  volumeId: string,
  title: string,
  tx?: TxClient
): Promise<void> {
  await db(tx).volume.update({ where: { id: volumeId }, data: { title } });
}

/**
 * 刪除卷 —— **僅當該卷沒有章節**（FR-003c）。
 *
 * 回傳 `false` 表示卷內尚有章節，服務層據此回 CONFLICT。
 * MUST NOT 級聯刪除章節：schema 上的 `onDelete: Cascade` 是刪**作品**時才該走到的路徑，
 * 作者手滑刪掉一整卷的章節不在其中。
 */
export async function deleteVolumeIfEmpty(volumeId: string, tx?: TxClient): Promise<boolean> {
  const client = db(tx);
  const remaining = await client.chapter.count({ where: { volumeId } });
  if (remaining > 0) return false;

  await client.volume.delete({ where: { id: volumeId } });
  return true;
}

/**
 * 建立章節：編號 = 該**作品**目前最大章節編號 + 1（FR-003a，作用域是作品而非卷）。
 * 建立的是標題預設、正文空白的草稿。
 */
export async function createChapterRow(
  novelId: string,
  volumeId: string,
  tx?: TxClient
): Promise<{ chapterId: string; number: number }> {
  const client = db(tx);
  const max = await client.chapter.aggregate({ where: { novelId }, _max: { number: true } });
  const number = (max._max.number ?? 0) + 1;

  const row = await client.chapter.create({
    data: {
      id: randomUUID(),
      novelId,
      volumeId,
      number,
      title: `第 ${number} 章`,
      wordCount: 0,
      status: 'draft',
      publishedAt: null,
      content: { create: { bodyMarkdown: '' } },
    },
    select: { id: true },
  });
  return { chapterId: row.id, number };
}

/**
 * 該作品全部章節的章號與標題（FEAT-7 T012）。
 * 帶標題是為了讓衝突訊息指名撞到的是哪一章（FR-010(b)）——
 * 只回章號的話，錯誤訊息只能說「第 3 章已存在」，作者不知道那是他哪一篇。
 */
export async function getNovelChapterNumbers(
  novelId: string,
  tx?: TxClient
): Promise<Array<{ number: number; title: string }>> {
  return db(tx).chapter.findMany({
    where: { novelId },
    select: { number: true, title: true },
    orderBy: { number: 'asc' },
  });
}

/**
 * 批次建立章節與正文（FEAT-7 T012、research R-3）。
 *
 * **不是 `createChapterRow` 的迴圈** —— 那一支把 `number` 指派為「該作品目前最大章號 + 1」，
 * 而匯入的 `number` 來自檔名（FR-005）。
 *
 * 識別碼於此以 `randomUUID()` **先產生**，兩張表才能各自 `createMany`
 * （不必為了拿回自動產生的識別碼而逐筆 `create` —— 1000 章逐筆是 2000 次來回，
 * 在互動式交易的 timeout 內跑不完）。
 *
 * 一律 `status='draft'`、`publishedAt=null`、`scheduledAt=null`（FR-009）：
 * 匯入產出落在既有生命週期的起點，發佈與排程走既有單章路徑。
 */
export async function createChaptersBulk(
  novelId: string,
  volumeId: string,
  rows: ReadonlyArray<{ number: number; title: string; bodyMarkdown: string; wordCount: number }>,
  tx?: TxClient
): Promise<{ created: number; numbers: number[] }> {
  const client = db(tx);
  const prepared = rows.map((row) => ({ id: randomUUID(), ...row }));

  await client.chapter.createMany({
    data: prepared.map((row) => ({
      id: row.id,
      novelId,
      volumeId,
      number: row.number,
      title: row.title,
      wordCount: row.wordCount,
      status: 'draft',
      publishedAt: null,
      scheduledAt: null,
    })),
  });
  await client.chapterContent.createMany({
    data: prepared.map((row) => ({ chapterId: row.id, bodyMarkdown: row.bodyMarkdown })),
  });

  return {
    created: prepared.length,
    numbers: prepared.map((row) => row.number).sort((a, b) => a - b),
  };
}

/** 儲存章節標題與正文；**不改變 `status`**（contracts §2） */
export async function saveChapterDraftRow(
  chapterId: string,
  data: { title: string; bodyMarkdown: string; wordCount: number },
  tx?: TxClient
): Promise<void> {
  const client = db(tx);
  await client.chapter.update({
    where: { id: chapterId },
    data: { title: data.title, wordCount: data.wordCount },
  });
  await client.chapterContent.upsert({
    where: { chapterId },
    create: { chapterId, bodyMarkdown: data.bodyMarkdown },
    update: { bodyMarkdown: data.bodyMarkdown },
  });
}

/**
 * 發佈／下架（FR-013）。
 * 首次發佈才寫入 `publishedAt`；下架不清除該欄位 —— 重新發佈時保留原本的上架日期，
 * 讀者看到的章節日期不會因作者臨時下架又上架而跳動。
 */
export async function setChapterStatusRow(
  chapterId: string,
  status: 'draft' | 'published' | 'admin_suspended',
  tx?: TxClient
): Promise<void> {
  const client = db(tx);
  if (status === 'published') {
    const current = await client.chapter.findUnique({
      where: { id: chapterId },
      select: { publishedAt: true },
    });
    await client.chapter.update({
      where: { id: chapterId },
      data: { status, publishedAt: current?.publishedAt ?? new Date() },
    });
    return;
  }
  await client.chapter.update({ where: { id: chapterId }, data: { status } });
}

/** 刪除章節（正文由 `ChapterContent` 的級聯處理） */
export async function deleteChapterRow(chapterId: string, tx?: TxClient): Promise<void> {
  await db(tx).chapter.delete({ where: { id: chapterId } });
}

// ─────────────────────────────────────────
// 批次發佈與批次刪除（FEAT-8 8-B，contracts/internal-modules.md §5）
// ─────────────────────────────────────────

/**
 * `id: { in: [...] }` 每次送出的識別碼上限（FEAT-8 T014 實作裁示，2026-08-23）。
 *
 * **research R-4「1000 個識別碼的 `in` 子句在兩軌皆安全」只驗到原生 SQLite，
 * 沒有驗到 Prisma 自己的守衛**：Prisma 7 對 SQLite 軌的單一查詢參數數量設有上限，
 * 超過即擲 **`P2029`（`The query parameter limit supported by your database is exceeded`）**。
 * 本階段的上界是 1000 章，而每一句的 `where` 還帶 `volumeId`（發佈側再加 `status`）——
 * **1000 個識別碼必然超限**，已於 `chapter-batch-publish.test.ts` 的上界案例實測擲出 `P2029`。
 *
 * 故三支批次函式一律**分批送出**。分批 **MUST NOT 改變語意**：
 * 全部批次都在呼叫端的**同一個交易**內執行，全有全無不變；
 * 條件更新每一批仍是「判定與取值同一個語句」（R-2 的要求是不得拆成
 * `findMany` ＋ `updateMany` 兩句，不是不得分批）。
 *
 * 500 而非 999：PostgreSQL 軌的上限（65535）遠高於此，取一個兩軌都寬裕的值，
 * 就不必為了 provider 差異在這一層分岔（`base.prisma` 檔首的相容性守則）。
 */
const ID_CHUNK_SIZE = 500;

function chunkIds(ids: readonly string[]): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK_SIZE) {
    chunks.push([...ids.slice(i, i + ID_CHUNK_SIZE)]);
  }
  return chunks;
}

/**
 * 候選查詢：該卷內、指定識別碼的章節（FEAT-8 T009）。
 *
 * `where` **同時帶 `volumeId` 與 `id: { in: ids }`**：列數少於入參即代表
 * 有識別碼不屬於該卷（或根本不存在），服務層據此擲 `NotFoundError`（FR-021a）。
 * 兩種情況在這一層**不區分** —— 區分了就會漏出「那一章存在但屬於別人」。
 *
 * 帶 `status`（候選中哪幾章還是草稿）、`publishedAt`（重發組與首次發佈組的分組依據，
 * FR-013）與 `wordCount`（空正文判定，FR-014a）—— 三欄都是服務層接下來非用不可的，
 * 在同一支查詢一次取齊，**零額外查詢**。
 *
 * 依 `number` 遞增排序：呼叫端要組章號區段、且追更通知指向章號最大者，
 * 排序交給資料庫比在記憶體裡再排一次便宜，也與 `getVolumeChapterRefs` 一致。
 * **分批之後排序 MUST 在合併後補做** —— 每一批各自有序不等於全體有序。
 */
export async function getVolumeChaptersByIds(
  volumeId: string,
  chapterIds: readonly string[],
  tx?: TxClient
): Promise<
  {
    id: string;
    number: number;
    title: string;
    status: string;
    publishedAt: Date | null;
    wordCount: number;
  }[]
> {
  const client = db(tx);
  const rows = [];
  for (const ids of chunkIds(chapterIds)) {
    rows.push(
      ...(await client.chapter.findMany({
        where: { volumeId, id: { in: ids } },
        select: {
          id: true,
          number: true,
          title: true,
          status: true,
          publishedAt: true,
          wordCount: true,
        },
      }))
    );
  }
  return rows.sort((a, b) => a.number - b.number);
}

/**
 * 條件發佈：**只更新目前仍為 `draft` 者**，回傳被實際更新的列（FEAT-8 T014、FR-010a）。
 *
 * **MUST 以 `updateManyAndReturn` 實作**（research R-2）。
 * **MUST NOT 改成「先 `findMany` 再 `updateMany`」**：兩語句之間的時間窗正是 FR-010a
 * 要消滅的東西 —— 排程掃描可在窗內發佈同一章，此時只知道列數對不上，
 * **不知道是哪幾章被搶先**，而通知的收件內容要指名章號最大者。
 *
 * **`volumeId` 為必要參數**（analyze 第二輪 2026-08-23／findings C1）：
 * 憲章第 II 條「所有寫入 query MUST 帶擁有者條件」不可協商，而卷歸屬正是本階段的
 * 擁有者條件（FR-021a）。少了它，發佈側的卷歸屬就只剩服務層那一段**可能被漏掉的
 * 前置檢查**，與 `deleteChaptersBulk` 不對稱。
 *
 * `setPublishedAt` 為 true 時一併寫入上架日期（**首次發佈組**，`publishedAt = null`）；
 * false 時不寫該欄（**重發組**，保留原上架日期，FR-013）。兩組皆清空 `scheduledAt` ——
 * `base.prisma` 該欄的既有註解已寫明它是重複發佈的唯一防護。
 *
 * **MUST NOT 照抄 `publishScheduledChapterRow` 的 `publishedAt: now` 無條件寫法**：
 * 那與 FR-013 衝突（下架後重發，讀者看到的日期會跳到今天），
 * 兩條既有路徑的岔路見 `data-model.md` §2.1。
 */
export async function publishChaptersBulk(
  volumeId: string,
  chapterIds: readonly string[],
  now: Date,
  setPublishedAt: boolean,
  tx?: TxClient
): Promise<{ id: string; number: number; title: string }[]> {
  const client = db(tx);
  const data = setPublishedAt
    ? { status: 'published', publishedAt: now, scheduledAt: null }
    : { status: 'published', scheduledAt: null };

  const rows: { id: string; number: number; title: string }[] = [];
  for (const ids of chunkIds(chapterIds)) {
    rows.push(
      ...(await client.chapter.updateManyAndReturn({
        where: { id: { in: ids }, volumeId, status: 'draft' },
        data,
        select: { id: true, number: true, title: true },
      }))
    );
  }
  return rows;
}

/**
 * 批次刪除：只刪該卷內、指定識別碼者，回傳實際刪除列數（FEAT-8 T027）。
 *
 * `where` **同時帶 `volumeId`**（憲章第 II 條：所有寫入 query MUST 帶擁有者條件）——
 * 卷歸屬正是本階段的擁有者條件（FR-021a）。服務層的候選查詢列數比對是第一道，
 * 這一句的 `volumeId` 是第二道；只留前者等於把不變量寄託在「呼叫端沒有漏叫」上。
 *
 * **`ChapterContent` 與 `Comment` 由資料庫級聯移除**（`base.prisma` 兩者皆
 * `onDelete: Cascade`），本函式 MUST NOT 自行刪除它們 —— 自己刪等於在應用層維護
 * 一份與 schema 平行的級聯清單，schema 加一張表時它不會跟著更新（research R-10）。
 *
 * **MUST NOT 觸碰 `ReadingProgress`／`ReadingHistory`／`ChapterView`**（FR-019）：
 * 三者刻意不設 `Chapter` 關聯（見 `base.prisma` 該欄註解），
 * 續讀點指向的章節消失不該連坐刪掉讀者整筆進度。
 *
 * **MUST NOT 於刪除後重排剩餘章節的 `number`**（FR-020）——
 * 自動補號會讓讀者已知的章號整批位移。
 *
 * 分批理由同 `chunkIds`：`in` 子句的識別碼數量受 Prisma 參數上限所限（`P2029`）。
 */
export async function deleteChaptersBulk(
  volumeId: string,
  chapterIds: readonly string[],
  tx?: TxClient
): Promise<number> {
  const client = db(tx);
  let deleted = 0;
  for (const ids of chunkIds(chapterIds)) {
    const result = await client.chapter.deleteMany({ where: { id: { in: ids }, volumeId } });
    deleted += result.count;
  }
  return deleted;
}

/** 該卷章節的識別碼與編號（排序前的集合核對用） */
export async function getVolumeChapterRefs(
  volumeId: string,
  tx?: TxClient
): Promise<{ id: string; number: number }[]> {
  return db(tx).chapter.findMany({
    where: { volumeId },
    orderBy: { number: 'asc' },
    select: { id: true, number: true },
  });
}

/**
 * 卷內排序（FR-003b、research R-9）。
 *
 * 只重排**該卷章節目前持有的編號集合**，`volumeId` 不變、其他卷不受影響。
 *
 * **兩段式寫入的理由**：`Chapter` 帶 `@@unique([novelId, number])`。若逐筆直接寫入目標編號，
 * 中途必然出現「新值撞到還沒被改走的舊值」——1↔2 交換就是最小反例。
 * 故先把全部參與者移到一段**負值暫存區間**（真實資料永遠是正數，不可能相撞），
 * 再寫回正式編號。呼叫端 MUST 以單一交易包住，任一步失敗即整批回滾。
 */
export async function reorderWithinVolume(
  volumeId: string,
  orderedChapterIds: string[],
  tx: TxClient
): Promise<void> {
  const current = await getVolumeChapterRefs(volumeId, tx);
  // 目標編號 = 該卷原本持有的編號集合，由小到大依新順序重新指派
  const targetNumbers = current.map((c) => c.number).sort((a, b) => a - b);

  for (let i = 0; i < orderedChapterIds.length; i++) {
    await tx.chapter.update({
      where: { id: orderedChapterIds[i] },
      data: { number: -(i + 1) },
    });
  }

  for (let i = 0; i < orderedChapterIds.length; i++) {
    await tx.chapter.update({
      where: { id: orderedChapterIds[i] },
      data: { number: targetNumbers[i] },
    });
  }
}

/**
 * 章節的可見性判定所需的最小資訊（FEAT-4 4-B / T065）。
 *
 * 留言區的讀取對**已發佈**章節公開（FR-026），未發佈者只有作品的作者看得到；
 * 故一併回傳 `authorId`，讓服務層以一次查詢就分得出 404 與放行
 * （contracts/interaction-api.md §2「章節未發佈**且請求者非擁有者**」）。
 * `novelId` 供 `Novel.commentCount` 的增減使用。
 */
export async function getChapterVisibility(
  chapterId: string,
  tx?: TxClient
): Promise<{ novelId: string; status: string; authorId: string } | null> {
  const row = await db(tx).chapter.findUnique({
    where: { id: chapterId },
    select: { novelId: true, status: true, novel: { select: { authorId: true } } },
  });
  return row ? { novelId: row.novelId, status: row.status, authorId: row.novel.authorId } : null;
}

/**
 * 最新已發佈章節的識別碼（FEAT-4 4-C / T099）——**完讀率的判準**（data-model.md §7.2）。
 *
 * 取最大 `number` 而非最新 `publishedAt`：章節的先後由編號定義，
 * 補發舊章（`publishedAt` 較新、編號較小）不該讓「讀到最新一章」的門檻往回跳。
 * 一章都沒發佈回 `null`，呼叫端據此讓完讀率呈現「尚無資料」。
 */
export async function getLatestPublishedChapterId(
  novelId: string,
  tx?: TxClient
): Promise<string | null> {
  const row = await db(tx).chapter.findFirst({
    where: { novelId, status: 'published' },
    orderBy: { number: 'desc' },
    select: { id: true },
  });
  return row?.id ?? null;
}

// ─────────────────────────────────────────────
// 排程發佈（FEAT-4 4-D，T124，FR-049～FR-051）
// ─────────────────────────────────────────────

/**
 * 寫入或清除排程時刻。`null` 即取消排程（維持草稿）。
 *
 * 同一章節多次改排程 → 覆寫同一欄，**不留多個待發佈狀態**（data-model.md §3.2）：
 * 若改成另建一張排程表，同一章就可能同時存在兩筆到期紀錄而被發佈兩次。
 */
export async function setChapterScheduledAt(
  chapterId: string,
  scheduledAt: Date | null,
  tx?: TxClient
): Promise<void> {
  await db(tx).chapter.update({ where: { id: chapterId }, data: { scheduledAt } });
}

/** 作者端顯示「已排程於 X 發佈」的取數；未排程回 `null` */
export async function getChapterScheduledAt(
  chapterId: string,
  tx?: TxClient
): Promise<Date | null> {
  const row = await db(tx).chapter.findUnique({
    where: { id: chapterId },
    select: { scheduledAt: true },
  });
  return row?.scheduledAt ?? null;
}

export interface DueScheduledChapter {
  id: string;
  novelId: string;
  number: number;
  title: string;
  wordCount: number;
}

/**
 * 到期的排程章節（`status='draft' AND scheduledAt <= now`，走 `@@index([status, scheduledAt])`）。
 *
 * **已被作者手動發佈或刪除者自然不入選**：前者的 `status` 已是 `published`、
 * 後者的列已不存在 —— 兩種情況都靠掃描條件排除，**不靠例外處理**。
 * 反過來寫（先撈出來再逐一判斷、判斷不過就擲錯）會讓單一章節的狀態弄停整批發佈。
 *
 * 依 `novelId, number` 排序：呼叫端要 group by 作品，且通知的「最新章」以編號決定。
 */
export async function findDueScheduled(now: Date, tx?: TxClient): Promise<DueScheduledChapter[]> {
  return db(tx).chapter.findMany({
    where: { status: 'draft', scheduledAt: { not: null, lte: now } },
    orderBy: [{ novelId: 'asc' }, { number: 'asc' }],
    select: { id: true, novelId: true, number: true, title: true, wordCount: true },
  });
}

/**
 * 到期章節的發佈本體（MUST 於呼叫端的交易內執行）。
 *
 * 條件仍帶 `status: 'draft'`：掃描與寫入之間若作者剛好自己按了發佈，
 * 這一筆會回 `count: 0`，呼叫端據此不把它計入本次發佈數，也就不會為它再發一次通知。
 * `scheduledAt` 於同一句清為 `null` —— **那一欄就是重複發佈的唯一防護**。
 */
export async function publishScheduledChapterRow(
  chapterId: string,
  now: Date,
  tx?: TxClient
): Promise<boolean> {
  const result = await db(tx).chapter.updateMany({
    where: { id: chapterId, status: 'draft' },
    data: { status: 'published', publishedAt: now, scheduledAt: null },
  });
  return result.count > 0;
}

/** 追更通知所需的章節欄位（編號與標題）；章節已不存在回 `null` */
export async function getChapterNotifyRef(
  chapterId: string,
  tx?: TxClient
): Promise<{ id: string; number: number; title: string } | null> {
  return db(tx).chapter.findUnique({
    where: { id: chapterId },
    select: { id: true, number: true, title: true },
  });
}
