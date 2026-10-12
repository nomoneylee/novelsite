import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 分層與快取失效的**靜態稽核**（SC-009、FR-010、憲章第 III 條）
 * ==============================================================
 * T094／T095 的任務原文是「掃描並確認」。以 `grep` 跑一次也算確認，
 * 但那個確認只存在於當下的終端機裡 —— 下一個人新增一個
 * `import { prisma }` 到頁面裡時，沒有任何東西會變紅。
 *
 * 故改寫為可執行的檢查，納入單元測試套件（不需要資料庫，毫秒級）。
 * 這一層規則的價值全在「持續成立」，一次性的掃描等於沒有規則。
 */

const SRC = path.resolve(__dirname, '../../src');

/** 遞迴收集 `.ts`／`.tsx`，排除 Prisma 產生物（那是建置產物，不是我們寫的程式碼） */
function collectSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'generated') continue;
      out.push(...collectSources(full));
      continue;
    }
    if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** 相對於 `src/` 的路徑，以 `/` 分隔（Windows 上 `path.relative` 會回 `\`） */
function rel(file: string): string {
  return path.relative(SRC, file).split(path.sep).join('/');
}

const FILES = collectSources(SRC).map((file) => ({
  path: rel(file),
  source: fs.readFileSync(file, 'utf8'),
}));

const under = (prefix: string) => FILES.filter((f) => f.path.startsWith(prefix));

describe('T094：頁面、元件與 Action 不得直接觸及資料庫客戶端（憲章第 III 條）', () => {
  const upperLayers = [...under('app/'), ...under('components/')];

  it('掃描範圍非空（避免收集邏輯壞掉時整組檢查靜默通過）', () => {
    expect(upperLayers.length).toBeGreaterThan(20);
  });

  for (const forbidden of ["from '@/lib/db'", "from '@prisma/client'", '@/generated/prisma']) {
    it(`app/** 與 components/** 內無 \`${forbidden}\``, () => {
      const offenders = upperLayers.filter((f) => f.source.includes(forbidden)).map((f) => f.path);
      expect(offenders).toEqual([]);
    });
  }
});

describe('T094：資料存取層一律經 barrel 引用，無深層 import', () => {
  it("全 src 內無 `from '@/lib/repositories/xxx'`（barrel 之外的深層路徑）", () => {
    // barrel 自身的 `export * from './novels'` 是相對路徑，不會命中這個樣式
    const offenders = FILES.filter((f) => /from '@\/lib\/repositories\/[^']+'/.test(f.source)).map(
      (f) => f.path
    );
    expect(offenders).toEqual([]);
  });
});

describe('T094：provider 差異封鎖在單一檔案（SC-009、雙軌分歧點）', () => {
  /**
   * `env.ts`（定義與驗證）與 `db.ts`（依 provider 選 driver adapter，FR-019／FR-021 的
   * 唯一連線點）**本來就以此值分流**，兩者早於 FEAT-3 且是設計本身。
   * 本階段要守的是「**資料存取層**的查詢分歧只有一處」——即 `repositories/search.ts`。
   */
  const ALLOWED = new Set(['lib/env.ts', 'lib/db.ts', 'lib/repositories/search.ts']);

  it('除 env.ts／db.ts／repositories/search.ts 外，無任何檔案讀取 DATABASE_PROVIDER', () => {
    const offenders = FILES.filter(
      (f) => f.source.includes('env.DATABASE_PROVIDER') && !ALLOWED.has(f.path)
    ).map((f) => f.path);

    // `api/health/route.ts` 只是把已驗證的設定值回報出去，不做分支；
    // 若它日後改成依 provider 走不同邏輯，這一則就會紅燈
    expect(offenders).toEqual(['app/api/health/route.ts']);
  });

  it('`repositories/**` 之中只有 search.ts 依 provider 分流', () => {
    const offenders = under('lib/repositories/')
      .filter((f) => f.source.includes('DATABASE_PROVIDER'))
      .map((f) => f.path);
    expect(offenders).toEqual(['lib/repositories/search.ts']);
  });
});

describe('T095：快取失效只由服務層發起（FR-010）', () => {
  const INVALIDATORS = /\b(revalidateTag|revalidatePath|updateTag)\s*\(/;

  it('框架的失效 API 只出現在 `lib/cache.ts`', () => {
    const offenders = FILES.filter(
      (f) => f.path !== 'lib/cache.ts' && INVALIDATORS.test(f.source)
    ).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('`invalidate*` 的呼叫端只有服務層', () => {
    const callers = FILES.filter(
      (f) =>
        f.path !== 'lib/cache.ts' && /\binvalidate(Novel|NovelsList|Chapter)\s*\(/.test(f.source)
    ).map((f) => f.path);

    expect(callers.length).toBeGreaterThan(0);
    for (const caller of callers) {
      expect(caller, `${caller} 不在 lib/services/ 之下`).toMatch(/^lib\/services\//);
    }
  });
});

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * T152（FEAT-4）：把分層稽核擴到本階段新增的服務、資料存取、Route Handler 與頁面
 * ─────────────────────────────────────────────────────────────────────────────
 * 上面兩節（FEAT-3 T094）只掃 `app/**` 與 `components/**`。本階段新增了九支服務、
 * 七支 repository、十九個 Route Handler 與四個頁面，其中沒有一個落在那個範圍裡 ——
 * 規則沒有跟著新程式碼走，等於這一階段沒有分層稽核。
 */

/**
 * 去掉註解後的程式碼。**規則守的是程式碼，不是文件**：
 * `app/api/health/route.ts` 與 `lib/repositories/index.ts` 各有一句寫著
 * 「MUST NOT 直接發出 `$queryRaw`」「本檔是唯一允許 `$queryRaw` 之處」的註解，
 * 那是規則的說明而不是違規；把說明判紅，只會逼人刪掉唯一寫著理由的那句話。
 *
 * `[^:]` 是為了不把 `https://` 之後的內容當成行註解切掉（同 `feat4-scan.test.ts`）。
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** 值匯入（非 `import type`）才算觸及資料庫客戶端 */
const DB_VALUE_IMPORT =
  /^\s*import\s+(?!type\b)[^;]*from\s+'(@\/lib\/db|@\/generated\/prisma[^']*|@prisma\/client)'/m;

describe('T152：本階段新增的檔案確實落在稽核範圍內（範圍漏了等於沒有規則）', () => {
  /**
   * 逐一列舉而非只數總量：新增一支服務卻忘了它會不會被掃到，
   * 是這類靜態稽核最常見的失效方式，而總量檢查看不出少了哪一支。
   */
  const MUST_BE_SCANNED = [
    'lib/services/bookshelfService.ts',
    'lib/services/commentService.ts',
    'lib/services/notificationService.ts',
    'lib/services/preferenceService.ts',
    'lib/services/rankingService.ts',
    'lib/services/readingService.ts',
    'lib/services/reviewService.ts',
    'lib/services/statsService.ts',
    'lib/repositories/bookshelf.ts',
    'lib/repositories/comments.ts',
    'lib/repositories/notifications.ts',
    'lib/repositories/rankings.ts',
    'lib/repositories/reading.ts',
    'lib/repositories/reviews.ts',
    'lib/repositories/stats.ts',
    'app/api/bookshelf/route.ts',
    'app/api/reading-progress/route.ts',
    'app/api/reader-preference/route.ts',
    'app/api/reader-state/merge/route.ts',
    'app/api/history/route.ts',
    'app/api/notifications/route.ts',
    'app/api/novels/[id]/reviews/route.ts',
    'app/api/chapters/[id]/comments/route.ts',
    'app/api/chapters/[id]/view/route.ts',
    'app/api/author/comments/route.ts',
    'app/api/cron/rollup-stats/route.ts',
    'app/api/cron/rankings/route.ts',
    'app/api/cron/publish-scheduled/route.ts',
    'app/ranking/page.tsx',
    'app/profile/notifications/page.tsx',
    'app/author/comments/page.tsx',
    'app/author/dashboard/page.tsx',
  ];

  it('列舉的檔案全數在收集結果中', () => {
    const known = new Set(FILES.map((f) => f.path));
    expect(MUST_BE_SCANNED.filter((p) => !known.has(p))).toEqual([]);
  });
});

describe('T152：資料庫客戶端只由資料存取層值匯入（憲章第 III 條）', () => {
  /**
   * `lib/db.ts` 是客戶端本身（唯一連線點）；`lib/repositories/**` 是被授權的使用者。
   * 其餘一律禁止 —— 包含服務層：服務層拿得到 prisma，分層就只剩下目錄名稱。
   *
   * **`import type` 不在此限**：型別匯入不會產生任何執行期存取，
   * 而 `lib/services/authService.ts` 自 FEAT-1 起即以型別方式引用 `User`。
   * 把型別一併禁掉，只會逼人把同一個型別重抄一份。
   */
  it('`lib/db.ts` 與 `lib/repositories/**` 之外無資料庫客戶端的值匯入', () => {
    const offenders = FILES.filter(
      (f) =>
        f.path !== 'lib/db.ts' &&
        !f.path.startsWith('lib/repositories/') &&
        DB_VALUE_IMPORT.test(f.source)
    ).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('掃描確實看得到 repository 自己的匯入（樣式寫錯時上面那則會恆綠）', () => {
    const importers = under('lib/repositories/').filter((f) => DB_VALUE_IMPORT.test(f.source));
    expect(importers.length).toBeGreaterThan(5);
  });
});

describe('T152：原生 SQL 只出現在有理由的那幾支 repository（憲章第 III 條附條件）', () => {
  const RAW_SQL = /\$(queryRaw|queryRawUnsafe|executeRaw|executeRawUnsafe)\b/;

  /**
   * 任務原文寫的是「`$queryRaw` 只出現於 `repositories/stats.ts`」，**與現況不符**：
   * `repositories/health.ts`（FEAT-1 的 `SELECT 1` 存活探測）與
   * `repositories/search.ts`（FEAT-3 的雙軌全文檢索，research R-17）自本階段之前
   * 即各有一處，兩者都不是本階段引入、也都不該被本階段刪掉。
   *
   * 故本則守的是**真正該守的那條線**：原生 SQL MUST 全數落在
   * `lib/repositories/**` 之內，且在其中只限這三支已具名的檔案。
   * 若照原文只允許 stats.ts，這個測試從寫下的第一天就是紅的
   * ——而一個一開始就紅的測試，最後一定是被放寬而不是被修好。
   * 此差異已於 2026-08-08 回寫 tasks.md T152 與 `arch.md`。
   */
  const ALLOWED_RAW = [
    'lib/repositories/health.ts',
    'lib/repositories/search.ts',
    'lib/repositories/stats.ts',
  ];

  it('原生 SQL 只出現在具名的三支 repository', () => {
    const offenders = FILES.filter(
      (f) => RAW_SQL.test(stripComments(f.source)) && !ALLOWED_RAW.includes(f.path)
    ).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('本階段的統計查詢確實用到原生 SQL（名單過期時這則會變紅）', () => {
    const stats = FILES.find((f) => f.path === 'lib/repositories/stats.ts');
    expect(stats && RAW_SQL.test(stripComments(stats.source))).toBe(true);
  });
});

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * T015（FEAT-5）：`src/lib/mail/**` 不得被 client component 引用
 * ─────────────────────────────────────────────────────────────────────────────
 * `resendMailer.ts` 讀 `RESEND_API_KEY`。被 client component 引用時，
 * Next.js 確實會在建置期報錯（非 `NEXT_PUBLIC_` 的變數在 client 為 `undefined`，
 * 且 `mail/index.ts` 帶 `server-only`）——但**那個錯誤訊息不會提到憑證**，
 * 下一個人得自己查半天才會知道真正的問題是「一個伺服器端憑證差點被編進 client bundle」。
 * 稽核在此把原因寫成一句話，比讓人自己查快得多（contracts/internal-modules.md §6）。
 */
describe('T015：郵件模組只在伺服器端使用（憲章第 II 條）', () => {
  const MAIL_IMPORT = /from\s+'@\/lib\/mail(\/[^']*)?'/;

  /** `'use client'` / `"use client"` 指令，允許前置註解與空白 */
  const CLIENT_DIRECTIVE = /^\s*(['"])use client\1/m;

  it('components/** 之中無 `@/lib/mail` 的引用', () => {
    const offenders = under('components/')
      .filter((f) => MAIL_IMPORT.test(f.source))
      .map((f) => f.path);
    expect(offenders, 'src/lib/mail/** 讀 RESEND_API_KEY，MUST NOT 被 components/** 引用').toEqual(
      []
    );
  });

  it('任何帶 `use client` 的檔案之中無 `@/lib/mail` 的引用', () => {
    const offenders = FILES.filter(
      (f) => CLIENT_DIRECTIVE.test(f.source) && MAIL_IMPORT.test(f.source)
    ).map((f) => f.path);
    expect(
      offenders,
      'src/lib/mail/** 讀 RESEND_API_KEY，MUST NOT 被 client component 引用'
    ).toEqual([]);
  });

  it('掃描確實找得到 client component（樣式寫錯時上面兩則會恆綠）', () => {
    const clients = FILES.filter((f) => CLIENT_DIRECTIVE.test(f.source));
    expect(clients.length).toBeGreaterThan(10);
  });

  it('郵件模組確實在收集結果中（檔案沒被掃到等於沒有規則）', () => {
    const mailFiles = under('lib/mail/').map((f) => f.path);
    expect(mailFiles).toContain('lib/mail/index.ts');
    expect(mailFiles).toContain('lib/mail/resendMailer.ts');
  });
});

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * T027（FEAT-6）：client 端 MUST NOT 出現未經 `apiUrl()` 的自家 API 路徑（FR-075）
 * ─────────────────────────────────────────────────────────────────────────────
 * 子路徑部署（`basePath`）下，`next/link` 與 `next/router` 由框架自動補前綴，
 * 但 `fetch('/api/…')` **框架管不到**——它會打到網域根目錄，也就是**別的網站**。
 *
 * 這是本階段最會安靜失效的一處：站台自己看起來一切正常，
 * 只有那個請求悄悄送到了不該去的地方。故規則 MUST 持續成立，而不是改完那一次。
 *
 * **本則的規則比 `contracts/internal-modules.md` §2 的原文更嚴**（*裁示（2026-08-15）*）：
 * 原文的樣式是 `/fetch\(\s*['"`]\/api\//`，只看得見**直接寫在 `fetch(` 括號裡**的字面量。
 * 實作時照該樣式掃出 19 處，但實際的呼叫點是 **26 處**——差的 7 處全部躲在樣式的視線外：
 *
 * | 躲法 | 檔案 | 處數 |
 * |---|---|---|
 * | 路徑先進**常數**，`fetch(ENDPOINT)` | `lib/reader/{preferenceApi,bookshelfApi,readerStateMerge}.ts` | 3 |
 * | 路徑經 **helper 函式**轉手，`send('/api/…', …)` | `components/novel/ReviewSection.tsx` | 4 |
 *
 * 兩種寫法在子路徑下壞得**與那 19 處一模一樣**（書架按了沒反應、偏好同步永遠失敗、
 * 登入後書架是空的），但原樣式看不到它們，且它們的錯誤處理全是靜默的 `catch`。
 * 故本則改守**真正該守的那條線**：範圍內**任何** `/api/` 字面量 MUST 是 `apiUrl(` 的引數，
 * 不論它接下來要進 `fetch`、進常數、還是進別的函式。
 * 照原文只擋 `fetch(` 的話，這條規則從寫下的第一天就漏掉那 7 處，
 * 而漏掉的正是**下一個人最容易新增的寫法**（抽一個常數出來是重構的正常動作）。
 */
describe('T027：client 端的自家 API 路徑一律經 apiUrl()（FR-075、FR-074）', () => {
  /**
   * 掃描範圍含 `lib/reader/**`：那三支端點常數就住在這裡，
   * 只掃 `components/**` 與 `hooks/**`（契約原文的範圍）會把它們整批放行。
   */
  const CLIENT_SCOPE = [...under('components/'), ...under('hooks/'), ...under('lib/reader/')];

  /** `/api/` 字面量（三種引號皆須匹配——26 處中有多數是模板字串） */
  const API_LITERAL = /(['"`])\/api\//g;

  it('掃描範圍非空（收集邏輯壞掉時整組檢查會靜默通過）', () => {
    expect(CLIENT_SCOPE.length).toBeGreaterThan(20);
  });

  it('範圍內每一個 `/api/` 字面量都是 `apiUrl(` 的引數', () => {
    const offenders: string[] = [];

    for (const file of CLIENT_SCOPE) {
      // 規則守的是程式碼，不是文件：本檔與 apiUrl.ts 的說明裡都寫著 `fetch('/api/…')`，
      // 那是規則的說明而非違規（同上方 stripComments 的既有理由）
      const lines = stripComments(file.source).split('\n');

      lines.forEach((line, index) => {
        for (const match of line.matchAll(API_LITERAL)) {
          const before = line.slice(0, match.index);
          if (!before.endsWith('apiUrl(')) {
            offenders.push(`${file.path}:${index + 1}: ${line.trim()}`);
          }
        }
      });
    }

    expect(
      offenders,
      '子路徑部署下未帶前綴的請求會打到網域根目錄（也就是別的網站），且站台自己看起來一切正常'
    ).toEqual([]);
  });

  it('掃描確實看得到已改好的呼叫點（樣式寫錯時上面那則會恆綠）', () => {
    const wrapped = CLIENT_SCOPE.filter((f) => f.source.includes('apiUrl('));
    // 契約 §1 的 19 處分佈在 13 個檔案，另加 lib/reader 三支常數
    expect(wrapped.length).toBeGreaterThan(10);
  });

  it('`apiUrl.ts` MUST NOT 帶 server-only、MUST NOT 讀 env.ts（它是給 client 用的）', () => {
    const mod = FILES.find((f) => f.path === 'lib/apiUrl.ts');
    expect(mod, 'lib/apiUrl.ts 不在收集結果中').toBeDefined();
    // 去註解後再比對：該檔的說明裡就寫著「MUST NOT 加 `server-only`」，
    // 那是規則的理由而不是違規——把說明判紅只會逼人刪掉唯一寫著理由的那句話
    const code = stripComments(mod!.source);
    expect(code).not.toContain('server-only');
    expect(code).not.toContain("from '@/lib/env'");
  });
});
