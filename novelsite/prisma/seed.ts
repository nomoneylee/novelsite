/**
 * 資料庫種子腳本（Seed）
 * ========================
 * 把 `src/lib/mockData.ts` 的初始資料匯入資料庫，並建立 reader / author / admin
 * 三個示範帳號（FR-019、FR-023、FR-038）。
 * 執行：`npm run db:seed`（會先清空再重建，可重複執行）。
 *
 * 寫入順序（FEAT-2 2-A 關聯化，research R-8）：
 *   User（含各作者的 penName）→ Category（含 slug）→ Tag → Novel（authorId/categoryId）
 *   → NovelTag / NovelRelation → Volume → Chapter
 *
 * **MUST NOT 寫入任何無原始紀錄支撐的統計**（FEAT-4 4-C / T111，FR-043a）：
 * `Novel` 的六個計數一律為 0，且不建立評論、按讚、留言、收藏、閱讀明細、
 * 每日統計與排行名次任何一列。
 *
 * 捏造的示範數字是本階段最貴的一種技術債 —— 它讓每一個統計功能**看起來已經做完了**：
 * 儀表板有曲線、排行榜有名次、作品頁有 1.2 萬次閱讀，全部都是常數，
 * 於是沒有人會發現彙總作業其實沒有接上。歸零的代價是示範環境變得很空，
 * 而那正是要的：**空狀態是真相，假數字不是**（FR-043b 的八個空狀態因此升格為主要路徑）。
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { prisma } from '../src/lib/db';
import { hashPassword } from '../src/lib/auth/password';
import {
  FEATURED_NOVELS,
  NEW_NOVELS,
  RANKING_ONLY_NOVELS,
  NOVEL_DETAILS,
  CATEGORIES,
} from '../src/lib/mockData';
import type { Novel, NovelDetail } from '../src/lib/types';
// 搜尋預算的唯一組裝實作（FEAT-3 FR-027／FR-028）。seed 少了這一步，
// 全新資料庫上的搜尋恆為空 —— 頁面看起來完全正常，只是永遠找不到任何東西。
import { buildSearchText } from '../src/lib/services/searchText';
import { assertSeedAllowed } from './seedGuard';

// FEAT-6 FR-066：放行守衛。**MUST 在 clearAll() 與任何 prisma 呼叫之前**——
// 本指令會先清空 23 張表，接上正式資料庫時誤跑一次即真實資料全滅且無復原路徑。
// 判定與訊息在 `./seedGuard`（零副作用，故可被單元測試單獨驗證，見該檔說明）。
assertSeedAllowed(process.env);

/** 全部示範作品（基本資料層），順序決定上架時間與 Tag 的建立順序 */
const ALL_NOVELS: Novel[] = [...FEATURED_NOVELS, ...NEW_NOVELS, ...RANKING_ONLY_NOVELS];

/** 版控的示範正文來源（contracts/seed-content §1）：`seed-data/<作品 id>/正文/第N章_標題.md` */
const SEED_DATA_DIR = path.join(__dirname, 'seed-data');
const CHAPTER_FILE_RE = /^第(\d+)章_(.+)\.md$/;

interface SeedChapterSource {
  number: number;
  title: string;
  bodyMarkdown: string;
}

/** 讀取單一作品的全部章節正文，依章號排序 */
function readSeedChapters(novelId: string): SeedChapterSource[] {
  const dir = path.join(SEED_DATA_DIR, novelId, '正文');
  return readdirSync(dir)
    .filter((file) => file.endsWith('.md'))
    .map((file) => {
      const matched = CHAPTER_FILE_RE.exec(file);
      if (!matched) throw new Error(`seed: 檔名不符 第N章_標題.md 慣例：${novelId}/${file}`);
      return {
        number: Number(matched[1]),
        title: matched[2],
        bodyMarkdown: readFileSync(path.join(dir, file), 'utf8'),
      };
    })
    .sort((a, b) => a.number - b.number);
}

/** 字數＝去除所有空白後的字元數（FR-011a） */
function countWords(bodyMarkdown: string): number {
  return bodyMarkdown.replace(/\s/g, '').length;
}

interface PlannedChapter {
  id: string;
  number: number;
  title: string;
  bodyMarkdown: string;
  publishedAt: Date;
}

interface PlannedVolume {
  id: string;
  number: number;
  title: string;
  chapters: PlannedChapter[];
}

/**
 * 卷結構（contracts/seed-content §3）：
 *  - `featured-1` 沿用 `mockData.ts` 既有 3 卷（連章號、章節 id 與發佈日一併沿用）。
 *  - 其餘 12 部各建 1 個單一預設卷（`number = 1`、`title = "正文"`）。
 */
function planVolumes(novel: Novel, novelPublishedAt: Date): PlannedVolume[] {
  const sources = readSeedChapters(novel.id);
  const sourceByNumber = new Map(sources.map((s) => [s.number, s]));
  const existingVolumes = NOVEL_DETAILS[novel.id]?.volumes ?? [];

  if (existingVolumes.length > 0) {
    return existingVolumes.map((vol) => ({
      id: vol.id,
      number: vol.number,
      title: vol.title,
      chapters: vol.chapters.map((ch) => {
        const source = sourceByNumber.get(ch.number);
        if (!source) throw new Error(`seed: ${novel.id} 缺少第 ${ch.number} 章的正文 .md`);
        return {
          id: ch.id,
          number: ch.number,
          title: source.title,
          bodyMarkdown: source.bodyMarkdown,
          publishedAt: new Date(ch.publishedAt),
        };
      }),
    }));
  }

  return [
    {
      id: `${novel.id}-vol-1`,
      number: 1,
      title: '正文',
      chapters: sources.map((source) => {
        // 無既有章節中繼資料者，發佈日自作品上架日起逐章遞延一天
        const publishedAt = new Date(novelPublishedAt);
        publishedAt.setUTCDate(publishedAt.getUTCDate() + (source.number - 1));
        return {
          id: `${novel.id}-ch-${source.number}`,
          number: source.number,
          title: source.title,
          bodyMarkdown: source.bodyMarkdown,
          publishedAt,
        };
      }),
    },
  ];
}

/**
 * 草稿章節（FR-012a、contracts/seed-content §5）：id MUST 固定為 `draft-1`。
 * 供「草稿對非擁有者回 404」驗收、2-C 的作者草稿列表非空，
 * 以及既有 `tests/a11y/pages.test.ts` 硬編此 id 存取 `/author/editor/[chapterId]`。
 * 正文內聯於此（不放 seed-data）—— 它不是示範正文，且 2-C 會刪除 mockData 的草稿來源。
 */
const DRAFT_CHAPTER = {
  id: 'draft-1',
  novelId: 'featured-1',
  volumeId: 'vol-3',
  number: 1248,
  title: '第 1248 章：破曉之刃',
  bodyMarkdown:
    '晨光尚未破曉，蕭塵已提劍立於崖邊。\n\n「這一劍，斬的不是敵人，而是過去的自己。」\n\n他深吸一口氣，劍鋒微顫，隨即化作一道流光，直劈而下……',
};

async function clearAll() {
  // 依外鍵關係由子到父刪除
  await prisma.rankingEntry.deleteMany();
  // FEAT-4：互動、讀者狀態與統計七張表。**MUST 逐一指名**，不倚賴級聯 ——
  // `ChapterView.userId` 與 `BookshelfEvent.userId` 刻意不設 FK（明細於保留期內
  // 獨立於帳號存在），級聯帶不走它們；而 seed 後「全部為空」正是 T092 的斷言。
  await prisma.chapterView.deleteMany();
  await prisma.novelDailyStat.deleteMany();
  await prisma.bookshelfEvent.deleteMany();
  await prisma.bookshelf.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.reviewLike.deleteMany();
  await prisma.review.deleteMany();
  await prisma.chapterContent.deleteMany();
  await prisma.chapter.deleteMany();
  await prisma.volume.deleteMany();
  await prisma.novelTag.deleteMany();
  await prisma.novelRelation.deleteMany();
  await prisma.novel.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.category.deleteMany();
  await prisma.session.deleteMany();
  // Novel.authorId 參照 User，MUST 在 Novel 之後才刪
  await prisma.user.deleteMany();
}

interface DemoAccount {
  role: 'reader' | 'author' | 'admin';
  name: string;
  email: string;
  avatarColor: string;
}

const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    role: 'reader',
    name: '讀墨旅人',
    email: 'reader@novelsite.tw',
    avatarColor: 'linear-gradient(135deg, #d97706 0%, #92400e 100%)',
  },
  {
    role: 'author',
    name: '墨染千秋',
    email: 'author@novelsite.tw',
    avatarColor: 'linear-gradient(135deg, #7c3aed 0%, #4c1d95 100%)',
  },
  {
    role: 'admin',
    name: '站務管理員',
    email: 'admin@novelsite.tw',
    avatarColor: 'linear-gradient(135deg, #0f766e 0%, #134e4a 100%)',
  },
];

/** 未設定 SEED_USER_PASSWORD 時，各帳號各自產生的隨機密碼（FR-023） */
function randomPassword(): string {
  return randomBytes(9).toString('base64url');
}

interface SeededUsers {
  /** 作者字串 → userId，供 Novel.authorId 使用 */
  authorIdByPenName: Map<string, string>;
}

/**
 * 建立三個示範登入帳號、各示範作品作者對應的內容作者 User（`penName` = 原作者字串），
 * 以及各評論者對應的讀者 User。內容作者與評論者皆非登入帳號，密碼隨機且不外印。
 *
 * 內容作者的 id 固定為 `content-author-N`（非 cuid）。原因原本是作者後台需要一個具體的
 * `authorId`（FEAT-2 的 `src/lib/demoAuthor.ts`，**已於 FEAT-3 T093 隨真實 session 綁定刪除**）；
 * 現在保留固定 id 的理由只剩**示範資料的可預測性** —— 整合測試與內容檢查會直接引用
 * `content-author-1` 這類識別碼，隨機 id 會讓每次 seed 之後的斷言都得先查一次。
 */
/**
 * 「作者字串 → 作者簡介」對照（FEAT-3 FR-025 的重建來源）。
 *
 * 示範資料的簡介原本掛在每一部作品上（`NovelDetail.authorBio`），
 * 但同一位作者可能有多部作品；此處取該作者第一部有填簡介的作品，
 * 其餘忽略 —— 簡介是作者的屬性，不是作品的屬性，這正是本階段搬家的理由。
 */
function collectAuthorBios(): Map<string, string> {
  const bios = new Map<string, string>();
  for (const novel of ALL_NOVELS) {
    if (bios.has(novel.author)) continue;
    const bio = NOVEL_DETAILS[novel.id]?.authorBio;
    if (bio) bios.set(novel.author, bio);
  }
  return bios;
}

async function seedUsers(): Promise<SeededUsers> {
  const fixedPassword = process.env.SEED_USER_PASSWORD;
  const now = new Date();

  for (const account of DEMO_ACCOUNTS) {
    const plainPassword =
      fixedPassword && fixedPassword.length > 0 ? fixedPassword : randomPassword();
    const passwordHash = await hashPassword(plainPassword);

    await prisma.user.create({
      data: {
        name: account.name,
        email: account.email,
        passwordHash,
        avatarColor: account.avatarColor,
        role: account.role,
        termsAcceptedAt: now,
      },
    });

    if (!fixedPassword) {
      console.log(`   ${account.role} 帳號（${account.email}）密碼：${plainPassword}`);
    }
  }

  // 內容作者與評論者共用一組隨機密碼雜湊：非登入用途，逐一雜湊只是徒增 seed 時間
  const contentUserHash = await hashPassword(randomPassword());

  const penNames = [...new Set(ALL_NOVELS.map((n) => n.author))];
  const authorIdByPenName = new Map<string, string>();
  const bioByPenName = collectAuthorBios();

  for (let i = 0; i < penNames.length; i++) {
    const penName = penNames[i];
    const id = `content-author-${i + 1}`;
    await prisma.user.create({
      data: {
        id,
        name: penName,
        penName,
        email: `${id}@novelsite.tw`,
        passwordHash: contentUserHash,
        // 作者簡介的單一真相來源（FEAT-3 FR-025）；原存於 Novel.authorBio，
        // 該欄位已隨 3b_authoring migration 移除，內容由本處重建
        bio: bioByPenName.get(penName) ?? '',
        role: 'author',
        termsAcceptedAt: now,
      },
    });
    authorIdByPenName.set(penName, id);
  }

  // 註（FEAT-4 4-B / T082）：原本在此建立的「示範評論者」帳號已一併移除。
  // 示範評論本身是造假來源（FR-043a）—— 那些讚數與評分沒有任何使用者動作產生它，
  // 卻會被算進作品的平均分。評論者帳號沒有評論可綁，留著就是一批空帳號。

  return { authorIdByPenName };
}

/** 建立分類（`slug` 沿用 mockData 的 id），回傳「label → categoryId」對照 */
async function seedCategories(): Promise<Map<string, string>> {
  const categoryIdByLabel = new Map<string, string>();

  for (let i = 0; i < CATEGORIES.length; i++) {
    const c = CATEGORIES[i];
    await prisma.category.create({ data: { ...c, slug: c.id, sortOrder: i } });
    categoryIdByLabel.set(c.label, c.id);
  }

  return categoryIdByLabel;
}

/** 建立全域共享的標籤，回傳「標籤名 → tagId」對照 */
async function seedTags(): Promise<Map<string, string>> {
  const names = [...new Set(ALL_NOVELS.flatMap((n) => n.tags ?? []))];
  const tagIdByName = new Map<string, string>();

  for (let i = 0; i < names.length; i++) {
    // 標籤名為中文，無法轉出可讀 slug，故以穩定序號產生（同名共用一列由 name @unique 保證）
    const id = `tag-${i + 1}`;
    await prisma.tag.create({ data: { id, name: names[i], slug: id } });
    tagIdByName.set(names[i], id);
  }

  return tagIdByName;
}

/**
 * 合併「基本作品」與「詳情作品」欄位，供寫入 Novel 表。
 *
 * **六個統計計數一律為 0**（FEAT-4 4-C / T111，FR-043a）：`mockData` 的
 * `rating`／`weeklyViews`／`totalViews`／`favoriteCount`／`commentCount` 是版面設計時期的
 * 展示值，沒有任何原始紀錄可以反推（SC-006）。`ratingCount` 亦然（欄位預設即 0）。
 *
 * `wordCount`／`chapterCount` **不歸零**：那兩個有實際正文支撐，由章節寫入回填（FR-011a）。
 */
function novelWriteData(
  novel: Novel,
  detail: NovelDetail | undefined,
  authorId: string,
  categoryId: string,
  publishedAt: Date
) {
  return {
    id: novel.id,
    title: novel.title,
    authorId,
    cover: novel.cover ?? null,
    coverColor: novel.coverColor,
    categoryId,
    // 兩者於章節寫入後由實際正文回填（FR-011a），此處僅為建立時的佔位值
    wordCount: 0,
    chapterCount: 0,
    rating: 0,
    ratingCount: 0,
    excerpt: novel.excerpt,
    isFeatured: novel.isFeatured ?? false,
    weeklyViews: 0,
    updateFreq: novel.updateFreq ?? null,
    description: detail?.description ?? '',
    // status = 發佈狀態；serialStatus = 連載狀態（領域 NovelDetail.status 取自後者）
    status: 'published',
    serialStatus: detail?.status ?? 'ongoing',
    // authorBio 已自 Novel 移除；作者簡介改寫入 User.bio（見 collectAuthorBios，FR-025）
    totalViews: 0,
    favoriteCount: 0,
    commentCount: 0,
    publishedAt,
    // 搜尋預算（FEAT-3 FR-028）：作者顯示名取示範資料的作者字串（= 該作者 User 的 penName）
    searchText: buildSearchText({
      title: novel.title,
      author: novel.author,
      category: novel.category,
      tags: novel.tags ?? [],
    }),
    // 排序鍵**明確設為上架時間**，不留給資料庫預設（research R-4）——
    // 兩軌 seed 發生在不同時刻，用 now() 會讓兩軌的排序 tie 分布不同，
    // SC-005 的「兩軌結果完全一致」就變成靠時序巧合
    updatedAt: publishedAt,
  };
}

async function seedNovels(
  authorIdByPenName: Map<string, string>,
  categoryIdByLabel: Map<string, string>,
  tagIdByName: Map<string, string>
) {
  // 上架時間：新書較新，其餘依序往前推。
  //
  // **基準日 MUST 相對於執行當下，MUST NOT 寫死日期**（2026-08-14 修正）：
  // 「新書」是由 `publishedAt` 落在近 30 天推導的（`repositories/mappers.ts:36`），
  // 而本迴圈把最舊的一部新書排在 `baseDate - 8 天`，故寫死日期等於替這批示範資料
  // 設下 **22 天的保鮮期**——過期後 `getNewNovels()` 少了兩部，
  // `tests/integration/derived-fields.test.ts` 轉紅，而**錯的是資料不是推導邏輯**。
  // 原文寫死 `2026-07-21`，在 2026-08-14（第 24 天）如期爆掉一次。
  //
  // 取當日 **UTC 午夜**而非 `new Date()`：非新書那批最年輕的一部是 `baseDate - 30 天`，
  // 基準日若取執行當下的時刻，它的年齡會**恰好等於** 30 天門檻，
  // 而判定是 `>=`，那一部會被判成新書。取午夜讓實際查詢時間比它晚數小時，邊界有餘裕。
  const baseDate = new Date(new Date().setUTCHours(0, 0, 0, 0));

  for (let i = 0; i < ALL_NOVELS.length; i++) {
    const novel = ALL_NOVELS[i];
    const detail = NOVEL_DETAILS[novel.id];

    const authorId = authorIdByPenName.get(novel.author);
    if (!authorId) throw new Error(`seed: 找不到作者 ${novel.author} 對應的 User`);
    const categoryId = categoryIdByLabel.get(novel.category);
    if (!categoryId) throw new Error(`seed: 找不到分類 ${novel.category} 對應的 Category`);

    const publishedAt = new Date(baseDate);
    // 新書排在最前面（最近上架），其餘往回排
    publishedAt.setUTCDate(publishedAt.getUTCDate() - (novel.isNew ? i : i + 30));

    await prisma.novel.create({
      data: novelWriteData(novel, detail, authorId, categoryId, publishedAt),
    });

    // 標籤關聯
    for (const tagName of novel.tags ?? []) {
      const tagId = tagIdByName.get(tagName);
      if (!tagId) throw new Error(`seed: 找不到標籤 ${tagName} 對應的 Tag`);
      await prisma.novelTag.create({ data: { novelId: novel.id, tagId } });
    }

    // 寫入分捲、章節與正文（正文一律來自 prisma/seed-data 的 .md）
    let publishedWordCount = 0;
    let publishedChapterCount = 0;

    for (const vol of planVolumes(novel, publishedAt)) {
      await prisma.volume.create({
        data: { id: vol.id, number: vol.number, title: vol.title, novelId: novel.id },
      });

      for (const ch of vol.chapters) {
        const wordCount = countWords(ch.bodyMarkdown);
        await prisma.chapter.create({
          data: {
            id: ch.id,
            novelId: novel.id,
            volumeId: vol.id,
            number: ch.number,
            title: ch.title,
            wordCount,
            status: 'published',
            publishedAt: ch.publishedAt,
            content: { create: { bodyMarkdown: ch.bodyMarkdown, format: 'markdown' } },
          },
        });
        publishedWordCount += wordCount;
        publishedChapterCount++;
      }
    }

    // 草稿章節（FR-012a）：不計入對外的字數／章節數
    if (novel.id === DRAFT_CHAPTER.novelId) {
      await prisma.chapter.create({
        data: {
          id: DRAFT_CHAPTER.id,
          novelId: DRAFT_CHAPTER.novelId,
          volumeId: DRAFT_CHAPTER.volumeId,
          number: DRAFT_CHAPTER.number,
          title: DRAFT_CHAPTER.title,
          wordCount: countWords(DRAFT_CHAPTER.bodyMarkdown),
          status: 'draft',
          publishedAt: null,
          content: { create: { bodyMarkdown: DRAFT_CHAPTER.bodyMarkdown, format: 'markdown' } },
        },
      });
    }

    // 字數回填（FR-011a）：以實際已發佈章節為準，不沿用 mockData 的展示值
    await prisma.novel.update({
      where: { id: novel.id },
      data: { wordCount: publishedWordCount, chapterCount: publishedChapterCount },
    });
  }

  // 相關作品關聯：MUST 待全部 Novel 建立後才寫入（兩端皆為外鍵）
  for (const novel of ALL_NOVELS) {
    const relatedIds = NOVEL_DETAILS[novel.id]?.relatedIds ?? [];
    for (let order = 0; order < relatedIds.length; order++) {
      await prisma.novelRelation.create({
        data: { novelId: novel.id, relatedNovelId: relatedIds[order], sortOrder: order },
      });
    }
  }
}

// 註（FEAT-4 4-C / T111）：原本的 `seedRankings()` 已刪除。
// 它把 `mockData` 的三組手寫名次（每期 10 筆）寫進 `RankingEntry`，
// 而名次的唯一合法來源是排行重算作業依統計計分產生的結果（FR-044、FR-043a）。
// 留著它，排行榜頁在示範環境會顯示一份**與任何統計無關**的榜單 ——
// 那正是「看起來已經做完了」的樣子。示範環境的排行榜自此為空榜（FR-047 的空狀態）。

async function main() {
  console.log('🌱 開始 seed…');
  await clearAll();
  const { authorIdByPenName } = await seedUsers();
  const categoryIdByLabel = await seedCategories();
  const tagIdByName = await seedTags();
  await seedNovels(authorIdByPenName, categoryIdByLabel, tagIdByName);
  console.log('✅ Seed 完成');
}

main()
  .catch((e) => {
    console.error('❌ Seed 失敗：', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
