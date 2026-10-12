/**
 * 破壞性結構異動偵測的判定表（FEAT-6 T043／FR-092、FR-092a，contracts/internal-modules.md §6.3）
 * ==============================================================================================
 * 這支測試存在的理由：**這支腳本判錯不會有任何其他訊號**（規格風險段）。
 * 判太鬆的症狀是破壞性 migration 被自動套用到正式資料庫，而流程紀錄顯示「偵測通過」；
 * 判太緊的症狀是每一次部署都停在人工核准，看起來只像「這個專案的核准比較嚴格」。
 * 兩者都不會有錯誤訊息，所以判定表 MUST 逐格釘住。
 *
 * 案例數依契約 §6.3：破壞性 8（§6.2 破壞性列的九種扣掉另計的 `DO $$`）、安全 5、
 * `DO $$` 包裝 1、空集合 1、**migrations 目錄不存在 1**、本階段實際的 migration 1。
 *
 * **最後兩列 MUST 成對存在**：只驗「空集合 → false」時，pathspec 或 cwd 寫錯的 bug
 * 會**完美通過測試**——`git diff` 對錯誤路徑回傳的是空集合而非錯誤，
 * 而空集合的正常語意正是「本次無待套用 migration」＝安全。
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classifySql, detectDestructive } from '../../scripts/detect-destructive-migration';

const REPO_ROOT = path.resolve(__dirname, '../../..');

/** 判定為安全 ＝ 沒有任何理由被列出 */
function isSafe(sql: string): boolean {
  return classifySql(sql, 'test.sql').length === 0;
}

describe('classifySql：破壞性語句（8 種，§6.2 破壞性列扣掉另計的 DO $$）', () => {
  const DESTRUCTIVE: Array<[string, string]> = [
    ['DROP TABLE', 'DROP TABLE "Novel";'],
    ['DROP COLUMN', 'ALTER TABLE "Novel" DROP COLUMN "summary";'],
    ['ALTER COLUMN … TYPE', 'ALTER TABLE "Novel" ALTER COLUMN "viewCount" TYPE BIGINT;'],
    ['SET NOT NULL', 'ALTER TABLE "Novel" ALTER COLUMN "summary" SET NOT NULL;'],
    ['RENAME', 'ALTER TABLE "Novel" RENAME COLUMN "viewCount" TO "views";'],
    // UPDATE／DELETE MUST NOT 漏：**以原生 SQL 撰寫資料搬移最常見的寫法就是這兩種**，
    // 漏測的症狀是資料搬移被判為安全並自動套用（契約 §6.3 裁示，2026-08-14）
    ['UPDATE', `UPDATE "Novel" SET "status" = 'DRAFT';`],
    ['DELETE', `DELETE FROM "Novel" WHERE "status" = 'DRAFT';`],
    ['TRUNCATE', 'TRUNCATE TABLE "Novel";'],
  ];

  for (const [name, sql] of DESTRUCTIVE) {
    it(`${name} → 破壞性`, () => {
      const reasons = classifySql(sql, 'test.sql');
      expect(reasons.length).toBeGreaterThan(0);
      // 理由 MUST 指出檔案與行號，否則核准者無從判斷該不該按下去
      expect(reasons[0]).toContain('test.sql:1');
    });
  }
});

describe('classifySql：安全語句（5 種，allowlist）', () => {
  it('CREATE TABLE → 安全（新表，舊程式碼不知道它存在）', () => {
    // 欄位定義裡的 `NOT NULL` MUST NOT 使它被判為破壞性——
    // 逐語句以開頭樣式判定，而非全檔搜尋關鍵字
    expect(
      isSafe(
        'CREATE TABLE "Tag" ("id" TEXT NOT NULL, "slug" TEXT NOT NULL, CONSTRAINT "Tag_pkey" PRIMARY KEY ("id"));'
      )
    ).toBe(true);
  });

  it('CREATE [UNIQUE] INDEX → 安全', () => {
    expect(isSafe('CREATE INDEX "Novel_status_idx" ON "Novel"("status");')).toBe(true);
    expect(isSafe('CREATE UNIQUE INDEX "Tag_slug_key" ON "Tag"("slug");')).toBe(true);
  });

  it('可為 NULL 的 ADD COLUMN → 安全；帶 NOT NULL 或 DEFAULT 者 → 破壞性', () => {
    expect(isSafe('ALTER TABLE "Novel" ADD COLUMN "subtitle" TEXT;')).toBe(true);
    expect(isSafe('ALTER TABLE "Novel" ADD COLUMN "subtitle" TEXT NOT NULL;')).toBe(false);
    expect(isSafe(`ALTER TABLE "Novel" ADD COLUMN "subtitle" TEXT DEFAULT '';`)).toBe(false);
  });

  it('INSERT … ON CONFLICT DO NOTHING → 安全；DO UPDATE → 破壞性', () => {
    expect(isSafe(`INSERT INTO "Tag" ("id") VALUES ('a');`)).toBe(true);
    expect(isSafe(`INSERT INTO "Tag" ("id") VALUES ('a') ON CONFLICT ("id") DO NOTHING;`)).toBe(
      true
    );
    // 白名單列的是 `DO NOTHING` 那一種寫法；`DO UPDATE` 會改寫既有列，
    // 與裸 `UPDATE` 的後果相同
    expect(
      isSafe(`INSERT INTO "Tag" ("id") VALUES ('a') ON CONFLICT ("id") DO UPDATE SET "id" = 'b';`)
    ).toBe(false);
  });

  it('COMMENT ON → 安全（純中繼資料）', () => {
    expect(isSafe(`COMMENT ON TABLE "Novel" IS '作品';`)).toBe(true);
  });
});

describe('classifySql：判不出來的一律倒向破壞性（FR-092a）', () => {
  it('以 DO $$ … $$ 包裝的資料搬移 → 破壞性', () => {
    const sql = [
      'DO $$',
      'BEGIN',
      `  UPDATE "Novel" SET "slug" = lower("title") WHERE "slug" IS NULL;`,
      'END',
      '$$;',
    ].join('\n');
    const reasons = classifySql(sql, 'test.sql');
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.join('\n')).toContain('錢字號引用');
  });

  it('未閉合的字串字面量（切不出完整語句）→ 破壞性', () => {
    expect(isSafe(`INSERT INTO "Tag" ("id") VALUES ('a;`)).toBe(false);
  });

  it('註解與空白 MUST NOT 影響判定（migration 檔開頭常是一整段註解）', () => {
    const sql = ['-- 說明；分號在註解裡', '/* 區塊註解 */', 'CREATE TABLE "Tag" ("id" TEXT);'].join(
      '\n'
    );
    expect(isSafe(sql)).toBe(true);
  });
});

describe('detectDestructive：待判定集合的取得（fail-safe 路徑）', () => {
  it('--base 缺漏 → 破壞性（首次部署、標記遺失皆走這裡）', () => {
    const result = detectDestructive({ repoRoot: REPO_ROOT });
    expect(result.destructive).toBe(true);
    expect(result.reasons.join('\n')).toContain('base');
  });

  it('空的待判定集合 → destructive: false（SC-025 後半句：向後相容者要求核准比率 0%）', () => {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    }).trim();
    const result = detectDestructive({ base: head, repoRoot: REPO_ROOT });
    expect(result).toEqual({ destructive: false, reasons: [] });
  });

  it('migrations 目錄不存在 → destructive: true（pathspec 或 cwd 有誤）', () => {
    // 這一格與上一格**成對存在才有意義**：`git diff` 對錯誤的 pathspec
    // 回傳空集合而非錯誤，兩者在輸出上完全無法區分
    const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-destructive-'));
    try {
      const result = detectDestructive({ base: 'HEAD', repoRoot: emptyRoot });
      expect(result.destructive).toBe(true);
      expect(result.reasons.join('\n')).toContain('migrations 目錄不存在');
    } finally {
      fs.rmSync(emptyRoot, { recursive: true, force: true });
    }
  });
});

describe('本階段的實際 migration', () => {
  it('6a_seed_categories 的 INSERT … DO NOTHING → 安全（走全自動路徑）', () => {
    const dir = path.join(REPO_ROOT, 'novelsite/prisma/migrations/postgres');
    const [name] = fs.readdirSync(dir).filter((d) => d.endsWith('_6a_seed_categories'));
    expect(name).toBeDefined();
    const sql = fs.readFileSync(path.join(dir, name, 'migration.sql'), 'utf8');
    expect(classifySql(sql, name)).toEqual([]);
  });
});
