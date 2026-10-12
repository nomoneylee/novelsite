import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ServiceError } from '@/lib/services/errors';
import { updateNovel, setNovelStatus, deleteNovel } from '@/lib/services/novelService';
import {
  createVolume,
  updateVolume,
  deleteVolume,
  createChapter,
  saveChapterDraft,
  setChapterStatus,
  deleteChapter,
  reorderChapters,
} from '@/lib/services/chapterService';
import {
  createAuthor,
  createNovelWithChapter,
  snapshotNovel,
  cleanupAuthoring,
  type TestAuthor,
  type TestNovel,
} from '../helpers/authoring';

/**
 * US1 AC5／SC-002：越權寫入一律「找不到」（`arch.md` §10.3 案例 7、FR-004／FR-005）。
 *
 * **受測層級與其理由**：本檔打的是**服務層**，因為 `assertNovelOwner` 就住在那裡 ——
 * 十二個 Action 都只是「守衛 → 服務層 → 錯誤轉譯」的薄殼，擁有權判斷一次也沒有
 * 寫在 Action 裡。至於「Action 有沒有記得把守衛叫起來」，那是另一個問題，
 * 由 `author-role-guard.test.ts` 的靜態稽核逐一涵蓋十三個 Action。
 *
 * 兩組斷言缺一不可：
 *   (a) 非擁有者得到 `NOT_FOUND`，且**資料真的沒變**（只看回傳值會漏掉
 *       「擋了錯誤訊息、但交易已經寫進去」這種最難查的實作）；
 *   (b) 非擁有者與**不存在的識別碼**得到**完全相同**的錯誤碼與訊息 ——
 *       任何差異都等於告訴呼叫者「這個 id 是有效的，只是不是你的」。
 */

let authorA: TestAuthor;
let authorB: TestAuthor;
/** 作者 B 的資源（作者 A 一概碰不得） */
let owned: TestNovel;
let before: string;

/** 一定不存在的識別碼；與 B 的識別碼並列比對，兩者結果 MUST 完全相同 */
const GHOST = 'us1t-ghost-does-not-exist';

beforeAll(async () => {
  await cleanupAuthoring();
  authorA = await createAuthor('owner-a');
  authorB = await createAuthor('owner-b');
  owned = await createNovelWithChapter({ authorId: authorB.id });
  before = await snapshotNovel(owned.novelId);
});

afterAll(async () => {
  await cleanupAuthoring();
});

interface Ids {
  novelId: string;
  volumeId: string;
  chapterId: string;
}

/** 十二種受擁有者守衛的寫入（`createNovel` 無既有擁有權標的，其防線是角色檢查） */
function writeCases(uid: string, ids: Ids): { name: string; run: () => Promise<unknown> }[] {
  return [
    {
      name: 'updateNovel',
      run: () => updateNovel(uid, { novelId: ids.novelId, title: '被別人改掉的標題' }),
    },
    {
      name: 'setNovelStatus（上下架）',
      run: () => setNovelStatus(uid, { novelId: ids.novelId, status: 'published' }),
    },
    { name: 'deleteNovel', run: () => deleteNovel(uid, { novelId: ids.novelId }) },
    {
      name: 'createVolume',
      run: () => createVolume(uid, { novelId: ids.novelId, title: '別人塞進來的卷' }),
    },
    {
      name: 'updateVolume',
      run: () => updateVolume(uid, { volumeId: ids.volumeId, title: '被改掉的卷名' }),
    },
    { name: 'deleteVolume', run: () => deleteVolume(uid, { volumeId: ids.volumeId }) },
    {
      name: 'createChapter',
      run: () => createChapter(uid, { novelId: ids.novelId, volumeId: ids.volumeId }),
    },
    {
      name: 'saveChapterDraft',
      run: () =>
        saveChapterDraft(uid, {
          chapterId: ids.chapterId,
          title: '被改掉的章名',
          bodyMarkdown: '被塞進來的正文。',
        }),
    },
    {
      name: 'setChapterStatus（發佈）',
      run: () => setChapterStatus(uid, { chapterId: ids.chapterId, status: 'published' }),
    },
    {
      name: 'setChapterStatus（下架）',
      run: () => setChapterStatus(uid, { chapterId: ids.chapterId, status: 'draft' }),
    },
    {
      name: 'reorderChapters',
      run: () =>
        reorderChapters(uid, { volumeId: ids.volumeId, orderedChapterIds: [ids.chapterId] }),
    },
    { name: 'deleteChapter', run: () => deleteChapter(uid, { chapterId: ids.chapterId }) },
  ];
}

/** 執行一次寫入，回傳它擲出的 ServiceError（沒擲出即為測試失敗） */
async function captureError(run: () => Promise<unknown>, label: string): Promise<ServiceError> {
  try {
    await run();
  } catch (err) {
    expect(err, `${label} 擲出的不是 ServiceError：${String(err)}`).toBeInstanceOf(ServiceError);
    return err as ServiceError;
  }
  throw new Error(`${label}：越權寫入竟然成功了`);
}

const CASE_NAMES = writeCases('x', { novelId: 'x', volumeId: 'x', chapterId: 'x' }).map(
  (c) => c.name
);

describe('作者 A 對作者 B 的資源發動全部十二種寫入（案例 7、SC-002）', () => {
  it('十二種受擁有者守衛的寫入都在測試清單內（守衛矩陣未因新增而漏列）', () => {
    expect(CASE_NAMES).toHaveLength(12);
  });

  for (const name of CASE_NAMES) {
    it(`${name}：回 NOT_FOUND 且作者 B 的資料未變更`, async () => {
      const target = writeCases(authorA.id, {
        novelId: owned.novelId,
        volumeId: owned.volumeId,
        chapterId: owned.chapterId,
      }).find((c) => c.name === name)!;

      const err = await captureError(target.run, name);
      expect(err.code).toBe('NOT_FOUND');
      expect(await snapshotNovel(owned.novelId)).toBe(before);
    });
  }
});

describe('非擁有者與不存在的識別碼結果完全相同（FR-004）', () => {
  for (const name of CASE_NAMES) {
    it(`${name}：對 B 的 id 與對幽靈 id 得到相同的錯誤碼與訊息`, async () => {
      const pick = (ids: Ids) => writeCases(authorA.id, ids).find((c) => c.name === name)!;

      const onOwned = await captureError(
        pick({ novelId: owned.novelId, volumeId: owned.volumeId, chapterId: owned.chapterId }).run,
        `${name}（B 的 id）`
      );
      const onGhost = await captureError(
        pick({ novelId: GHOST, volumeId: GHOST, chapterId: GHOST }).run,
        `${name}（幽靈 id）`
      );

      expect(onOwned.code).toBe(onGhost.code);
      expect(onOwned.message).toBe(onGhost.message);
      expect(onOwned.fields).toEqual(onGhost.fields);
      expect(await snapshotNovel(owned.novelId)).toBe(before);
    });
  }

  it('作者 B 本人對同一組資源的寫入則成功（證明上面的 NOT_FOUND 出自擁有權而非資源壞掉）', async () => {
    await updateNovel(authorB.id, { novelId: owned.novelId, title: '擁有者改得動的標題' });
    const after = await snapshotNovel(owned.novelId);
    expect(after).not.toBe(before);
    expect(after).toContain('擁有者改得動的標題');
  });
});
