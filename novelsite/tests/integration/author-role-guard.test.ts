import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '@/lib/db';
import { loginAs } from '../helpers/client';
import { callAction, hasErrorCode } from '../helpers/serverAction';
import {
  createAuthor,
  createNovelWithChapter,
  snapshotNovel,
  cleanupAuthoring,
  type TestAuthor,
  type TestNovel,
} from '../helpers/authoring';

/**
 * FR-007／US1 AC10／SC-002：**每個 Action 自行驗證身分與角色，不依賴 `proxy.ts` 的 matcher**。
 *
 * 本檔分兩部分，缺一不可：
 *
 * **(A) 執行期：證明擋下請求的真的是 Action，而不是攔截層。**
 * 單純以 reader 身分 POST 到 `/author/*` 證明不了 —— proxy 會先回 302，Action 根本沒被叫到，
 * 測試綠燈卻什麼都沒驗。故利用兩層檢查的**依據不同**製造出「攔截層放行、Action 必須自己擋」：
 *
 * | 檢查點 | 身分依據 | 角色依據 |
 * | --- | --- | --- |
 * | `proxy.ts` | JWT 簽章（`verifyClaimsOnly`，不查 DB） | JWT 內的角色快照 |
 * | Action（`requireAuthorForAction`） | `Session` 資料列（查 DB） | `User.role`（查 DB，FR-045） |
 *
 * 於是：先以 author 身分登入取得帶 `role=author` 快照的憑證，再把 DB 角色降為 `reader`
 * ——proxy 看快照放行，Action 覆核 DB 後 MUST 回 `FORBIDDEN`。工作階段撤銷同理。
 * 若擋下它的是 proxy，回應會是 302，裡面沒有錯誤碼，斷言就不會成立。
 *
 * **(B) 靜態：每一個 Action 逐一稽核授權前置。**
 * 執行期部分目前只涵蓋 `createNovelAction` —— Next 只會把**被 client 元件實際引用**的
 * Server Action 註冊進 `server-reference-manifest.json`，其餘的要等 T045／T052／T053
 * 把作品管理頁與編輯器接上之後才有端點可打。在那之前，「有沒有哪個 Action 忘了叫守衛」
 * 這個問題由原始碼稽核回答：逐一檢查每個 Action 的第一個 `await` 是不是
 * `requireAuthorForAction()`。這道檢查不隨 UI 進度變動，且新增下一個 Action 時會自動納入。
 */

const IP = '10.61.1.1';

const ACTIONS_PATH = path.resolve(__dirname, '../../src/app/author/actions.ts');

/**
 * 十六個寫入 Action（作品 4、卷 3、章節 7、批次 2）。
 *
 * **FEAT-8 T017a／T029a（2026-08-23）**：`publishChaptersAction` 隨批次發佈、
 * `deleteChaptersAction` 隨批次刪除一併加入。
 * 本清單被下方的 `it('檔案內沒有清單以外的 Action')` 以 `found.sort()` **逐字比對**
 * `actions.ts` 的匯出集合 —— 新增 Action 而不同批更新這裡，整合套件立刻紅，
 * 而紅的是一支與該功能無關的既有測試（憲章第 IV 條的綠燈閘門）。
 */
const EXPECTED_ACTIONS = [
  'createNovelAction',
  'updateNovelAction',
  'publishNovelAction',
  'deleteNovelAction',
  'createVolumeAction',
  'updateVolumeAction',
  'deleteVolumeAction',
  'createChapterAction',
  'saveChapterDraftAction',
  'publishChapterAction',
  'unpublishChapterAction',
  'reorderChaptersAction',
  'deleteChapterAction',
  'cancelScheduleAction',
  'publishChaptersAction',
  'deleteChaptersAction',
];

let victim: TestAuthor;
let owned: TestNovel;
/** 受擁有者守衛的 Action 只註冊在動態路由上，故 POST 目標須為具體網址 */
let managePath: string;
let before: string;

/**
 * 每個 Action 各自的合法入參（角色守衛在驗證入參之前就該擋下，值只需形狀正確）。
 *
 * MUST 為函式而非常數 —— 它引用 `owned`，而那要等 `beforeAll` 才有值；
 * 寫成模組層常數會在收集階段就讀到 `undefined`。迴圈用的名稱清單則另立於 `EXPECTED_ACTIONS`。
 */
function allActionCalls(): { name: string; args: unknown[] }[] {
  return [
    {
      name: 'createNovelAction',
      args: [{ title: '不該被建立的作品', categoryId: 'whatever', excerpt: '簡介。' }],
    },
    { name: 'updateNovelAction', args: [{ novelId: owned.novelId, title: '不該生效的標題' }] },
    { name: 'publishNovelAction', args: [{ novelId: owned.novelId, status: 'published' }] },
    { name: 'deleteNovelAction', args: [{ novelId: owned.novelId }] },
    { name: 'createVolumeAction', args: [{ novelId: owned.novelId, title: '不該被建立的卷' }] },
    { name: 'updateVolumeAction', args: [{ volumeId: owned.volumeId, title: '不該生效的卷名' }] },
    { name: 'deleteVolumeAction', args: [{ volumeId: owned.volumeId }] },
    {
      name: 'createChapterAction',
      args: [{ novelId: owned.novelId, volumeId: owned.volumeId }],
    },
    {
      name: 'saveChapterDraftAction',
      args: [
        { chapterId: owned.chapterId, title: '不該生效的章名', bodyMarkdown: '不該寫入的正文。' },
      ],
    },
    { name: 'publishChapterAction', args: [{ chapterId: owned.chapterId }] },
    { name: 'cancelScheduleAction', args: [{ chapterId: owned.chapterId }] },
    { name: 'unpublishChapterAction', args: [{ chapterId: owned.chapterId }] },
    {
      name: 'reorderChaptersAction',
      args: [{ volumeId: owned.volumeId, orderedChapterIds: [owned.chapterId] }],
    },
    { name: 'deleteChapterAction', args: [{ chapterId: owned.chapterId }] },
    // FEAT-8 T017a／T029a：兩個批次 Action。指向 victim 的資源，與其餘各項同一個判準
    {
      name: 'publishChaptersAction',
      args: [{ volumeId: owned.volumeId, chapterIds: [owned.chapterId] }],
    },
    {
      name: 'deleteChaptersAction',
      args: [{ volumeId: owned.volumeId, chapterIds: [owned.chapterId] }],
    },
  ];
}

beforeAll(async () => {
  await cleanupAuthoring();
  victim = await createAuthor('role-guard');
  owned = await createNovelWithChapter({ authorId: victim.id });
  managePath = `/author/novels/${owned.novelId}`;
  before = await snapshotNovel(owned.novelId);
});

afterAll(async () => {
  await cleanupAuthoring();
});

// ─────────────────────────────────────────────
// (A) 執行期：Action 自驗，攔截層已放行
// ─────────────────────────────────────────────

describe('角色不足：DB 角色為 reader，但憑證快照仍是 author（FR-007、FR-045）', () => {
  let cookie: string;
  let novelCountBefore: number;

  beforeAll(async () => {
    // 先以 author 身分登入 —— 取得的憑證帶 role=author 快照，proxy 據此放行
    cookie = await loginAs(victim.email, victim.password, IP);
    // 再把資料庫角色降為 reader；此後只有查 DB 的那一層擋得住
    await prisma.user.update({ where: { id: victim.id }, data: { role: 'reader' } });
    novelCountBefore = await prisma.novel.count();
  });

  it('每一個 Action 都在測試清單內', () => {
    expect(allActionCalls()).toHaveLength(EXPECTED_ACTIONS.length);
    expect(
      allActionCalls()
        .map((c) => c.name)
        .sort()
    ).toEqual([...EXPECTED_ACTIONS].sort());
  });

  for (const name of EXPECTED_ACTIONS) {
    it(`${name}：回 FORBIDDEN（非 302；擋下它的是 Action 而非 proxy）且資料未變更`, async () => {
      const call = allActionCalls().find((c) => c.name === name)!;
      const res = await callAction(call.name, call.args, { ip: IP, cookie, route: managePath });

      expect(res.status, '收到 302 代表擋下它的是 proxy，這一則就沒驗到 Action').not.toBe(302);
      expect(
        hasErrorCode(res, 'FORBIDDEN'),
        `${name} 未回 FORBIDDEN：${res.text.slice(0, 400)}`
      ).toBe(true);
      expect(await snapshotNovel(owned.novelId)).toBe(before);
      expect(await prisma.novel.count()).toBe(novelCountBefore);
    });
  }

  it('角色檢查早於輸入驗證 —— 非法入參仍回 FORBIDDEN 而非 VALIDATION_ERROR', async () => {
    const res = await callAction(
      'createNovelAction',
      [{ title: '', categoryId: '', excerpt: '' }],
      {
        ip: IP,
        cookie,
      }
    );
    expect(hasErrorCode(res, 'FORBIDDEN')).toBe(true);
    expect(hasErrorCode(res, 'VALIDATION_ERROR')).toBe(false);
  });
});

describe('未登入：JWT 仍合法，但工作階段已於 DB 撤銷（FR-007）', () => {
  let cookie: string;
  let novelCountBefore: number;

  beforeAll(async () => {
    // 角色先還原為 author，確保這一輪擋下請求的是「身分」而不是殘留的角色降級
    await prisma.user.update({ where: { id: victim.id }, data: { role: 'author' } });
    cookie = await loginAs(victim.email, victim.password, IP);
    await prisma.session.updateMany({
      where: { userId: victim.id },
      data: { revokedAt: new Date() },
    });
    novelCountBefore = await prisma.novel.count();
  });

  for (const name of EXPECTED_ACTIONS) {
    it(`${name}：回 UNAUTHENTICATED（非 302）且資料未變更`, async () => {
      const call = allActionCalls().find((c) => c.name === name)!;
      const res = await callAction(call.name, call.args, { ip: IP, cookie, route: managePath });

      expect(res.status).not.toBe(302);
      expect(
        hasErrorCode(res, 'UNAUTHENTICATED'),
        `${name} 未回 UNAUTHENTICATED：${res.text.slice(0, 400)}`
      ).toBe(true);
      expect(await snapshotNovel(owned.novelId)).toBe(before);
      expect(await prisma.novel.count()).toBe(novelCountBefore);
    });
  }

  /**
   * 完全不帶 Cookie 時，`/author/*` 的請求會先被 proxy 以 302 攔下，Action 不會執行。
   * 那是**第二道防線**，本身沒有問題 —— 但正因為它會先動作，這一則 MUST NOT 斷言
   * 「回 UNAUTHENTICATED」（那會變成在測 proxy，而且 302 裡沒有錯誤碼可驗）。
   * 這裡只斷言真正不可協商的部分：無論由哪一道擋下，**資料一律不得被寫入**。
   */
  it('完全不帶 Cookie：由兩道防線中的任一道擋下，且未寫入任何作品', async () => {
    const res = await callAction(
      'createNovelAction',
      [{ title: '匿名者的作品', categoryId: 'whatever', excerpt: '簡介。' }],
      { ip: IP }
    );
    const rejected = res.status === 302 || hasErrorCode(res, 'UNAUTHENTICATED');
    expect(
      rejected,
      `既未轉址也未回 UNAUTHENTICATED：${res.status} ${res.text.slice(0, 200)}`
    ).toBe(true);
    expect(await prisma.novel.count()).toBe(novelCountBefore);
  });
});

// ─────────────────────────────────────────────
// (B) 靜態稽核：每一個 Action 的授權前置
// ─────────────────────────────────────────────

describe('每一個 Action 的授權前置稽核（FR-007、T038a）', () => {
  const source = fs.readFileSync(ACTIONS_PATH, 'utf8');

  /** 取出某個 Action 的函式本體（到下一個 `export ` 或檔尾為止） */
  function bodyOf(name: string): string {
    const start = source.indexOf(`export async function ${name}(`);
    expect(start, `找不到 Action：${name}`).toBeGreaterThan(-1);
    const rest = source.slice(start + 1);
    const nextExport = rest.indexOf('\nexport ');
    return nextExport === -1 ? rest : rest.slice(0, nextExport);
  }

  it('清單內的 Action 全數存在於 src/app/author/actions.ts', () => {
    for (const name of EXPECTED_ACTIONS) {
      expect(source, `缺少 Action：${name}`).toContain(`export async function ${name}(`);
    }
  });

  it('檔案內沒有清單以外的 Action（新增時 MUST 一併納入本稽核）', () => {
    const found = [...source.matchAll(/export async function (\w+Action)\(/g)].map((m) => m[1]);
    expect(found.sort()).toEqual([...EXPECTED_ACTIONS].sort());
  });

  for (const name of EXPECTED_ACTIONS) {
    it(`${name}：第一個 await 是 requireAuthorForAction()`, () => {
      const body = bodyOf(name);
      const firstAwait = body.indexOf('await ');
      expect(firstAwait, `${name} 內完全沒有 await —— 不可能有做授權檢查`).toBeGreaterThan(-1);
      expect(
        body.slice(firstAwait, firstAwait + 40),
        `${name} 的第一個 await 不是授權守衛，授權順序（身分 → 角色 → 擁有權）不成立`
      ).toContain('requireAuthorForAction()');
    });
  }

  it('MUST NOT 直接使用會轉址的 requireAuthor()（Action 需回錯誤碼而非 302）', () => {
    expect(source).not.toMatch(/\brequireAuthor\s*\(/);
  });

  it('MUST NOT 直接 import prisma 或 repositories（分層鐵律，憲章第 III 條）', () => {
    expect(source).not.toContain("from '@/lib/db'");
    expect(source).not.toContain("from '@/lib/repositories'");
  });
});
