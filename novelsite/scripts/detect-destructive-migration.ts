/**
 * 破壞性結構異動偵測（FEAT-6 T044／FR-092、FR-092a，contracts/internal-modules.md §6）
 * ====================================================================================
 * ```bash
 * # cwd MUST 為 repo 根目錄（pathspec 帶 `novelsite/` 前綴）
 * npx tsx novelsite/scripts/detect-destructive-migration.ts --base <sha>
 * # → stdout 一行 JSON：{ "destructive": boolean, "reasons": string[] }
 * ```
 * 離開碼 0 表「判定完成」（不論結果）；非 0 表判定本身失敗，
 * 呼叫端（`.github/workflows/deploy.yml`）MUST 視同破壞性。
 *
 * ## 判定採 allowlist，方向只能是這一邊
 *
 * 未命中安全語句白名單者**一律**判為破壞性（FR-092a）。blocklist 的失效方式是
 * 「漏列一種寫法就放行」，而漏列不會有任何訊號；allowlist 的失效方式是
 * 「沒見過的安全寫法被誤攔」，代價是一次人工核准。兩種錯誤的代價不對稱。
 *
 * ## 唯一一個會往放行方向倒的失敗模式
 *
 * `git diff` 對**寫錯的 pathspec 或錯誤的 cwd** 回傳的是**空集合而非錯誤**，
 * 而空集合的正常語意是「本次無待套用 migration」＝安全。
 * 兩者在輸出上完全無法區分，症狀是**每一個破壞性 migration 都被判為安全並自動套用**，
 * 且流程紀錄顯示「偵測通過」。故 `git diff` 之前 MUST 先斷言 migrations 目錄實際存在
 * ——把「路徑寫錯」從沉默的空集合變成明確的破壞性（契約 §6.1 第三輪裁示）。
 * 其餘全部錯誤路徑（`--base` 缺漏、`git diff` 失敗、SQL 切不出完整語句）皆倒向 fail-safe。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** 相對於 repo 根目錄。**`novelsite/` 前綴 MUST NOT 省略**（見檔頭） */
export const MIGRATIONS_PATHSPEC = 'novelsite/prisma/migrations/postgres/';

export interface DetectOptions {
  /** 現行運行映像的 `org.opencontainers.image.revision` label */
  base?: string;
  /** repo 根目錄，預設取 cwd */
  repoRoot?: string;
}

export interface DetectResult {
  destructive: boolean;
  reasons: string[];
}

/**
 * 錢字號引用（`$$ … $$`／`$tag$ … $tag$`）出現即判為破壞性。
 *
 * 它包住的內容無法以「引號、分號」的規則切分，而實務上會被這樣包起來的
 * 幾乎都是資料搬移（`DO $$ BEGIN UPDATE … END $$;`）。註解或字串裡的錢字號
 * 也會命中——那是誤攔，代價是一次人工核准，方向正確。
 */
const DOLLAR_QUOTE = /\$[A-Za-z_][A-Za-z_0-9]*\$|\$\$/;

interface Statement {
  text: string;
  line: number;
}

/** 掃描結果；`error` 有值即「切不出完整語句」 */
interface SplitResult {
  statements: Statement[];
  error?: string;
}

/**
 * 逐字掃描切出語句。**MUST NOT 用分號直接 split**——註解與字串字面量裡的分號
 * 會把語句切爛，而切爛之後的每一段都命不中白名單，症狀是**安全的 migration
 * 被判為破壞性**（誤攔方向，但每次部署都要核准，SC-025 後半句失守）。
 */
function splitStatements(sql: string): SplitResult {
  const statements: Statement[] = [];
  let buffer = '';
  let line = 1;
  let startLine = 1;
  let i = 0;

  const push = () => {
    if (buffer.trim() !== '') {
      statements.push({ text: buffer, line: startLine });
    }
    buffer = '';
    startLine = line;
  };

  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (ch === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') i += 1;
      continue;
    }

    if (ch === '/' && next === '*') {
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) {
        if (sql[i] === '\n') line += 1;
        i += 1;
      }
      if (i >= sql.length) return { statements, error: '區塊註解未閉合' };
      i += 2;
      continue;
    }

    if (ch === "'" || ch === '"') {
      const quote = ch;
      const openedAt = line;
      buffer += ch;
      i += 1;
      let closed = false;
      while (i < sql.length) {
        if (sql[i] === '\n') line += 1;
        if (sql[i] === quote) {
          // 連續兩個引號是跳脫，不是結尾
          if (sql[i + 1] === quote) {
            buffer += quote + quote;
            i += 2;
            continue;
          }
          buffer += quote;
          i += 1;
          closed = true;
          break;
        }
        buffer += sql[i];
        i += 1;
      }
      if (!closed) {
        return { statements, error: `第 ${openedAt} 行的 ${quote} 引號未閉合` };
      }
      continue;
    }

    if (ch === ';') {
      push();
      i += 1;
      continue;
    }

    if (ch === '\n') line += 1;
    buffer += ch;
    i += 1;
  }

  // 末尾少一個分號時仍照白名單判定：它不是「切不出來」，
  // 而且破壞性語句照樣命不中白名單，沒有放行風險
  push();
  return { statements };
}

/**
 * 安全語句白名單（research R-11、契約 §6.2）。大小寫不敏感，逐語句以開頭樣式比對
 * ——**MUST NOT 全檔搜尋關鍵字**：`CREATE TABLE` 的欄位定義裡本來就有 `NOT NULL`。
 */
function isSafeStatement(statement: string): boolean {
  const s = statement.replace(/\s+/g, ' ').trim();

  if (/^CREATE TABLE\b/i.test(s)) return true;
  if (/^CREATE (UNIQUE )?INDEX\b/i.test(s)) return true;

  if (/^ALTER TABLE\b/i.test(s)) {
    // 白名單只收「可為 NULL 且無 DEFAULT 的 ADD COLUMN」。
    // 後半的排除項 MUST 保留：`ALTER TABLE x ADD COLUMN a TEXT, DROP COLUMN b;`
    // 是一個語句兩個動作，只看有沒有 `ADD COLUMN` 會把它放行
    return /\bADD COLUMN\b/i.test(s) && !/\b(DROP|RENAME|ALTER COLUMN|NOT NULL|DEFAULT)\b/i.test(s);
  }

  if (/^INSERT\b/i.test(s)) {
    // 白名單列的是 `INSERT …` 與 `INSERT … ON CONFLICT DO NOTHING` 兩種寫法；
    // `ON CONFLICT … DO UPDATE` 會改寫既有列，後果與裸 `UPDATE` 相同
    return !/\bON CONFLICT\b/i.test(s) || /\bDO NOTHING\b/i.test(s);
  }

  if (/^COMMENT ON\b/i.test(s)) return true;

  return false;
}

/** 判定一份 migration SQL；回傳破壞性理由清單（空陣列＝安全） */
export function classifySql(sql: string, label: string): string[] {
  const dollar = DOLLAR_QUOTE.exec(sql);
  if (dollar !== null) {
    const line = sql.slice(0, dollar.index).split('\n').length;
    return [`${label}:${line} 含錢字號引用（${dollar[0]}），內容無法切分為完整語句`];
  }

  const { statements, error } = splitStatements(sql);
  if (error !== undefined) {
    return [`${label} 切不出完整語句：${error}`];
  }

  const reasons: string[] = [];
  for (const statement of statements) {
    if (isSafeStatement(statement.text)) continue;
    const head = statement.text.replace(/\s+/g, ' ').trim().slice(0, 80);
    reasons.push(`${label}:${statement.line} 未命中安全語句白名單：${head}`);
  }
  return reasons;
}

/** 取得待判定集合並逐檔判定。任一環節失敗即 `destructive: true` */
export function detectDestructive(options: DetectOptions = {}): DetectResult {
  const repoRoot = options.repoRoot ?? process.cwd();
  const base = options.base;

  if (base === undefined || base.trim() === '') {
    return {
      destructive: true,
      reasons: ['未取得 --base（現行運行映像的 revision label）：首次部署或標記遺失皆走這裡'],
    };
  }

  // git diff 之前先斷言目錄存在——這是唯一一個會往放行方向倒的失敗模式（見檔頭）
  if (!fs.existsSync(path.join(repoRoot, MIGRATIONS_PATHSPEC))) {
    return {
      destructive: true,
      reasons: [`migrations 目錄不存在（pathspec 或 cwd 有誤）：${MIGRATIONS_PATHSPEC}`],
    };
  }

  let changed: string[];
  try {
    const stdout = execFileSync(
      'git',
      ['diff', '--name-only', `${base}..HEAD`, '--', MIGRATIONS_PATHSPEC],
      { cwd: repoRoot, encoding: 'utf8' }
    );
    changed = stdout.split('\n').map((l) => l.trim());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { destructive: true, reasons: [`git diff 失敗（base=${base}）：${message}`] };
  }

  // 只收 migration.sql；異動而非只有新增也要判——
  // 改寫一份已經套用過的 migration 與新增一份破壞性的一樣危險
  const files = changed.filter((f) => f.endsWith('/migration.sql'));

  const reasons: string[] = [];
  for (const file of files) {
    let sql: string;
    try {
      sql = fs.readFileSync(path.join(repoRoot, file), 'utf8');
    } catch {
      reasons.push(`${file}：讀不到內容（可能已被刪除或改名）`);
      continue;
    }
    reasons.push(...classifySql(sql, file));
  }

  return { destructive: reasons.length > 0, reasons };
}

function main(): void {
  const argv = process.argv.slice(2);
  const flagIndex = argv.indexOf('--base');
  const base = flagIndex >= 0 ? argv[flagIndex + 1] : undefined;

  const result = detectDestructive({ base });
  // stdout 只有這一行 JSON：呼叫端直接以它取 job output
  console.log(JSON.stringify(result));
}

// 只有以指令直接執行時才輸出。**MUST NOT 用 `require.main === module`**
// （測試以 ESM 載入本檔時 `require` 不存在），也不用 `import.meta`
// （tsx 以 CJS 執行 `.ts` 時語意不一致）
if (path.basename(process.argv[1] ?? '').startsWith('detect-destructive-migration')) {
  main();
}
