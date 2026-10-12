/**
 * 作者寫入流的測試資料建置與清理（US1 整合測試共用）
 * =====================================================
 * 經 Prisma 直接建置，理由與 `resetAuthTables.ts` 相同：這是測試自己的前置資料，
 * 不是受測路徑；受測路徑是服務層與 Action。
 *
 * **可重複性**（SC-006「連續執行兩次皆全綠」）：所有建置物一律以 `TEST_PREFIX` 起頭，
 * `cleanupAuthoring()` 依此前綴刪除。MUST NOT 依賴示範資料被保留或被清空 ——
 * 兩種假設都會在「自完全空白的測試資料庫執行一次」時破功。
 */
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';
import { buildSearchText } from '@/lib/services/searchText';

/** 本檔建立的所有資料列共用的識別碼前綴，清理依此進行 */
export const TEST_PREFIX = 'us1t-';

let seq = 0;
function nextId(kind: string): string {
  seq += 1;
  return `${TEST_PREFIX}${kind}-${Date.now().toString(36)}-${seq}`;
}

/** 取一個既有分類 id（示範資料必有；空資料庫時建一個測試用分類） */
export async function anyCategoryId(): Promise<string> {
  const existing = await prisma.category.findFirst({ orderBy: { sortOrder: 'asc' } });
  if (existing) return existing.id;

  const id = `${TEST_PREFIX}category`;
  await prisma.category.create({
    data: {
      id,
      slug: id,
      label: '測試分類',
      emoji: '🧪',
      description: '整合測試專用',
      color: '#000000',
      bgColor: '#ffffff',
    },
  });
  return id;
}

/**
 * 取得 n 個彼此不同的分類 id（示範資料通常已足夠；不足時補建測試專用分類）。
 * 分類篩選的測試需要「至少兩個分類」才能證明篩選真的有作用。
 */
export async function distinctCategoryIds(n: number): Promise<string[]> {
  const existing = await prisma.category.findMany({
    orderBy: { sortOrder: 'asc' },
    take: n,
    select: { id: true },
  });
  const ids = existing.map((c) => c.id);

  for (let i = ids.length; i < n; i++) {
    const id = `${TEST_PREFIX}category-${i + 1}`;
    await prisma.category.create({
      data: {
        id,
        slug: id,
        label: `測試分類 ${i + 1}`,
        emoji: '🧪',
        description: '整合測試專用',
        color: '#000000',
        bgColor: '#ffffff',
      },
    });
    ids.push(id);
  }

  return ids;
}

export interface TestAuthor {
  id: string;
  email: string;
  password: string;
}

/** 建立一個 role='author' 的使用者（密碼固定，供 loginAs 取得 Cookie） */
export async function createAuthor(label: string): Promise<TestAuthor> {
  const email = `${TEST_PREFIX}${label}@example.com`;
  const password = 'Test1234';
  const user = await prisma.user.create({
    data: {
      id: nextId('user'),
      name: label,
      email,
      passwordHash: await hashPassword(password),
      role: 'author',
      penName: `筆名-${label}`,
      termsAcceptedAt: new Date(),
    },
  });
  return { id: user.id, email, password };
}

/** 建立一個 role='reader' 的使用者 */
export async function createReader(label: string): Promise<TestAuthor> {
  const email = `${TEST_PREFIX}${label}@example.com`;
  const password = 'Test1234';
  const user = await prisma.user.create({
    data: {
      id: nextId('user'),
      name: label,
      email,
      passwordHash: await hashPassword(password),
      role: 'reader',
      termsAcceptedAt: new Date(),
    },
  });
  return { id: user.id, email, password };
}

export interface TestNovel {
  novelId: string;
  volumeId: string;
  chapterId: string;
}

/**
 * 建立「作品 + 一卷 + 一章（含正文）」的完整前置資料。
 * 章節與作品的發佈狀態可分別指定，越權測試一律用 draft（草稿最敏感）。
 */
export async function createNovelWithChapter(opts: {
  authorId: string;
  novelStatus?: 'draft' | 'published';
  chapterStatus?: 'draft' | 'published';
  bodyMarkdown?: string;
}): Promise<TestNovel> {
  const categoryId = await anyCategoryId();
  const novelId = nextId('novel');
  const volumeId = nextId('volume');
  const chapterId = nextId('chapter');
  const body = opts.bodyMarkdown ?? '第一段正文。\n\n第二段正文。';

  await prisma.novel.create({
    data: {
      id: novelId,
      title: `測試作品 ${novelId}`,
      authorId: opts.authorId,
      coverColor: 'linear-gradient(135deg, #1a0533 0%, #4a1942 40%, #8b2fc9 100%)',
      categoryId,
      wordCount: 0,
      chapterCount: 0,
      rating: 0,
      excerpt: '整合測試用的作品簡介。',
      status: opts.novelStatus ?? 'draft',
    },
  });

  await prisma.volume.create({
    data: { id: volumeId, number: 1, title: '第一卷', novelId },
  });

  await prisma.chapter.create({
    data: {
      id: chapterId,
      novelId,
      volumeId,
      number: 1,
      title: '第一章',
      wordCount: body.replace(/\s/g, '').length,
      status: opts.chapterStatus ?? 'draft',
      publishedAt: opts.chapterStatus === 'published' ? new Date() : null,
      content: { create: { bodyMarkdown: body } },
    },
  });

  return { novelId, volumeId, chapterId };
}

/** 於既有作品下追加一章（排序測試用） */
export async function addChapter(opts: {
  novelId: string;
  volumeId: string;
  number: number;
  status?: 'draft' | 'published';
}): Promise<string> {
  const chapterId = nextId('chapter');
  await prisma.chapter.create({
    data: {
      id: chapterId,
      novelId: opts.novelId,
      volumeId: opts.volumeId,
      number: opts.number,
      title: `第 ${opts.number} 章`,
      wordCount: 10,
      status: opts.status ?? 'draft',
      publishedAt: opts.status === 'published' ? new Date() : null,
      content: { create: { bodyMarkdown: '一二三四五六七八九十' } },
    },
  });
  return chapterId;
}

/**
 * 建立一部「搜尋預算已就緒」的作品（US2 前置資料）。
 *
 * `searchText` 與 `updatedAt` **刻意由測試自己寫入**：搜尋的比對與排序要能對照，
 * 就得能指定確切的排序鍵；服務層一律賦值 `new Date()`，同一毫秒內建立的數筆
 * 會使「翻頁不重複不遺漏」的斷言變成擲骰子。
 * 「寫入路徑會不會維護這兩個欄位」是另一回事，由 `search-budget-sync.test.ts`
 * 走真正的服務層驗證。
 */
export async function createSearchNovel(opts: {
  authorId: string;
  title: string;
  categoryId: string;
  /** 標籤顯示名；會建立帶測試前綴的 Tag 並關聯 */
  tags?: string[];
  status?: 'draft' | 'published';
  updatedAt?: Date;
  /**
   * 指定作品識別碼（MUST 以 `TEST_PREFIX` 起頭才會被清理）。
   * 排序鍵平手時的決勝鍵是 `id`，而自動產生的序號在不同 collation 下的
   * 大小關係未必與建立順序一致 —— 需要斷言確切順序的測試 MUST 自行指定。
   */
  id?: string;
}): Promise<string> {
  const novelId = opts.id ?? nextId('novel');
  const [author, category] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: opts.authorId },
      select: { name: true, penName: true },
    }),
    prisma.category.findUniqueOrThrow({ where: { id: opts.categoryId }, select: { label: true } }),
  ]);

  const tagNames = opts.tags ?? [];
  const tagIds: string[] = [];
  for (const name of tagNames) {
    const tag = await prisma.tag.upsert({
      where: { name },
      update: {},
      create: { id: nextId('tag'), name, slug: nextId('tagslug') },
      select: { id: true },
    });
    tagIds.push(tag.id);
  }

  await prisma.novel.create({
    data: {
      id: novelId,
      title: opts.title,
      authorId: opts.authorId,
      coverColor: 'linear-gradient(135deg, #1a0533 0%, #4a1942 40%, #8b2fc9 100%)',
      categoryId: opts.categoryId,
      wordCount: 0,
      chapterCount: 0,
      rating: 0,
      excerpt: '整合測試用的作品簡介。',
      status: opts.status ?? 'published',
      updatedAt: opts.updatedAt ?? new Date(),
      searchText: buildSearchText({
        title: opts.title,
        author: author.penName ?? author.name,
        category: category.label,
        tags: tagNames,
      }),
      tags: { create: tagIds.map((tagId) => ({ tagId })) },
    },
  });

  return novelId;
}

/** 於既有作品下追加一卷 */
export async function addVolume(novelId: string, number: number): Promise<string> {
  const volumeId = nextId('volume');
  await prisma.volume.create({
    data: { id: volumeId, number, title: `第 ${number} 卷`, novelId },
  });
  return volumeId;
}

/**
 * 該作品當前的資料快照，供「DB 未變更」的斷言比對。
 * 涵蓋越權寫入可能碰到的每一張表。
 */
export async function snapshotNovel(novelId: string): Promise<string> {
  const novel = await prisma.novel.findUnique({
    where: { id: novelId },
    include: {
      volumes: { orderBy: { id: 'asc' } },
      chapters: { orderBy: { id: 'asc' }, include: { content: true } },
      tags: { orderBy: { tagId: 'asc' } },
    },
  });
  return JSON.stringify(novel);
}

/**
 * 刪除測試建立的全部資料列（章節與卷由 Novel 的級聯處理）。
 *
 * **不能只靠識別碼前綴**：受測的服務層（`novelService.createNovel`）自己產生 UUID，
 * 那些作品不帶前綴。少了「該測試作者名下的全部作品」這一條，它們會留在資料庫裡，
 * 一邊擋住 `User` 的刪除（`Novel.authorId` 為 Restrict），
 * 一邊污染 `seed-scale`／`derived-fields` 這類「示範資料共 13 部」的斷言 ——
 * 而且症狀會出現在別的測試檔上，查起來完全看不出跟這裡有關。
 */
export async function cleanupAuthoring(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { id: { startsWith: TEST_PREFIX } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);

  await prisma.novel.deleteMany({
    where: { OR: [{ id: { startsWith: TEST_PREFIX } }, { authorId: { in: userIds } }] },
  });
  await prisma.review.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.category.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
  // 標籤為全域共享實體，不隨作品級聯刪除；測試建立者一律帶前綴，僅刪這些
  await prisma.tag.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
}
