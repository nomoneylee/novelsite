import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { createChapter } from '@/lib/services/chapterService';
import { ServiceError } from '@/lib/services/errors';
import {
  createAuthor,
  createNovelWithChapter,
  cleanupAuthoring,
  type TestAuthor,
  type TestNovel,
} from '../helpers/authoring';

/**
 * US1 AC6／`arch.md` §10.3 案例 17：併發建立章節撞號。
 *
 * 章節編號由系統指派為「該作品目前最大編號 + 1」，併發請求可能算出同一個數字。
 * 資料層的 `@@unique([novelId, number])` 會擋下第二筆 —— 重點在於**服務層要把它轉譯成
 * `CONFLICT`**，而不是讓 Prisma 的唯一約束例外原樣冒泡（那會變成 500，把資料庫的
 * 內部細節送到使用者面前，也讓前端無從分辨「重試就好」與「真的壞了」）。
 *
 * **測試設計上的一個坦白**：「一定會有一筆撞號」是**測不出來的**。
 * 併發是否真的重疊取決於資料庫與連線池 —— 初版寫成「其一成功、另一回 CONFLICT」，
 * 在 SQLite 上綠、在 PostgreSQL 上紅：後者的兩次讀取被串行化，兩筆都拿到不同編號、
 * 兩筆都成功。那不是實作有問題，是**斷言把偶然當成了保證**。
 *
 * 故本檔改為斷言三件無論有沒有真的撞上都必須成立的事：
 *   1. 資料庫**永遠**沒有重複編號（真正的不變式）；
 *   2. 任何一筆失敗 MUST 是 `ServiceError` 且碼為 `CONFLICT`（不得是原始例外或 500）；
 *   3. 成功筆數 + 失敗筆數 = 送出筆數（沒有請求人間蒸發）。
 * 至於「P2002 一定會被轉成 CONFLICT」這條轉譯規則本身，
 * 由 `tests/unit/service-errors.test.ts` 以確定性的方式驗證，不依賴時序。
 */

const CONCURRENCY = 12;

let author: TestAuthor;
let novel: TestNovel;

beforeAll(async () => {
  await cleanupAuthoring();
  author = await createAuthor('conflict');
  novel = await createNovelWithChapter({ authorId: author.id });
});

afterAll(async () => {
  await cleanupAuthoring();
});

describe('併發建立章節（案例 17、FR-009）', () => {
  it(`${CONCURRENCY} 個併發請求：無重複編號，任何失敗皆為 CONFLICT`, async () => {
    const countBefore = await prisma.chapter.count({ where: { novelId: novel.novelId } });
    const input = { novelId: novel.novelId, volumeId: novel.volumeId };

    // 共用的閘門讓全部請求在同一個 tick 之後才起跑，盡量製造真正的重疊
    const gate = new Promise<void>((resolve) => setTimeout(resolve, 50));
    const results = await Promise.allSettled(
      Array.from({ length: CONCURRENCY }, () => gate.then(() => createChapter(author.id, input)))
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled.length + rejected.length).toBe(CONCURRENCY);
    expect(fulfilled.length).toBeGreaterThan(0);

    for (const r of rejected) {
      const reason = (r as PromiseRejectedResult).reason;
      expect(
        reason instanceof ServiceError,
        `擲出的不是 ServiceError，而是 ${String(reason)} —— 資料庫例外原樣冒泡即為未完成`
      ).toBe(true);
      expect((reason as ServiceError).code).toBe('CONFLICT');
    }

    const chapters = await prisma.chapter.findMany({
      where: { novelId: novel.novelId },
      select: { number: true },
    });
    const numbers = chapters.map((c) => c.number);
    expect(new Set(numbers).size, '出現重複的章節編號').toBe(numbers.length);
    expect(chapters.length).toBe(countBefore + fulfilled.length);
  });

  it('後續的單一建立仍取得下一個編號（併發未污染編號序列）', async () => {
    const max =
      (
        await prisma.chapter.aggregate({
          where: { novelId: novel.novelId },
          _max: { number: true },
        })
      )._max.number ?? 0;

    const { chapterId } = await createChapter(author.id, {
      novelId: novel.novelId,
      volumeId: novel.volumeId,
    });

    const created = await prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } });
    expect(created.number).toBe(max + 1);
    expect(created.status).toBe('draft');
    expect(created.publishedAt).toBeNull();
  });
});
