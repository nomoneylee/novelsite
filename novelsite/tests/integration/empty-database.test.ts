/**
 * 空資料庫上的全站可用性（FEAT-6 T012，FR-069、SC-016，research R-16）
 * =====================================================================
 * 首頁輪播的空資料守衛與兩處空狀態文案已於 2026-08-08 先行落地；
 * **本檔負責的是為它們補上測試，使其不會被改回去**。
 *
 * `beforeAll` 以 `clearContentTables()` 建立空庫（互動確認留在 CLI 層，故此處直接呼叫核心函式）。
 *
 * **`afterAll` MUST 重新 seed 還原**：`vitest.integration.config.mts` 雖已設
 * `fileParallelism: false`，但**循序不等於順序固定**——不還原的話，排在本檔之後的任何檔案
 * 都會在空庫上跑，而它們的失敗訊息會是「查無此作品」之類，**不會指向這裡**。
 * 還原的代價是本檔多約數十秒，換到零跨檔耦合；比「本檔 MUST 排最後」這種靠約定維持的秩序可靠。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { prisma } from '@/lib/db';
import { testFetch } from '../helpers/client';
import {
  clearContentTables,
  countAllTables,
  CONTENT_TABLES,
  REFERENCE_TABLES,
} from '../../scripts/clear-content';

/** 錯誤頁的特徵字串：Next 的正式建置產物在伺服器端例外時輸出這些字樣 */
const ERROR_PAGE_MARKERS = ['Application error', 'server-side exception'];

/** 清除前的 23 張表列數，供「參考資料未被動到」的正向比對 */
let countsBefore: Record<string, number>;

function runSeed(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['run', 'db:seed'], {
      cwd: path.resolve(__dirname, '../..'),
      // 測試行程的環境已含 DATABASE_PROVIDER／DATABASE_URL 與 SEED_ALLOW_DESTRUCTIVE=1
      // （tests/testEnv.ts）——PostgreSQL 軌少了最後這一項，seed 會被 FR-066 的守衛擋下
      env: process.env,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`db:seed 還原失敗，結束代碼 ${code}`))
    );
  });
}

beforeAll(async () => {
  countsBefore = await countAllTables(prisma);
  await clearContentTables(prisma);
}, 60_000);

afterAll(async () => {
  await runSeed();
}, 180_000);

describe('清除範圍（FR-067、FR-068）', () => {
  it('21 張內容資料表列數皆為 0', async () => {
    const counts = await countAllTables(prisma);
    for (const table of CONTENT_TABLES) {
      expect(counts[table], `${table} 應為 0`).toBe(0);
    }
  });

  it('Category 與 Tag 兩張站方參考資料列數不變（MUST NOT 被清除）', async () => {
    const counts = await countAllTables(prisma);
    for (const table of REFERENCE_TABLES) {
      expect(counts[table], `${table} 列數應與清除前相同`).toBe(countsBefore[table]);
    }
    // 分類是 migration 建立的 6 筆站方參考資料，不是示範資料
    expect(counts.Category).toBe(6);
  });
});

describe('空資料庫上的四個主要頁面（FR-069、SC-016）', () => {
  it('首頁 200，且**不含輪播區塊**（隱藏而非留一片空白）', async () => {
    const res = await testFetch('/', { ip: '10.66.1.1' });
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).not.toContain('hero-section');
    // 新書區的空狀態文案 MUST 出現——沒有它就只剩一個標題，看起來像頁面壞了
    expect(html).toContain('目前還沒有新書上架');
    for (const marker of ERROR_PAGE_MARKERS) expect(html).not.toContain(marker);
  });

  it('排行榜 200 且顯示空榜文案', async () => {
    const res = await testFetch('/ranking', { ip: '10.66.1.2' });
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).toContain('此榜單目前尚無上榜作品');
    for (const marker of ERROR_PAGE_MARKERS) expect(html).not.toContain(marker);
  });

  it('搜尋 200：無關鍵字顯示引導文案，有關鍵字顯示查無結果', async () => {
    const blank = await testFetch('/search', { ip: '10.66.1.3' });
    expect(blank.status).toBe(200);
    const blankHtml = await blank.text();
    expect(blankHtml).toContain('輸入關鍵字或選擇分類開始搜尋全站作品');
    for (const marker of ERROR_PAGE_MARKERS) expect(blankHtml).not.toContain(marker);

    const queried = await testFetch('/search?q=%E5%8A%8D', { ip: '10.66.1.4' });
    expect(queried.status).toBe(200);
    const queriedHtml = await queried.text();
    expect(queriedHtml).toContain('找不到符合條件的作品');
    for (const marker of ERROR_PAGE_MARKERS) expect(queriedHtml).not.toContain(marker);
  });

  it('分類總覽 200：6 個分類仍在，每個顯示 0 部作品', async () => {
    const res = await testFetch('/categories', { ip: '10.66.1.5' });
    expect(res.status).toBe(200);
    const html = await res.text();

    // 分類是參考資料，空庫上**仍應完整列出**——這同時是「清除範圍沒有多刪」的畫面側證明。
    // 各分類的作品數則全為 0，那才是本頁的空狀態。
    expect([...html.matchAll(/id="category-card-/g)]).toHaveLength(6);
    // 作品數與「部作品」在 JSX 裡是兩個相鄰的運算式，React 於 SSR 會在兩者之間插入
    // `<!-- -->` 分隔文字節點——比對 MUST 容許它，否則這條斷言會紅在渲染細節而不是資料上
    expect([...html.matchAll(/0(?:<!-- -->)? 部作品/g)]).toHaveLength(6);
    expect(html).not.toContain('分類尚未建立');
    for (const marker of ERROR_PAGE_MARKERS) expect(html).not.toContain(marker);
  });
});
