import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { search } from '@/lib/services/searchService';
import { createNovel, updateNovel, setNovelStatus } from '@/lib/services/novelService';
import { ServiceError } from '@/lib/services/errors';
import {
  createAuthor,
  distinctCategoryIds,
  cleanupAuthoring,
  TEST_PREFIX,
  type TestAuthor,
} from '../helpers/authoring';

/**
 * FR-028：作品標題／分類／標籤異動後，**以新值搜得到、舊值搜不到**。
 *
 * 本檔走的是真正的寫入路徑（`novelService`），不預先塞好 `searchText` ——
 * 其餘搜尋測試的前置資料由 fixtures 直接寫欄位，那證明得了「查詢對不對」，
 * 證明不了「寫入時有沒有記得重算」。少了這一組，`searchText` 會在
 * 「新增一條寫入路徑卻忘了重算」的那一天悄悄過期，而搜尋結果只是「舊了一點」，
 * 沒有任何錯誤訊息。
 *
 * FR-012c 的標籤存在性也在此驗證：拒絕時**作品與標籤關聯皆不得部分套用**。
 */

const OLD_TITLE = 'zbudget 初版標題';
const NEW_TITLE = 'zbudget 改版標題';

let author: TestAuthor;
let catA: string;
let catB: string;
let catALabel: string;
let catBLabel: string;
let novelId: string;
let tagOldId: string;
let tagNewId: string;

const TAG_OLD = 'zbudget舊標籤';
const TAG_NEW = 'zbudget新標籤';

async function idsOf(q: string): Promise<string[]> {
  const page = await search({ q, limit: 50 });
  return page.items.map((n) => n.id);
}

beforeAll(async () => {
  await cleanupAuthoring();
  author = await createAuthor('budget');
  [catA, catB] = await distinctCategoryIds(2);

  const [rowA, rowB] = await Promise.all([
    prisma.category.findUniqueOrThrow({ where: { id: catA }, select: { label: true } }),
    prisma.category.findUniqueOrThrow({ where: { id: catB }, select: { label: true } }),
  ]);
  catALabel = rowA.label;
  catBLabel = rowB.label;

  for (const [name, ref] of [
    [TAG_OLD, 'old'],
    [TAG_NEW, 'new'],
  ] as const) {
    const tag = await prisma.tag.upsert({
      where: { name },
      update: {},
      create: { id: `${TEST_PREFIX}tag-${ref}`, name, slug: `${TEST_PREFIX}tag-${ref}` },
      select: { id: true },
    });
    if (ref === 'old') tagOldId = tag.id;
    else tagNewId = tag.id;
  }

  // 建立 → 上架 → 掛上舊標籤，作為後續每一則異動的共同起點
  ({ novelId } = await createNovel(author.id, {
    title: OLD_TITLE,
    categoryId: catA,
    excerpt: '搜尋預算同步測試用的作品簡介。',
  }));
  await setNovelStatus(author.id, { novelId, status: 'published' });
  await updateNovel(author.id, { novelId, tagIds: [tagOldId] });
});

afterAll(async () => {
  await cleanupAuthoring();
});

describe('建立與上架即進入搜尋預算', () => {
  it('以標題搜得到', async () => {
    expect(await idsOf(OLD_TITLE)).toContain(novelId);
  });

  it('以作者筆名搜得到（FR-027 的組成之一）', async () => {
    expect(await idsOf(`筆名-budget`)).toContain(novelId);
  });

  it('以分類名稱搜得到', async () => {
    expect(await idsOf(catALabel)).toContain(novelId);
  });

  it('以標籤名稱搜得到', async () => {
    expect(await idsOf(TAG_OLD)).toContain(novelId);
  });
});

describe('標題異動後以新值搜得到、舊值搜不到（FR-028）', () => {
  it('更新標題', async () => {
    await updateNovel(author.id, { novelId, title: NEW_TITLE });

    expect(await idsOf(NEW_TITLE)).toContain(novelId);
    expect(await idsOf(OLD_TITLE)).not.toContain(novelId);
  });
});

describe('分類異動後以新分類搜得到、舊分類搜不到（FR-028）', () => {
  it('更新分類', async () => {
    await updateNovel(author.id, { novelId, categoryId: catB });

    expect(await idsOf(catBLabel)).toContain(novelId);
    expect(await idsOf(catALabel)).not.toContain(novelId);
  });
});

describe('標籤異動後以新標籤搜得到、舊標籤搜不到（FR-028）', () => {
  it('更換標籤', async () => {
    await updateNovel(author.id, { novelId, tagIds: [tagNewId] });

    expect(await idsOf(TAG_NEW)).toContain(novelId);
    expect(await idsOf(TAG_OLD)).not.toContain(novelId);
  });

  it('清空標籤（空陣列）後，原標籤搜不到，標題仍搜得到', async () => {
    await updateNovel(author.id, { novelId, tagIds: [] });

    expect(await idsOf(TAG_NEW)).not.toContain(novelId);
    expect(await idsOf(NEW_TITLE)).toContain(novelId);
  });
});

describe('上下架即時反映於搜尋（FR-035）', () => {
  it('下架後搜不到，重新上架後搜得到', async () => {
    await setNovelStatus(author.id, { novelId, status: 'draft' });
    expect(await idsOf(NEW_TITLE)).not.toContain(novelId);

    await setNovelStatus(author.id, { novelId, status: 'published' });
    expect(await idsOf(NEW_TITLE)).toContain(novelId);
  });
});

describe('不存在的標籤識別碼：回 400 且作品與標籤關聯皆未變更（FR-012c）', () => {
  it('整筆拒絕，無部分套用', async () => {
    await updateNovel(author.id, { novelId, tagIds: [tagNewId] });

    const before = await prisma.novel.findUniqueOrThrow({
      where: { id: novelId },
      include: { tags: { orderBy: { tagId: 'asc' } } },
    });

    await expect(
      updateNovel(author.id, {
        novelId,
        title: 'zbudget 不該被寫入的標題',
        tagIds: [tagNewId, 'zz-no-such-tag'],
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    const after = await prisma.novel.findUniqueOrThrow({
      where: { id: novelId },
      include: { tags: { orderBy: { tagId: 'asc' } } },
    });

    expect(after).toEqual(before);
    expect(await idsOf('zbudget 不該被寫入的標題')).not.toContain(novelId);
    expect(await idsOf(TAG_NEW)).toContain(novelId);
  });

  it('錯誤帶有 tagIds 欄位訊息，供表單直接顯示', async () => {
    const err = await updateNovel(author.id, { novelId, tagIds: ['zz-no-such-tag'] }).catch(
      (e: unknown) => e
    );

    expect(err).toBeInstanceOf(ServiceError);
    expect((err as ServiceError).fields).toHaveProperty('tagIds');
  });
});
