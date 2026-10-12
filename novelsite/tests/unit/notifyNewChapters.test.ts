import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * T113：追更通知的合併規則（FR-052a、FR-054、contracts/internal-modules.md §1）
 * ==============================================================================
 * 「一次排程作業內發佈 M 章 → 每位收藏者仍只收到 **1 則**通知」這句話的實作落點，
 * **不在**呼叫端而在本服務：呼叫端只負責把一組章節交過來
 * （立即發佈給 1 章、排程作業 group by `novelId` 後給 N 章），
 * 合併與否完全由 `notifyNewChapters` 對「一組章節產生一則」的承諾決定。
 *
 * 服務本身**無狀態** —— 收件人、作品資訊與寫入皆經資料存取層，
 * 故以 `vi.mock` 換成間諜即可在無資料庫的單元套件內驗證全部分支；
 * 真實的「N 位收藏者恰得 N 則」由 `tests/integration/notification-count.test.ts` 覆蓋。
 *
 * **本檔同時是三件事的唯一防線**（整合測試看得到結果、看不到成因）：
 *
 *  1. **收件人排除作者本人**：作者把自己的作品加進書架是常見行為，
 *     不排除的話每次發佈都會通知自己「你的作品更新了」。
 *  2. **`payload` 存 JSON 字串**（data-model.md §2.8：MUST NOT 用 `Json` 型別，雙軌相容）——
 *     若哪天改成傳物件進去，SQLite 軌會在寫入時才炸，而那時錯誤訊息只會說型別不符。
 *  3. **`latest*` 取自最大 `number` 而非陣列順序**：呼叫端給的順序不保證，
 *     照順序取「最後一個」會在補發舊章時把通知標題指到舊章節
 *     （與 `getLatestPublishedChapterId` 的判準一致：章節先後由編號定義）。
 */

vi.mock('@/lib/repositories', () => ({
  getNovelNotifyRef: vi.fn(),
  listBookshelfUserIds: vi.fn(),
  createNotifications: vi.fn(),
}));

const { getNovelNotifyRef, listBookshelfUserIds, createNotifications } =
  await import('@/lib/repositories');
const { notifyNewChapters } = await import('@/lib/services/notificationService');

const NOVEL_ID = 'novel-1';
const AUTHOR_ID = 'user-author';

/** 三章刻意**不依編號排序**傳入，用以區分「陣列最後一個」與「編號最大者」 */
const CHAPTERS = [
  { id: 'ch-2', number: 2, title: '第 2 章' },
  { id: 'ch-3', number: 3, title: '第 3 章' },
  { id: 'ch-1', number: 1, title: '第 1 章' },
];

interface NotificationRow {
  userId: string;
  type: string;
  payload: string;
}

/** 取 `createNotifications` 唯一一次呼叫的引數 */
function createdRows(): NotificationRow[] {
  expect(createNotifications).toHaveBeenCalledTimes(1);
  return vi.mocked(createNotifications).mock.calls[0][0] as unknown as NotificationRow[];
}

beforeEach(() => {
  vi.mocked(getNovelNotifyRef).mockReset();
  vi.mocked(listBookshelfUserIds).mockReset();
  vi.mocked(createNotifications).mockReset();

  vi.mocked(getNovelNotifyRef).mockResolvedValue({
    id: NOVEL_ID,
    slug: 'novel-1-slug',
    title: '測試作品',
    authorId: AUTHOR_ID,
  } as never);
  vi.mocked(listBookshelfUserIds).mockResolvedValue(['user-a', 'user-b'] as never);
  vi.mocked(createNotifications).mockImplementation(
    (async (rows: NotificationRow[]) => rows.length) as never
  );
});

describe('T113-1：一組章節產生一則通知（FR-052a）', () => {
  it('給 3 章，每位收藏者只得 1 則 —— 而非 3 則', async () => {
    const created = await notifyNewChapters(NOVEL_ID, CHAPTERS);

    const rows = createdRows();
    expect(rows).toHaveLength(2); // 收藏者 2 位
    expect(rows.map((r) => r.userId).sort()).toEqual(['user-a', 'user-b']);
    expect(created).toBe(2);
  });

  it('給 1 章（立即發佈的呼叫形狀）同樣是每位收藏者 1 則', async () => {
    await notifyNewChapters(NOVEL_ID, [CHAPTERS[0]]);
    expect(createdRows()).toHaveLength(2);
  });
});

describe('T113-2：收件人為收藏者且排除作者本人', () => {
  it('作者把自己的作品加進書架時，作者不在收件人之列', async () => {
    vi.mocked(listBookshelfUserIds).mockResolvedValue(['user-a', AUTHOR_ID, 'user-b'] as never);

    await notifyNewChapters(NOVEL_ID, CHAPTERS);

    const userIds = createdRows().map((r) => r.userId);
    expect(userIds).not.toContain(AUTHOR_ID);
    expect(userIds.sort()).toEqual(['user-a', 'user-b']);
  });

  it('收藏者只有作者本人時，完全不寫入（MUST NOT 產生 0 列的空呼叫）', async () => {
    vi.mocked(listBookshelfUserIds).mockResolvedValue([AUTHOR_ID] as never);

    expect(await notifyNewChapters(NOVEL_ID, CHAPTERS)).toBe(0);
    expect(createNotifications).not.toHaveBeenCalled();
  });

  it('無人收藏時回 0 且不寫入', async () => {
    vi.mocked(listBookshelfUserIds).mockResolvedValue([] as never);

    expect(await notifyNewChapters(NOVEL_ID, CHAPTERS)).toBe(0);
    expect(createNotifications).not.toHaveBeenCalled();
  });

  it('章節組為空時直接回 0，連收件人都不查（排程作業重跑時的空集合）', async () => {
    expect(await notifyNewChapters(NOVEL_ID, [])).toBe(0);
    expect(listBookshelfUserIds).not.toHaveBeenCalled();
    expect(createNotifications).not.toHaveBeenCalled();
  });
});

describe('T113-3：payload 的固定形狀（data-model.md §2.8）', () => {
  it('payload 為 JSON **字串**，MUST NOT 傳物件（雙軌相容）', async () => {
    await notifyNewChapters(NOVEL_ID, CHAPTERS);

    for (const row of createdRows()) {
      expect(typeof row.payload).toBe('string');
      expect(() => JSON.parse(row.payload)).not.toThrow();
    }
  });

  it('六個欄位齊備，chapterCount 為本次章節數', async () => {
    await notifyNewChapters(NOVEL_ID, CHAPTERS);

    const payload = JSON.parse(createdRows()[0].payload);
    expect(payload).toEqual({
      novelId: NOVEL_ID,
      novelSlug: 'novel-1-slug',
      novelTitle: '測試作品',
      chapterCount: 3,
      latestChapterId: 'ch-3',
      latestChapterTitle: '第 3 章',
    });
  });

  it('latestChapter* 取**編號最大**者，而非傳入陣列的最後一個', async () => {
    // 陣列最後一個是 ch-1（第 1 章）；取錯的實作會在此紅燈
    const payload = JSON.parse((await lastPayload(CHAPTERS)) as string);
    expect(payload.latestChapterId).toBe('ch-3');
    expect(payload.latestChapterTitle).toBe('第 3 章');
  });

  it('每一則的 type 恆為 chapter_published（FR-054：其餘型別保留欄位、不產生資料）', async () => {
    await notifyNewChapters(NOVEL_ID, CHAPTERS);
    expect([...new Set(createdRows().map((r) => r.type))]).toEqual(['chapter_published']);
  });
});

/** 跑一次並回傳第一則的 payload 原文（供只關心 payload 的案例使用） */
async function lastPayload(chapters: typeof CHAPTERS): Promise<string> {
  vi.mocked(createNotifications).mockClear();
  await notifyNewChapters(NOVEL_ID, chapters);
  return createdRows()[0].payload;
}
