import 'server-only';
import { randomUUID } from 'node:crypto';
import {
  createNovelRow,
  updateNovelOwned,
  setNovelStatusOwned,
  deleteNovelOwned,
  categoryExists,
  countExistingTags,
  replaceNovelTags,
  getNovelSearchSource,
  setNovelSearchText,
  listNovelIdsByAuthor,
  touchNovel,
  getAuthorNovelManage,
  withTransaction,
  type TxClient,
} from '@/lib/repositories';
import { buildSearchText } from './searchText';
import { assertNovelOwner, NotFoundError } from '@/lib/auth/ownership';
import { invalidateNovel, invalidateNovelsList } from '@/lib/cache';
import {
  createNovelSchema,
  updateNovelSchema,
  setNovelStatusSchema,
  novelIdSchema,
  pickCoverColor,
} from '@/lib/validation/novel';
import { ServiceError, parseOrThrow, translateDbError } from './errors';

/**
 * 作品寫入的業務規則（FR-012、FR-012c、contracts/internal-modules.md §1.1）
 * ==========================================================================
 * 每一項寫入的固定順序：
 *   **Zod 驗證 → 擁有者守衛（建立除外）→ 交易（寫入 + 計數）→ 快取失效**
 *
 * 順序不可調換。特別是擁有者守衛必須在**任何**寫入之前 —— 先寫再檢查等於已經改掉了
 * 別人的資料，只是接著回一個錯誤訊息給對方看。
 *
 * **搜尋預算的重算（3-A 的 T075 接縫）**：標題、分類、標籤任一異動都會改變
 * `searchText`，故一律於**同一個交易內**重算，並同步推進 `updatedAt`（FR-028、FR-034）。
 * 分開做的話，中途失敗會留下「作品是新的、搜尋是舊的」——
 * 而那個狀態不會有任何錯誤訊息，只會有一部搜不到的作品。
 */

export { ServiceError } from './errors';

/**
 * 依資料庫當下的內容重算搜尋預算（FR-027／FR-028）。
 *
 * **刻意從資料庫讀回來源**而非沿用入參：`updateNovel` 的欄位皆為選填，
 * 拿入參拼字串會在「只改了標籤」時把標題寫成 undefined。
 * MUST 於呼叫端的交易內、且在該次寫入**之後**執行。
 */
async function rebuildSearchText(novelId: string, tx?: TxClient): Promise<void> {
  const source = await getNovelSearchSource(novelId, tx);
  if (!source) return;
  await setNovelSearchText(novelId, buildSearchText(source), tx);
}

/**
 * 重算某位作者**名下全部作品**的搜尋預算與排序鍵（FR-028a、contracts §1.1）。
 *
 * 供 `userService.updateProfile` 於筆名異動時呼叫，**MUST 在呼叫端提供的交易內執行** ——
 * 個資與預算若不同交易，中途失敗會留下「筆名已改但舊筆名仍搜得到」，
 * 而那個狀態不會有任何錯誤訊息（FR-028a 明文禁止先提交再補算）。
 *
 * `tx` 為必填而非選填：這個函式沒有任何「單獨執行也合理」的情境。
 */
export async function rebuildSearchTextForAuthor(tx: TxClient, authorId: string): Promise<void> {
  const novelIds = await listNovelIdsByAuthor(authorId, tx);
  const now = new Date();

  for (const novelId of novelIds) {
    await rebuildSearchText(novelId, tx);
    // 排序鍵同步推進 —— 作品的公開顯示名變了，就該在搜尋結果上浮（FR-034）
    await touchNovel(novelId, now, tx);
  }
}

/** 擁有者守衛擲出的「找不到」→ 對外的 NOT_FOUND（兩者本來就該是同一件事） */
function toServiceError(err: unknown, conflictMessage: string): ServiceError {
  if (err instanceof NotFoundError) {
    return new ServiceError('NOT_FOUND', '找不到指定的資源');
  }
  return translateDbError(err, conflictMessage);
}

/** 影響列數為 0 → 作品不存在或不屬於該作者，兩者回應完全相同（FR-004） */
function assertAffected(count: number): void {
  if (count === 0) throw new ServiceError('NOT_FOUND', '找不到指定的資源');
}

export async function createNovel(uid: string, input: unknown): Promise<{ novelId: string }> {
  const data = parseOrThrow(createNovelSchema, input);

  try {
    if (!(await categoryExists(data.categoryId))) {
      throw new ServiceError('VALIDATION_ERROR', '輸入格式不正確', {
        fields: { categoryId: '請選擇既有的分類' },
      });
    }

    const novelId = await withTransaction(async (tx) => {
      const created = await createNovelRow(
        {
          id: randomUUID(),
          title: data.title,
          authorId: uid,
          categoryId: data.categoryId,
          excerpt: data.excerpt,
          // 封面色由系統自既有色票組指派，作者不可指定（FR-012）
          coverColor: pickCoverColor(),
        },
        tx
      );
      await rebuildSearchText(created, tx);
      return created;
    });

    invalidateNovelsList();
    return { novelId };
  } catch (err) {
    throw toServiceError(err, '作品建立衝突，請重試');
  }
}

export async function updateNovel(uid: string, input: unknown): Promise<void> {
  const data = parseOrThrow(updateNovelSchema, input);

  try {
    await assertNovelOwner(uid, data.novelId);

    await withTransaction(async (tx) => {
      if (data.categoryId && !(await categoryExists(data.categoryId, tx))) {
        throw new ServiceError('VALIDATION_ERROR', '輸入格式不正確', {
          fields: { categoryId: '請選擇既有的分類' },
        });
      }

      /**
       * 標籤存在性 MUST 於交易內查證（FR-012c）。Zod 只驗得了「這是不是字串陣列」；
       * 「這個識別碼真的有這個標籤嗎」是資料庫事實。只靠前端下拉選單保證，
       * 等於相信每一個呼叫者都是照著介面用的那一種。
       */
      if (data.tagIds) {
        const unique = [...new Set(data.tagIds)];
        const existing = await countExistingTags(unique, tx);
        if (existing !== unique.length) {
          throw new ServiceError('VALIDATION_ERROR', '輸入格式不正確', {
            fields: { tagIds: '含有不存在的標籤' },
          });
        }
      }

      const count = await updateNovelOwned(
        uid,
        data.novelId,
        {
          ...(data.title !== undefined ? { title: data.title } : {}),
          ...(data.categoryId !== undefined ? { categoryId: data.categoryId } : {}),
          ...(data.excerpt !== undefined ? { excerpt: data.excerpt } : {}),
          ...(data.description !== undefined ? { description: data.description } : {}),
          ...(data.coverColor !== undefined ? { coverColor: data.coverColor } : {}),
          ...(data.serialStatus !== undefined ? { serialStatus: data.serialStatus } : {}),
          // **一律帶入**：其一是「作品有更新就該在搜尋結果上浮」（FR-034），
          // 其二是這一欄保證了 SET 子句不會是空的 —— 只改標籤時其餘欄位全缺席，
          // 空的 UPDATE 影響列數為 0，而 `assertAffected` 會把 0 讀成「找不到」，
          // 於是一個成功的操作回了一個假的 404
          updatedAt: new Date(),
        },
        tx
      );
      assertAffected(count);

      if (data.tagIds) {
        await replaceNovelTags(data.novelId, [...new Set(data.tagIds)], tx);
      }

      // 標題／分類／標籤任一異動都會改變搜尋預算；一律重算比逐欄位判斷更難出錯
      await rebuildSearchText(data.novelId, tx);
    });

    invalidateNovel(data.novelId);
    invalidateNovelsList();
  } catch (err) {
    throw toServiceError(err, '作品更新衝突，請重試');
  }
}

export async function setNovelStatus(uid: string, input: unknown): Promise<void> {
  const data = parseOrThrow(setNovelStatusSchema, input);

  if (data.status === 'admin_suspended') {
    throw new ServiceError('FORBIDDEN', '無法將作品狀態設為管理員下架');
  }

  try {
    await assertNovelOwner(uid, data.novelId);

    const current = await getAuthorNovelManage(uid, data.novelId);
    if (current && current.status === 'admin_suspended') {
      throw new ServiceError(
        'FORBIDDEN',
        '此作品已被管理員下架，無法自主變更狀態，如有疑問請聯繫客服'
      );
    }

    await withTransaction(async (tx) => {
      assertAffected(await setNovelStatusOwned(uid, data.novelId, data.status, tx));
      // 上下架不改變 searchText，但**必須推進排序鍵**：重新上架的作品若還帶著
      // 舊的更新時間，就會出現在搜尋結果的深處，作者只會看到「上架了但找不到」
      await touchNovel(data.novelId, new Date(), tx);
    });

    invalidateNovel(data.novelId);
    invalidateNovelsList();
  } catch (err) {
    if (err instanceof ServiceError) throw err;
    throw toServiceError(err, '作品狀態更新衝突，請重試');
  }
}

export async function deleteNovel(uid: string, input: unknown): Promise<void> {
  const data = parseOrThrow(novelIdSchema, input);

  try {
    await assertNovelOwner(uid, data.novelId);
    // 卷／章節／正文／標籤關聯的清除由 schema 的級聯負責（FEAT-2 已建立）
    assertAffected(await deleteNovelOwned(uid, data.novelId));

    invalidateNovel(data.novelId);
    invalidateNovelsList();
  } catch (err) {
    throw toServiceError(err, '作品刪除衝突，請重試');
  }
}
