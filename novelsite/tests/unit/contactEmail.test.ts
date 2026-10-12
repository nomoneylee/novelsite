/**
 * 對外聯絡信箱的回落與啟動標示（FEAT-5 T040，FR-022）
 * ==================================================
 * FR-022 的兩半：位址 MUST 由部署設定決定（更換不改原始碼），
 * 且**未設定時的回落 MUST 被看見** —— 一個沒有標示的預設值，
 * 等於站上對外公告了一個沒人打算讀的信箱，而隱私權頁把它列為法遵管道（FR-024）。
 *
 * 沿用 `env.test.ts` 的既有作法：四組輸入**直接呼叫純函式**，
 * MUST NOT 以「重設模組快取 + 改寫 `process.env`」間接測試（`arch.md` §3.5）。
 *
 * 本檔與 `env.test.ts` 的分界：那一檔管 `MAIL_MODE` 的接受值與 `production` 的拒絕啟動，
 * 本檔只管 `CONTACT_EMAIL`。同一條規則 MUST NOT 兩處各有一份斷言 ——
 * 改動時只會有一處被改到，另一處會以「還是綠的」掩護一條已經不成立的規則。
 */
import { describe, expect, it } from 'vitest';
import { validateEnv, mailStartupNotices, DEFAULT_CONTACT_EMAIL } from '@/lib/env';

const VALID_SECRET = 'a'.repeat(32);
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

/** 未設定時的那一則標示（與降級模式的「不會真的寄信」是兩件事，故以預設值字串辨識） */
function contactEmailNotice(source: Record<string, string | undefined>) {
  return mailStartupNotices(validateEnv(source), source).find((n) =>
    n.message.includes('CONTACT_EMAIL')
  );
}

describe('CONTACT_EMAIL：未設定時的回落（FR-022）', () => {
  it('未設定時回落至過渡預設值 contact@example.com', () => {
    const result = validateEnv(baseSource({ CONTACT_EMAIL: undefined }));
    expect(result.CONTACT_EMAIL).toBe(DEFAULT_CONTACT_EMAIL);
    // 預設值本身也斷言字面值：它會被隱私權頁當成法遵管道直接列出（FR-024），
    // 悄悄換成別的位址等於悄悄換掉一個對外公告過的收信處
    expect(DEFAULT_CONTACT_EMAIL).toBe('contact@example.com');
  });

  it('有設定時原樣回傳（更換位址 MUST NOT 需要改原始碼，SC-008）', () => {
    const result = validateEnv(baseSource({ CONTACT_EMAIL: 'contact@example.tw' }));
    expect(result.CONTACT_EMAIL).toBe('contact@example.tw');
  });
});

describe('CONTACT_EMAIL：回落時的啟動標示（FR-022）', () => {
  it('未設定時產生標示，且訊息含採用的預設值', () => {
    const notice = contactEmailNotice(baseSource({ CONTACT_EMAIL: undefined }));
    expect(notice, 'CONTACT_EMAIL 未設定卻沒有任何標示 —— 靜默採用預設值即靜默降級').toBeDefined();
    expect(notice?.level).toBe('warn');
    expect(notice?.message).toContain(DEFAULT_CONTACT_EMAIL);
  });

  it('有設定時不產生該標示（標示 MUST 只在真的回落時出現，否則它會被當成雜訊略過）', () => {
    expect(contactEmailNotice(baseSource({ CONTACT_EMAIL: 'contact@example.tw' }))).toBeUndefined();
  });

  /**
   * **顯式設成與預設值相同的字串，仍算「有設定」**。
   * 兩者在 `validated.CONTACT_EMAIL` 上看起來完全一樣，
   * 只有 `source` 分辨得出來 —— 這一則就是那個分辨能力的把關：
   * 少了它，實作可以改成比對回傳值（`=== DEFAULT_CONTACT_EMAIL`）而全綠，
   * 而營運者刻意設定該位址時會收到一則說他沒設定的警示。
   */
  it('顯式設成與預設值相同的位址時不產生標示', () => {
    const notice = contactEmailNotice(baseSource({ CONTACT_EMAIL: DEFAULT_CONTACT_EMAIL }));
    expect(notice, '顯式設定被誤判為未設定 —— 實作比對的是回傳值而不是設定來源').toBeUndefined();
  });
});
