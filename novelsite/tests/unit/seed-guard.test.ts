/**
 * `db:seed` 放行守衛的真值表（FEAT-6 T006／FR-066，research R-1）
 * ================================================================
 * 判定採 **allowlist**：只在「可證明為非正式環境」時放行，判不出來的一律落在拒絕側。
 *
 * 這支測試存在的理由：守衛判錯只有兩種結果，而**兩種都不會有錯誤訊息**——
 * 判太鬆是正式資料庫被清空，判太緊是開發者的 `npm run db:seed` 突然不能用。
 * 前者沒有復原路徑，所以真值表 MUST 逐格釘住，MUST NOT 只測「正式環境被擋下」那一格。
 */
import { describe, it, expect } from 'vitest';
import { isSeedAllowed, redactDatabaseUrl, seedBlockedMessage } from '../../prisma/seedGuard';

describe('isSeedAllowed：provider × NODE_ENV × 放行旗標', () => {
  it('sqlite + 非 production → 放行（本機開發，行為 MUST 與 FEAT-6 之前完全相同）', () => {
    expect(isSeedAllowed({ DATABASE_PROVIDER: 'sqlite', NODE_ENV: 'development' })).toBe(true);
    expect(isSeedAllowed({ DATABASE_PROVIDER: 'sqlite', NODE_ENV: 'test' })).toBe(true);
    expect(isSeedAllowed({ DATABASE_PROVIDER: 'sqlite' })).toBe(true);
  });

  it('DATABASE_PROVIDER 未設定 → 視同 sqlite（`.env` 不含此變數是本專案開發軌的常態）', () => {
    // src/lib/env.ts:137 的回落值同為 sqlite。此處若改判為「證明不了 → 拒絕」，
    // 受害的是每一位 clone 下來直接跑 `npm run db:seed` 的開發者（契約 §1.4 明列行為 MUST 不變）。
    expect(isSeedAllowed({})).toBe(true);
    expect(isSeedAllowed({ NODE_ENV: 'development' })).toBe(true);
  });

  it('postgresql → 一律不放行（不論 NODE_ENV 為何）', () => {
    expect(isSeedAllowed({ DATABASE_PROVIDER: 'postgresql', NODE_ENV: 'development' })).toBe(false);
    expect(isSeedAllowed({ DATABASE_PROVIDER: 'postgresql', NODE_ENV: 'production' })).toBe(false);
    // 正式主機上手開的殼層，NODE_ENV 通常是空的——這一格正是只看 NODE_ENV 會漏接的那一格
    expect(isSeedAllowed({ DATABASE_PROVIDER: 'postgresql' })).toBe(false);
  });

  it('sqlite + NODE_ENV=production → 不放行', () => {
    expect(isSeedAllowed({ DATABASE_PROVIDER: 'sqlite', NODE_ENV: 'production' })).toBe(false);
  });

  it('任一情形 + 旗標為 "1" → 放行（§10.5 的 PostgreSQL 軌雙軌驗證靠這一格）', () => {
    expect(
      isSeedAllowed({
        DATABASE_PROVIDER: 'postgresql',
        NODE_ENV: 'production',
        SEED_ALLOW_DESTRUCTIVE: '1',
      })
    ).toBe(true);
    expect(isSeedAllowed({ DATABASE_PROVIDER: 'sqlite', SEED_ALLOW_DESTRUCTIVE: '1' })).toBe(true);
  });

  it('旗標為 "0"／"true"／空字串 → 皆不放行（只認字面上的 "1"）', () => {
    // 「有設就算」的實作會讓 `SEED_ALLOW_DESTRUCTIVE=0` 這種**看起來是關閉**的寫法變成放行
    for (const flag of ['0', 'true', '', 'yes', 'false']) {
      expect(isSeedAllowed({ DATABASE_PROVIDER: 'postgresql', SEED_ALLOW_DESTRUCTIVE: flag })).toBe(
        false
      );
    }
  });
});

describe('redactDatabaseUrl：密碼 MUST NOT 出現在任何輸出', () => {
  it('PostgreSQL 連線字串的密碼段改為 ***', () => {
    expect(redactDatabaseUrl('postgresql://novelsite_app:s3cr3t@postgres:5432/novelsite')).toBe(
      'postgresql://novelsite_app:***@postgres:5432/novelsite'
    );
  });

  it('SQLite 檔案連線字串與未設定值原樣輸出（沒有密碼可遮）', () => {
    expect(redactDatabaseUrl('file:./prisma/dev.db')).toBe('file:./prisma/dev.db');
    expect(redactDatabaseUrl(undefined)).toBe('(未設定)');
  });
});

describe('seedBlockedMessage：訊息內容（契約 cli-commands §1.3）', () => {
  const message = seedBlockedMessage({
    DATABASE_PROVIDER: 'postgresql',
    DATABASE_URL: 'postgresql://novelsite_app:s3cr3t@postgres:5432/novelsite',
    NODE_ENV: 'production',
  });

  it('含 provider、去除密碼後的連線字串，以及「會先清空全部資料表」', () => {
    expect(message).toContain('postgresql');
    expect(message).toContain('postgresql://novelsite_app:***@postgres:5432/novelsite');
    expect(message).not.toContain('s3cr3t');
    expect(message).toContain('清空全部資料表');
  });

  it('MUST NOT 提示放行旗標的用法——錯誤訊息會被複製貼上，而那正是誤操作的成因', () => {
    expect(message).not.toContain('SEED_ALLOW_DESTRUCTIVE');
  });
});
