/**
 * 清除內容資料（FEAT-6 T009／T010，FR-067、FR-068、FR-068a）
 * ===========================================================
 * 把 23 張表裡的 **21 張內容資料表**清空，**保留 `Category` 與 `Tag` 兩張站方參考資料**。
 * 執行：`npm run db:clear-content`（**只能互動執行**，見下）。
 *
 * 三個 MUST：
 *
 * 1. **先數再說**：動手之前把 23 張表的列數印出來，這是操作者發現「這台不是我以為的那台」
 *    的唯一機會。只有確認字串而沒有列數，等於在對一個看不見的東西打字。
 * 2. **非互動一律拒絕**：`process.stdin.isTTY !== true` 即中止。本指令**不應有任何自動化用途**，
 *    因此 MUST NOT 提供任何略過確認的旗標或參數（FR-068a 明文禁止）。
 * 3. **單一交易**：中途失敗留下的是半清空的資料庫——作品沒了但通知還在、書架指向不存在的作品。
 *    半清空比沒清空更難收拾，而且沒有任何錯誤訊息會說明現在是哪一半。
 *
 * 本檔沿用 `prisma/seed.ts` 的既有先例，直接 import `src/lib/db` 的 prisma，不經 `repositories/`。
 * 該偏離已記入 plan.md 的 Complexity Tracking（為 21 張表各開一支「刪光」的 repository 函式，
 * 等於在應用層開出 21 個新的無條件刪除入口，以擴大攻擊面換取形式上的合規）。
 */
import 'dotenv/config';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import type { PrismaClient } from '../src/generated/prisma/client';
import { prisma } from '../src/lib/db';
import { redactDatabaseUrl } from '../prisma/seedGuard';

/**
 * 內容資料 21 張，**依刪除順序（子 → 父）排列**（data-model.md §1.1）。
 * 順序反了會撞外鍵。`PasswordResetToken` 雖然以 `onDelete: Cascade` 掛在 `User` 上、
 * 刪 `User` 時本來就會被帶走，仍**顯式列出**：顯式刪除與級聯重複無害，
 * 且不依賴級聯設定日後不被改動。
 */
export const CONTENT_TABLES = [
  'RankingEntry',
  'NovelDailyStat',
  'ChapterView',
  'ReadingHistory',
  'ReadingProgress',
  'ReaderPreference',
  'BookshelfEvent',
  'Bookshelf',
  'Notification',
  'Comment',
  'ReviewLike',
  'Review',
  'ChapterContent',
  'Chapter',
  'Volume',
  'NovelTag',
  'NovelRelation',
  'Novel',
  'PasswordResetToken',
  'Session',
  'User',
] as const;

/**
 * 站方參考資料 2 張，**MUST NOT 被清除**（FR-068）：
 * `Category` 是站台本來就該有的 6 筆（由 migration 建立），`Tag` 是站方詞彙表——
 * 作品沒了，詞彙表仍然成立。兩張**列入前後報表**，它們的列數在前後必須相同，
 * 這是「清除範圍正確」的正向證明，不是附帶資訊。
 */
export const REFERENCE_TABLES = ['Category', 'Tag'] as const;

type ContentTable = (typeof CONTENT_TABLES)[number];
type ReferenceTable = (typeof REFERENCE_TABLES)[number];
type TableName = ContentTable | ReferenceTable;

/**
 * 23 張表的計數器。型別為 `Record<TableName, …>`，故上面兩張清單增刪時
 * **漏掉一張會是編譯錯誤**，不是報表上一個看不見的空缺。
 */
function counters(client: PrismaClient): Record<TableName, () => Promise<number>> {
  return {
    RankingEntry: () => client.rankingEntry.count(),
    NovelDailyStat: () => client.novelDailyStat.count(),
    ChapterView: () => client.chapterView.count(),
    ReadingHistory: () => client.readingHistory.count(),
    ReadingProgress: () => client.readingProgress.count(),
    ReaderPreference: () => client.readerPreference.count(),
    BookshelfEvent: () => client.bookshelfEvent.count(),
    Bookshelf: () => client.bookshelf.count(),
    Notification: () => client.notification.count(),
    Comment: () => client.comment.count(),
    ReviewLike: () => client.reviewLike.count(),
    Review: () => client.review.count(),
    ChapterContent: () => client.chapterContent.count(),
    Chapter: () => client.chapter.count(),
    Volume: () => client.volume.count(),
    NovelTag: () => client.novelTag.count(),
    NovelRelation: () => client.novelRelation.count(),
    Novel: () => client.novel.count(),
    PasswordResetToken: () => client.passwordResetToken.count(),
    Session: () => client.session.count(),
    User: () => client.user.count(),
    Category: () => client.category.count(),
    Tag: () => client.tag.count(),
  };
}

/** 對 23 張表計數，供前後報表比對（contracts/internal-modules.md §7） */
export async function countAllTables(client: PrismaClient): Promise<Record<string, number>> {
  const counter = counters(client);
  const result: Record<string, number> = {};
  for (const table of [...CONTENT_TABLES, ...REFERENCE_TABLES]) {
    result[table] = await counter[table]();
  }
  return result;
}

/**
 * 清除 21 張內容資料表（不含 `Category`／`Tag`）。**單一交易，全成功或全不做。**
 *
 * 互動確認與 TTY 判定 MUST 留在 CLI 層、不進本函式——
 * `tests/integration/empty-database.test.ts` 要用它建立空庫，
 * 把互動放進來，測試就得去騙 stdin（contracts/internal-modules.md §7）。
 */
export async function clearContentTables(client: PrismaClient): Promise<void> {
  await client.$transaction([
    client.rankingEntry.deleteMany(),
    client.novelDailyStat.deleteMany(),
    client.chapterView.deleteMany(),
    client.readingHistory.deleteMany(),
    client.readingProgress.deleteMany(),
    client.readerPreference.deleteMany(),
    client.bookshelfEvent.deleteMany(),
    client.bookshelf.deleteMany(),
    client.notification.deleteMany(),
    client.comment.deleteMany(),
    client.reviewLike.deleteMany(),
    client.review.deleteMany(),
    client.chapterContent.deleteMany(),
    client.chapter.deleteMany(),
    client.volume.deleteMany(),
    client.novelTag.deleteMany(),
    client.novelRelation.deleteMany(),
    client.novel.deleteMany(),
    client.passwordResetToken.deleteMany(),
    client.session.deleteMany(),
    client.user.deleteMany(),
  ]);
}

// ─────────────────────────── 以下為 CLI 外殼（T010） ───────────────────────────

/** 自連線字串解析目標資料庫名稱：PostgreSQL 取 pathname，SQLite 取檔名 */
function databaseNameFrom(url: string | undefined): string {
  if (!url) return '';
  if (url.startsWith('file:')) return path.basename(url.slice('file:'.length));
  try {
    return new URL(url).pathname.replace(/^\//, '');
  } catch {
    return '';
  }
}

/** 報表：清除類與保留類**分區顯示**，零列的表照列（FR-068a、契約 cli-commands §2.3） */
function printReport(counts: Record<string, number>, title: string): void {
  const pad = (name: string) => name.padEnd(22, ' ');
  console.log(`\n${title}`);
  console.log('\n  內容資料（將被清除）');
  for (const table of CONTENT_TABLES) {
    console.log(`    ${pad(table)}${String(counts[table]).padStart(8, ' ')}`);
  }
  console.log('\n  站方參考資料（不會被清除）');
  for (const table of REFERENCE_TABLES) {
    console.log(`    ${pad(table)}${String(counts[table]).padStart(8, ' ')}`);
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const provider = process.env.DATABASE_PROVIDER ?? 'sqlite';
  const databaseName = databaseNameFrom(databaseUrl);

  console.log(`目標資料庫：${databaseName || '(無法自連線字串解析)'}（provider: ${provider}）`);
  // 密碼 MUST 以 *** 遮蔽，MUST NOT 出現在任何輸出
  console.log(`連線：${redactDatabaseUrl(databaseUrl)}`);

  printReport(await countAllTables(prisma), '目前列數：');

  // 非互動環境一律拒絕（FR-068a）。**MUST 在提示之前**——先問再拒絕的話，
  // 自動化流程會在管線裡留下一個看起來只是「輸入不符」的失敗。
  if (process.stdin.isTTY !== true) {
    console.error(
      '\n❌ 偵測到非互動環境，本指令一律拒絕執行（資料庫未變動）。\n' +
        '   本指令不應有任何自動化用途：它會清空 21 張內容資料表，而那沒有復原路徑。'
    );
    process.exitCode = 1;
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('\n輸入目標資料庫名稱以確認清除（輸入其他任何值即中止）：');
  rl.close();

  // 完全相符才通過：資料庫名稱是使用者要打對的東西，「差不多對」在這裡沒有意義。
  // 僅去除前後空白（貼上時常帶入），不忽略大小寫、不做其他寬容處理。
  if (answer.trim() !== databaseName || databaseName === '') {
    console.error('\n❌ 輸入不符，已中止，資料庫未變動。');
    process.exitCode = 1;
    return;
  }

  await clearContentTables(prisma);
  printReport(await countAllTables(prisma), '✅ 已清除。目前列數：');
}

/**
 * CLI 進入點：MUST 只在被直接執行時跑。
 * `tests/integration/empty-database.test.ts` 會 import 本檔取用 `clearContentTables()`，
 * 那時 MUST NOT 進入互動流程。判定用 `process.argv[1]` 而非 `require.main === module`——
 * Vitest 以 ESM 轉譯載入本檔，該環境沒有 `require`／`module`，存取即 ReferenceError。
 */
if (/clear-content\.ts$/.test(process.argv[1] ?? '')) {
  main()
    .catch((error) => {
      console.error('❌ 清除失敗：', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
