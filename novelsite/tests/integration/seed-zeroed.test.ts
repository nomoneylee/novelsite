import { describe, it, expect, beforeAll } from 'vitest';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { prisma } from '@/lib/db';

/**
 * T092：示範資料不含任何無明細支撐的統計（FR-043a、SC-017 的 US3 可驗部分）
 * =========================================================================
 * 捏造的示範數字是本階段最貴的一種技術債：它讓每一個統計功能**看起來已經做完了**。
 * 儀表板有曲線、排行榜有名次、作品頁有 1.2 萬次閱讀 —— 全部都是常數。
 * 於是沒有人會發現彙總作業其實沒有接上，直到某天有人問「這個數字是怎麼算的」。
 *
 * 歸零的代價是示範環境變得很空，而那正是要的：**空狀態是真相，假數字不是**。
 * FR-043b 的八個位置因此必須各自有可理解的空狀態（其驗收見 a11y 套件與 T093）。
 *
 * **本檔自行重跑一次 seed**，不倚賴 globalSetup 當初那一次：整合測試檔循序執行，
 * 在本檔之前跑過的檔案會建立收藏、留言與閱讀明細，其中任何一個檔案的清理若有疏漏，
 * 本檔就會紅在別人的殘留上，而紅的原因看不出跟 seed 有關。
 *
 * **`Notification` 的斷言於 4-D 補上（T117a，2026-08-08）**：該 model 於
 * `4d_ranking_scheduling` 才建表，在 T092 當下 Prisma Client 沒有對應的委派，
 * 寫上去會讓整支測試**無法執行**（而不是失敗於斷言）。建表之後該限制解除，
 * SC-017 的「示範資料不含任何無明細支撐的統計」至此始能完整成立 ——
 * 通知是唯一由排程作業產生、且會主動打擾使用者的資料，
 * 示範資料裡若有幾則捏造的追更通知，看起來就像排程作業已經在跑了。
 * `RankingEntry` 早已可斷言 —— model 早已存在，且 T111 於 4-C 即停止寫入名次。
 */

const ROOT = path.resolve(__dirname, '../..');
const isWin = process.platform === 'win32';

function runSeed(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['run', 'db:seed'], {
      cwd: ROOT,
      env: process.env,
      stdio: 'inherit',
      shell: isWin,
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`[seed-zeroed] npm run db:seed 結束代碼 ${code}`));
    });
  });
}

beforeAll(async () => {
  // 先釋放本行程的連線再重跑 seed —— SQLite 軌上，持有中的連線會讓 seed 的整批刪除變慢甚至卡住
  await prisma.$disconnect();
  await runSeed();
}, 300_000);

describe('T092-1：示範作品的六個計數全為 0', () => {
  it('seed 後確實有示範作品（否則「全為 0」只是因為一部都沒有）', async () => {
    expect(await prisma.novel.count()).toBeGreaterThan(0);
  });

  it('rating／ratingCount／totalViews／weeklyViews／favoriteCount／commentCount 逐部皆為 0', async () => {
    const novels = await prisma.novel.findMany({
      select: {
        id: true,
        title: true,
        rating: true,
        ratingCount: true,
        totalViews: true,
        weeklyViews: true,
        favoriteCount: true,
        commentCount: true,
      },
    });

    const offenders = novels.filter(
      (n) =>
        n.rating !== 0 ||
        n.ratingCount !== 0 ||
        n.totalViews !== 0 ||
        n.weeklyViews !== 0 ||
        n.favoriteCount !== 0 ||
        n.commentCount !== 0
    );

    // 逐部列出違規者：只斷言「數量為 0」時，紅燈訊息不會說出是哪一部、哪一欄
    expect(offenders).toEqual([]);
  });
});

describe('T092-2：互動與統計資料表皆為空', () => {
  it('Review 為空（示範評論已刪除，FR-043a）', async () => {
    expect(await prisma.review.count()).toBe(0);
  });

  it('ReviewLike 為空', async () => {
    expect(await prisma.reviewLike.count()).toBe(0);
  });

  it('Comment 為空', async () => {
    expect(await prisma.comment.count()).toBe(0);
  });

  it('Bookshelf 與 BookshelfEvent 皆為空', async () => {
    expect(await prisma.bookshelf.count()).toBe(0);
    expect(await prisma.bookshelfEvent.count()).toBe(0);
  });

  it('ChapterView 為空（無閱讀明細，故任何曝光數字都無來源可撐）', async () => {
    expect(await prisma.chapterView.count()).toBe(0);
  });

  it('NovelDailyStat 為空（每日統計只能由彙總作業產生）', async () => {
    expect(await prisma.novelDailyStat.count()).toBe(0);
  });

  it('RankingEntry 為空（手寫的 30 筆示範名次已停止寫入，FR-043a）', async () => {
    expect(await prisma.rankingEntry.count()).toBe(0);
  });

  it('Notification 為空（通知只能由發佈路徑產生，T117a）', async () => {
    expect(await prisma.notification.count()).toBe(0);
  });
});

describe('T092-3：歸零的是統計，不是內容', () => {
  it('作品、卷、章節與正文仍然存在（示範環境的樣貌是「有作品、無互動」）', async () => {
    expect(await prisma.novel.count()).toBeGreaterThan(0);
    expect(await prisma.volume.count()).toBeGreaterThan(0);
    expect(await prisma.chapter.count()).toBeGreaterThan(0);
    expect(await prisma.chapterContent.count()).toBeGreaterThan(0);
  });

  it('作品的字數與章節數仍為真實值（那兩個有內容支撐，MUST NOT 一併歸零）', async () => {
    const withContent = await prisma.novel.count({
      where: { chapterCount: { gt: 0 }, wordCount: { gt: 0 } },
    });
    expect(withContent).toBeGreaterThan(0);
  });

  it('分類與示範帳號仍然建立', async () => {
    expect(await prisma.category.count()).toBeGreaterThan(0);
    expect(await prisma.user.count()).toBeGreaterThan(0);
  });
});
