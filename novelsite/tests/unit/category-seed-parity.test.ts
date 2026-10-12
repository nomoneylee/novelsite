import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CATEGORIES } from '@/lib/mockData';

/**
 * T031（FEAT-6）：兩軌 migration 的分類值 MUST 與 `mockData.ts` 完全一致
 * ======================================================================
 * FR-086 要求參考分類由**冪等 migration** 建立（人工步驟數 0），
 * 而 `prisma/seed.ts` 仍會寫入同一批分類（開發軌）。
 * **兩處定義同時存在，漂移是遲早的事**，且漂移的症狀是
 * 「開發環境的分類頁與正式環境長得不一樣」——不會有任何錯誤訊息。
 *
 * `color`／`bgColor` 是色碼：**謄錯一個字元不會有任何訊號**，
 * 這正是本測試存在的理由（data-model.md §2 明列「MUST 自 mockData 逐欄複製」）。
 *
 * 對應規則（data-model.md §2）：
 * - `id` = `slug` = mockData 的 `id`
 * - `label`／`emoji`／`description`／`color`／`bgColor` 直接取自 mockData
 * - `sortOrder` = 陣列索引（0 起算）
 */

const MIGRATION_DIR = '6a_seed_categories';

const TRACKS = ['postgres', 'sqlite'] as const;

/** 八個欄位，順序即 INSERT 的欄位順序 */
const COLUMNS = [
  'id',
  'slug',
  'label',
  'emoji',
  'description',
  'color',
  'bgColor',
  'sortOrder',
] as const;

interface ParsedRow {
  id: string;
  slug: string;
  label: string;
  emoji: string;
  description: string;
  color: string;
  bgColor: string;
  sortOrder: number;
}

function migrationPath(track: (typeof TRACKS)[number]): string {
  const base = path.resolve(__dirname, '../../prisma/migrations', track);
  const dirs = fs.existsSync(base)
    ? fs.readdirSync(base).filter((d) => d.endsWith(`_${MIGRATION_DIR}`))
    : [];
  if (dirs.length !== 1) {
    throw new Error(
      `[${track}] 應恰有一個 *_${MIGRATION_DIR} migration 目錄，實得 ${dirs.length} 個：${dirs.join('、')}`
    );
  }
  return path.join(base, dirs[0], 'migration.sql');
}

/**
 * 自 SQL 解析出每一列的八欄值。
 *
 * 只解析 `VALUES` 之後的每一組括號，並以 SQL 字串字面量的規則切分
 * （單引號成對，`''` 為跳脫的單引號）——**MUST NOT 用逗號直接 split**：
 * `description` 內含中文逗號不影響，但色碼 `rgba(157, 78, 221, 0.1)` 裡的逗號會把它切爛，
 * 而切爛之後的比對仍可能「剛好通過」，那比紅燈更糟。
 */
function parseRows(sql: string, track: string): ParsedRow[] {
  const rows: ParsedRow[] = [];

  // 逐字掃描：只在「不在字串內」時才認括號與逗號
  let i = 0;
  const valuesIdx = sql.toUpperCase().indexOf('VALUES');
  if (valuesIdx < 0) throw new Error(`[${track}] migration.sql 內找不到 VALUES`);
  i = valuesIdx + 'VALUES'.length;

  while (i < sql.length) {
    // 找下一個 '('
    while (i < sql.length && sql[i] !== '(' && sql[i] !== ';') i++;
    if (i >= sql.length || sql[i] === ';') break;
    i++; // 跳過 '('

    const fields: string[] = [];
    let current = '';
    let inString = false;

    while (i < sql.length) {
      const ch = sql[i];

      if (inString) {
        if (ch === "'") {
          if (sql[i + 1] === "'") {
            current += "'";
            i += 2;
            continue;
          }
          inString = false;
          i++;
          continue;
        }
        current += ch;
        i++;
        continue;
      }

      if (ch === "'") {
        inString = true;
        i++;
        continue;
      }
      if (ch === ',') {
        fields.push(current.trim());
        current = '';
        i++;
        continue;
      }
      if (ch === ')') {
        fields.push(current.trim());
        i++;
        break;
      }
      current += ch;
      i++;
    }

    if (fields.length !== COLUMNS.length) {
      throw new Error(
        `[${track}] 某一列解析出 ${fields.length} 欄，應為 ${COLUMNS.length} 欄：${fields.join(' | ')}`
      );
    }

    rows.push({
      id: fields[0],
      slug: fields[1],
      label: fields[2],
      emoji: fields[3],
      description: fields[4],
      color: fields[5],
      bgColor: fields[6],
      sortOrder: Number(fields[7]),
    });

    // VALUES 清單在「`)` 之後不是 `,`」時結束。少了這一步，
    // postgres 軌尾端的 `ON CONFLICT ("slug") DO NOTHING` 會被當成第七列解析
    while (i < sql.length && /\s/.test(sql[i])) i++;
    if (sql[i] !== ',') break;
    i++;
  }

  return rows;
}

/** 依 data-model.md §2 的對應規則，自 mockData 推出的期望值 */
const EXPECTED: ParsedRow[] = CATEGORIES.map((c, index) => ({
  id: c.id,
  slug: c.id,
  label: c.label,
  emoji: c.emoji,
  description: c.description,
  color: c.color,
  bgColor: c.bgColor,
  sortOrder: index,
}));

describe('T031：6a_seed_categories 兩軌與 mockData 的分類定義一致（FR-086、SC-026）', () => {
  it('mockData 的分類恰為 6 筆（來源本身變了，下面的比對就失去意義）', () => {
    expect(CATEGORIES).toHaveLength(6);
  });

  for (const track of TRACKS) {
    describe(`${track} 軌`, () => {
      const sql = fs.readFileSync(migrationPath(track), 'utf8');
      const rows = parseRows(sql, track);

      it('恰為 6 筆', () => {
        expect(rows).toHaveLength(6);
      });

      it('八欄逐筆與 mockData 相符（色碼謄錯不會有任何錯誤訊息，只能靠這裡）', () => {
        expect(rows).toEqual(EXPECTED);
      });

      it('冪等語句存在（重跑一次仍是 6 筆，SC-026）', () => {
        const upper = sql.toUpperCase();
        if (track === 'postgres') {
          expect(upper).toContain('ON CONFLICT');
          expect(upper).toContain('DO NOTHING');
        } else {
          expect(upper).toContain('INSERT OR IGNORE');
        }
      });
    });
  }

  it('兩軌的值完全相同（兩軌分歧時，正式與開發環境的分類頁會不一樣）', () => {
    const [pg, sqlite] = TRACKS.map((t) => parseRows(fs.readFileSync(migrationPath(t), 'utf8'), t));
    expect(pg).toEqual(sqlite);
  });
});
