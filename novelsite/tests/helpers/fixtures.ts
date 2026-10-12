/**
 * 經資料存取層，僅整合測試可引用（見 contracts/internal-modules.md）。
 * repositories/* 帶 import 'server-only'，僅整合設定檔補得起 react-server 解析條件。
 */
import {
  usersRepo,
  getCategories,
  createNovelRow,
  createVolumeRow,
  createChapterRow,
  saveChapterDraftRow,
  setChapterStatusRow,
  setNovelStatusOwned,
  deleteNovelOwned,
  refreshNovelCounters,
} from '@/lib/repositories';
import { hashPassword } from '@/lib/auth/password';
import type { Role } from '@/lib/auth/sessionToken';
import type { User } from '@/generated/prisma/client';

export async function createUser(opts: {
  email: string;
  role: Role;
  password?: string;
}): Promise<User> {
  const password = opts.password ?? 'Test1234';
  const passwordHash = await hashPassword(password);

  return usersRepo.create({
    name: opts.email.split('@')[0],
    email: opts.email,
    passwordHash,
    role: opts.role,
    termsAcceptedAt: new Date(),
  });
}

// ─────────────────────────────────────────────────────────────
// FEAT-4 共用 fixture（T008）
//
// US1～US4 的整合測試反覆需要同一組前置資料：一個讀者帳號、一個與它不同的
// 第二位使用者（越權與跨帳號隔離的測試至少要兩個身分才成立）、
// 以及一部「已發佈且有多章節」的作品（進度、歷史、留言、閱讀明細都掛在章節上）。
// 四刀各自拼一份的必然結果是漂移，故在此一次備齊。
//
// **清理**：本檔一律走資料存取層，而該層沒有（也不該有）無擁有者條件的刪除。
// 清理方式為「先 `deleteNovelOwned(authorId, novelId)` 刪作品（卷／章節／正文由級聯處理），
// 再呼叫 `resetAuthTables()`」—— 後者只刪不擁有作品也沒有評論的使用者，
// 作品還在時作者刪不掉（`Novel.authorId` 為 Restrict），順序反了會靜默留下一批殘留使用者。
// ─────────────────────────────────────────────────────────────

/** 本節建立的資料列共用的識別碼前綴，供測試辨識與批次清理 */
export const FEAT4_PREFIX = 'feat4-';

/** 全部 fixture 帳號的固定密碼（`loginAs` 取 Cookie 用） */
export const FIXTURE_PASSWORD = 'Test1234';

let seq = 0;
function nextId(kind: string): string {
  seq += 1;
  return `${FEAT4_PREFIX}${kind}-${Date.now().toString(36)}-${seq}`;
}

export interface TestAccount {
  id: string;
  email: string;
  password: string;
}

/**
 * 建立一個測試帳號。
 *
 * 「讀者帳號」與「第二位使用者」是**同一條路徑的兩次呼叫**：`label` 不同即為不同帳號
 * （email 與識別碼皆帶 label），故不另開一支只差在名字的函式。
 * 第二位使用者需要別的角色時（例如作品的擁有者）由 `role` 指定。
 */
export async function createAccount(label: string, role: Role = 'reader'): Promise<TestAccount> {
  const email = `${FEAT4_PREFIX}${label}@example.com`;
  const user = await usersRepo.create({
    name: label,
    email,
    passwordHash: await hashPassword(FIXTURE_PASSWORD),
    role,
    termsAcceptedAt: new Date(),
  });
  return { id: user.id, email, password: FIXTURE_PASSWORD };
}

/**
 * 清理本檔建立的作品（卷／章節／正文／評論／留言由級聯處理）。
 *
 * **逐一容錯**是這支函式存在的唯一理由：`beforeAll` 只要在中途失敗
 * （例如所測的端點尚未實作），已建立的作品就會留在共用的測試資料庫裡，
 * 而下一個檔案的 `seed-scale.test.ts` 斷言的正是「示範資料恰為 13 部作品」——
 * 於是一個未完成的功能會讓一個與它無關的檔案跟著紅，而紅的原因看不出跟它有關。
 * 中途擲出的清理等於沒有清理，故每一部各自 try，失敗只記錄不中斷。
 */
export async function cleanupNovels(
  novels: { authorId: string; novelId: string }[]
): Promise<void> {
  for (const { authorId, novelId } of novels) {
    try {
      await deleteNovelOwned(authorId, novelId);
    } catch (err) {
      console.error(`[fixtures] 清理作品 ${novelId} 失敗，續清其餘`, err);
    }
  }
}

export interface TestPublishedNovel {
  novelId: string;
  volumeId: string;
  /** 章節識別碼，依章節編號由小到大 */
  chapterIds: string[];
}

/**
 * 建立「已發佈作品 ＋ 一卷 ＋ N 個已發佈章節（含正文）」。
 *
 * 章節預設 3 章：**單章看不出來的東西正是這裡要測的** —— 續讀要指得出「讀到第幾章」、
 * 閱讀歷史的上限淘汰要能區分不同章節、去重窗口要能證明換一章會另計一次。
 */
export async function createPublishedNovel(opts: {
  authorId: string;
  chapterCount?: number;
  title?: string;
}): Promise<TestPublishedNovel> {
  const chapterCount = opts.chapterCount ?? 3;
  const categories = await getCategories();
  if (categories.length === 0) {
    throw new Error(
      'createPublishedNovel: 資料庫中沒有任何分類。整合測試的 globalSetup 會先跑 db:seed，' +
        '看到這個錯誤表示測試繞過了 globalSetup（或 seed 失敗）。'
    );
  }

  const novelId = nextId('novel');
  await createNovelRow({
    id: novelId,
    title: opts.title ?? `FEAT-4 測試作品 ${novelId}`,
    authorId: opts.authorId,
    categoryId: categories[0].id,
    excerpt: 'FEAT-4 整合測試用的作品簡介。',
    coverColor: 'linear-gradient(135deg, #1a0533 0%, #4a1942 40%, #8b2fc9 100%)',
  });

  const volumeId = await createVolumeRow(novelId, '第一卷');

  const chapterIds: string[] = [];
  for (let i = 1; i <= chapterCount; i++) {
    const { chapterId, number } = await createChapterRow(novelId, volumeId);
    const body = `第 ${number} 章的第一段正文。\n\n第 ${number} 章的第二段正文。`;
    await saveChapterDraftRow(chapterId, {
      title: `第 ${number} 章`,
      bodyMarkdown: body,
      wordCount: body.replace(/\s/g, '').length,
    });
    await setChapterStatusRow(chapterId, 'published');
    chapterIds.push(chapterId);
  }

  // 章節寫入 MUST 連帶回填 `Novel.chapterCount`／`wordCount`（FR-011、data-model.md §4.1）——
  // 服務層的每一條章節路徑都這麼做，本 fixture 直接呼叫 repository 故需自行補上。
  // 少了這一步，「有 N 章的已發佈作品」在計數欄位上是 0，而任何以**增量**斷言回填的測試
  // （T115 的 `chapterCount + 2`）都會紅在 fixture 的謊上，而不是紅在被測程式碼上。
  await refreshNovelCounters(novelId);

  // `createNovelRow` 的狀態固定為 draft（那是作者寫入流的正確預設）；
  // 讀者向的測試需要一部**讀者看得到**的作品，故在此上架。
  await setNovelStatusOwned(opts.authorId, novelId, 'published');

  return { novelId, volumeId, chapterIds };
}
