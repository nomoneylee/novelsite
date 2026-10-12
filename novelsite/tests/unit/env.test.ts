import { describe, expect, it } from 'vitest';
import { validateEnv, mailStartupNotices, EXAMPLE_SESSION_SECRET } from '@/lib/env';

const VALID_SECRET = 'a'.repeat(32);
/** FEAT-4：閱讀去重鹽值的合法值（≥ 32 bytes），與工作階段密鑰刻意用不同字元以免互相掩蓋 */
const VALID_VIEW_HASH_SECRET = 'b'.repeat(32);

function baseSource(overrides: Record<string, string | undefined> = {}) {
  return {
    SESSION_SECRET: VALID_SECRET,
    DATABASE_PROVIDER: 'sqlite',
    DATABASE_URL: 'file:./dev.db',
    VIEW_HASH_SECRET: VALID_VIEW_HASH_SECRET,
    ...overrides,
  };
}

describe('validateEnv', () => {
  it('缺少 SESSION_SECRET 時擲錯且指明缺漏項', () => {
    const source = baseSource({ SESSION_SECRET: undefined });
    expect(() => validateEnv(source)).toThrowError(/SESSION_SECRET/);
  });

  it('SESSION_SECRET 長度不足 32 bytes 時擲錯且指明長度不足', () => {
    const source = baseSource({ SESSION_SECRET: 'too-short' });
    expect(() => validateEnv(source)).toThrowError(/長度不足/);
  });

  it('SESSION_SECRET 等於範例值時擲錯且指明為範例值', () => {
    const source = baseSource({ SESSION_SECRET: EXAMPLE_SESSION_SECRET });
    expect(() => validateEnv(source)).toThrowError(/範例值/);
  });

  it('DATABASE_PROVIDER 與 DATABASE_URL 協定不符時擲錯（postgresql + file:）', () => {
    const source = baseSource({
      DATABASE_PROVIDER: 'postgresql',
      DATABASE_URL: 'file:./dev.db',
    });
    expect(() => validateEnv(source)).toThrowError(/不相符/);
  });

  it('DATABASE_PROVIDER 與 DATABASE_URL 協定不符時擲錯（sqlite + postgresql://）', () => {
    const source = baseSource({
      DATABASE_PROVIDER: 'sqlite',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    });
    expect(() => validateEnv(source)).toThrowError(/不相符/);
  });

  it('合法輸入回傳完整設定並套用預設值', () => {
    const result = validateEnv(baseSource());
    expect(result.SESSION_SECRET).toBe(VALID_SECRET);
    expect(result.DATABASE_PROVIDER).toBe('sqlite');
    expect(result.SESSION_TTL_DAYS).toBe(30);
    expect(result.SESSION_ABSOLUTE_TTL_DAYS).toBe(90);
    expect(result.SESSION_SLIDING_THROTTLE_HOURS).toBe(24);
    expect(result.TRUSTED_PROXY_HOPS).toBe(0);
    expect(result.LOGIN_RATE_IP_MAX).toBe(5);
    expect(result.LOGIN_RATE_ACCOUNT_MAX).toBe(5);
    expect(result.REGISTER_RATE_IP_MAX).toBe(3);
  });

  /**
   * FEAT-3 US3 的兩個額度（FR-024a）。預設值取自 spec 的 Clarification：
   * 改密碼 5、開通作者 3 —— 後者更緊，因為「開通作者」一生只需要成功一次。
   */
  it('身分敏感操作的限流額度套用預設值（FR-024a）', () => {
    const result = validateEnv(baseSource());
    expect(result.PASSWORD_CHANGE_RATE_MAX).toBe(5);
    expect(result.AUTHOR_UPGRADE_RATE_MAX).toBe(3);
  });

  it('兩個額度可由環境變數覆寫（整合測試觸發 429 的唯一手段）', () => {
    const result = validateEnv(
      baseSource({ PASSWORD_CHANGE_RATE_MAX: '1', AUTHOR_UPGRADE_RATE_MAX: '2' })
    );
    expect(result.PASSWORD_CHANGE_RATE_MAX).toBe(1);
    expect(result.AUTHOR_UPGRADE_RATE_MAX).toBe(2);
  });

  it('非數字與空字串回退預設值（沿用既有 toInt 語意，MUST NOT 變成 NaN 而讓限流失效）', () => {
    const result = validateEnv(
      baseSource({ PASSWORD_CHANGE_RATE_MAX: 'abc', AUTHOR_UPGRADE_RATE_MAX: '' })
    );
    expect(result.PASSWORD_CHANGE_RATE_MAX).toBe(5);
    expect(result.AUTHOR_UPGRADE_RATE_MAX).toBe(3);
  });
});

/**
 * FEAT-4 T005（data-model.md §9、contracts/internal-modules.md §3）
 * ================================================================
 * 四組輸入**直接呼叫純函式**：`VIEW_HASH_SECRET` 未設定／過短／合法，
 * 以及 `CRON_SECRET` 未設定不阻擋啟動。
 *
 * MUST NOT 以「重設模組快取 + 改寫 `process.env`」的方式間接測試（`arch.md` §3.5）——
 * 那測的是模組載入時序，不是驗證規則，而且會在測試檔之間互相污染。
 */
describe('validateEnv：FEAT-4 的環境變數增量', () => {
  it('缺少 VIEW_HASH_SECRET 時擲錯且指明缺漏項（FR-034，MUST 拒絕啟動）', () => {
    const source = baseSource({ VIEW_HASH_SECRET: undefined });
    expect(() => validateEnv(source)).toThrowError(/VIEW_HASH_SECRET/);
  });

  it('VIEW_HASH_SECRET 長度不足 32 bytes 時擲錯且指明長度不足', () => {
    const source = baseSource({ VIEW_HASH_SECRET: 'b'.repeat(31) });
    expect(() => validateEnv(source)).toThrowError(/VIEW_HASH_SECRET 長度不足/);
  });

  it('VIEW_HASH_SECRET 合法時原樣回傳（鹽值固定、不輪替，回傳值即雜湊輸入）', () => {
    const result = validateEnv(baseSource());
    expect(result.VIEW_HASH_SECRET).toBe(VALID_VIEW_HASH_SECRET);
  });

  /**
   * research R-11：`CRON_SECRET` 的「未設定即拒絕」發生在三個排程 Route Handler 內。
   * 若把它列為啟動期必要變數，本機開發者沒設就啟動不了整個站 —— 而它只影響那三個入口。
   */
  it('CRON_SECRET 未設定 MUST NOT 阻擋啟動，且回傳 undefined 供 handler 據以一律拒絕', () => {
    const result = validateEnv(baseSource({ CRON_SECRET: undefined }));
    expect(result.CRON_SECRET).toBeUndefined();
  });

  it('CRON_SECRET 有設定時原樣回傳（handler 以 timingSafeEqual 比對此值）', () => {
    const result = validateEnv(baseSource({ CRON_SECRET: 'cron-secret-value' }));
    expect(result.CRON_SECRET).toBe('cron-secret-value');
  });

  it('九個可選設定值套用 data-model.md §9 表列的預設值', () => {
    const result = validateEnv(baseSource());
    expect(result.VIEW_DEDUPE_WINDOW_MINUTES).toBe(30);
    expect(result.VIEW_RETENTION_DAYS).toBe(7);
    expect(result.CHAPTER_VIEW_RATE_MAX).toBe(60);
    expect(result.INTERACTION_RATE_MAX).toBe(10);
    expect(result.READING_HISTORY_MAX).toBe(500);
    expect(result.MERGE_BATCH_MAX).toBe(200);
    expect(result.NOTIFICATION_RETENTION_DAYS).toBe(90);
    expect(result.PROGRESS_REPORT_INTERVAL_SECONDS).toBe(30);
    expect(result.CRON_BASE_URL).toBe('http://localhost:3100');
  });

  it('數值設定可由環境變數覆寫（整合測試觸發限流與上限的唯一手段）', () => {
    const result = validateEnv(
      baseSource({
        VIEW_DEDUPE_WINDOW_MINUTES: '1',
        VIEW_RETENTION_DAYS: '2',
        CHAPTER_VIEW_RATE_MAX: '3',
        INTERACTION_RATE_MAX: '4',
        READING_HISTORY_MAX: '5',
        MERGE_BATCH_MAX: '6',
        NOTIFICATION_RETENTION_DAYS: '7',
        PROGRESS_REPORT_INTERVAL_SECONDS: '8',
        CRON_BASE_URL: 'http://localhost:9999',
      })
    );
    expect(result.VIEW_DEDUPE_WINDOW_MINUTES).toBe(1);
    expect(result.VIEW_RETENTION_DAYS).toBe(2);
    expect(result.CHAPTER_VIEW_RATE_MAX).toBe(3);
    expect(result.INTERACTION_RATE_MAX).toBe(4);
    expect(result.READING_HISTORY_MAX).toBe(5);
    expect(result.MERGE_BATCH_MAX).toBe(6);
    expect(result.NOTIFICATION_RETENTION_DAYS).toBe(7);
    expect(result.PROGRESS_REPORT_INTERVAL_SECONDS).toBe(8);
    expect(result.CRON_BASE_URL).toBe('http://localhost:9999');
  });

  it('非數字與空字串回退預設值（MUST NOT 變成 NaN 而讓去重窗口與上限失效）', () => {
    const result = validateEnv(
      baseSource({ VIEW_DEDUPE_WINDOW_MINUTES: 'abc', MERGE_BATCH_MAX: '' })
    );
    expect(result.VIEW_DEDUPE_WINDOW_MINUTES).toBe(30);
    expect(result.MERGE_BATCH_MAX).toBe(200);
  });
});

/**
 * FEAT-5 T004（data-model.md §5、research R-3／R-15）
 * ==================================================
 * 本節只管 `MAIL_MODE` 的**接受值**與 `production` 的三道拒絕啟動，外加降級模式的啟動警示。
 *
 * **「未設定時依 `NODE_ENV` 推導」刻意不在此斷言**：那一條歸 `tests/unit/mailSelect.test.ts`
 * （T014）。同一條規則若兩處各有一份斷言，改動時只會有一處被改到，另一處會以「還是綠的」
 * 掩護一個已經不成立的規則。
 *
 * 沿用本檔既有做法：四組輸入**直接呼叫純函式**，MUST NOT 以「重設模組快取 + 改寫
 * `process.env`」間接測試（`arch.md` §3.5）。啟動記錄因此拆成
 * `mailStartupNotices()`（純函式，回傳要印的內容）與模組載入時的 `console` 呼叫兩半 ——
 * 副作用一律在 `validateEnv()` 之外（research R-15）。
 */
describe('validateEnv：FEAT-5 的 MAIL_MODE 與郵件設定值', () => {
  /** `MAIL_MODE=production` 下三個 MUST 齊備的來源，供「單獨抽掉其中一個」使用 */
  function productionSource(overrides: Record<string, string | undefined> = {}) {
    return baseSource({
      MAIL_MODE: 'production',
      RESEND_API_KEY: 're_test_key',
      MAIL_FROM: 'NovelSite <noreply@example.tw>',
      NEXT_PUBLIC_SITE_URL: 'https://example.tw',
      ...overrides,
    });
  }

  it('三個 MAIL_MODE 值皆被接受（FR-002b）', () => {
    expect(validateEnv(productionSource()).MAIL_MODE).toBe('production');
    expect(validateEnv(baseSource({ MAIL_MODE: 'memory' })).MAIL_MODE).toBe('memory');
    expect(validateEnv(baseSource({ MAIL_MODE: 'console' })).MAIL_MODE).toBe('console');
  });

  it('MAIL_MODE 為三值之外時擲錯且指名該變數（拼錯 MUST NOT 靜默退到某個模式）', () => {
    expect(() => validateEnv(baseSource({ MAIL_MODE: 'prod' }))).toThrowError(/MAIL_MODE/);
  });

  it('MAIL_MODE=production 缺 RESEND_API_KEY 時擲錯且訊息指名缺漏項（SC-013）', () => {
    expect(() => validateEnv(productionSource({ RESEND_API_KEY: undefined }))).toThrowError(
      /RESEND_API_KEY/
    );
  });

  it('MAIL_MODE=production 缺 MAIL_FROM 時擲錯且訊息指名缺漏項（SC-013）', () => {
    expect(() => validateEnv(productionSource({ MAIL_FROM: undefined }))).toThrowError(/MAIL_FROM/);
  });

  /**
   * FR-016a／SC-013a：重設連結是**絕對網址**。這個值靜默回落到 `https://novelsite.tw`
   * 對 metadata 只是標註不準，對重設信卻是「每一封信的連結都指向別的網站，
   * 而系統仍回報已寄出」——SC-001 表面通過、實際全滅。
   */
  it('MAIL_MODE=production 未明示 NEXT_PUBLIC_SITE_URL 時擲錯且指名該變數（SC-013a）', () => {
    expect(() => validateEnv(productionSource({ NEXT_PUBLIC_SITE_URL: undefined }))).toThrowError(
      /NEXT_PUBLIC_SITE_URL/
    );
  });

  it('memory 與 console 在零郵件憑證下不擲錯（SC-010 的前置）', () => {
    expect(() => validateEnv(baseSource({ MAIL_MODE: 'memory' }))).not.toThrow();
    expect(() => validateEnv(baseSource({ MAIL_MODE: 'console' }))).not.toThrow();
  });

  /**
   * SC-013 的另一半：**沒有警示的降級就是靜默降級**。
   * 「不會真的寄信」若只寫在文件裡，正式環境誤設成 memory 時，
   * 站方會在完全沒有徵兆的情況下對每一位使用者回報「重設信已寄出」。
   */
  it('memory 與 console 產生「目前不會真的寄信」的啟動警示（SC-013）', () => {
    for (const mode of ['memory', 'console'] as const) {
      const source = baseSource({ MAIL_MODE: mode });
      const notices = mailStartupNotices(validateEnv(source), source);
      const warning = notices.find((n) => n.message.includes('目前不會真的寄信'));
      expect(warning, `MAIL_MODE=${mode} 未產生降級警示`).toBeDefined();
      expect(warning?.level).toBe('warn');
    }
  });

  it('MAIL_MODE=production 且憑證齊備時不產生降級警示', () => {
    const source = productionSource();
    const notices = mailStartupNotices(validateEnv(source), source);
    expect(notices.some((n) => n.message.includes('目前不會真的寄信'))).toBe(false);
  });

  /**
   * 啟動記錄 MUST NOT 洩漏憑證：`RESEND_API_KEY` 是唯一會出現在這個情境裡的明碼憑證，
   * 而啟動記錄是站上少數會被整段貼進 issue 的輸出。
   */
  it('啟動記錄不含 RESEND_API_KEY 明碼', () => {
    const source = productionSource();
    const notices = mailStartupNotices(validateEnv(source), source);
    expect(notices.some((n) => n.message.includes('re_test_key'))).toBe(false);
  });
});
