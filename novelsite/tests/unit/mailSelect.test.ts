/**
 * FEAT-5 T014：`MAIL_MODE` 選到哪一支寄送實作（research R-3、contracts/internal-modules.md §2）
 * ===========================================================================================
 * 兩件事在此把關：
 *
 * 1. **三個值各選到哪支實作** —— 選錯的後果不對稱：把 `production` 選成 `console`，
 *    正式站一封信也不會寄，而每一位使用者看到的仍是那句「重設信已寄出」。
 * 2. **未設定時依 `NODE_ENV` 推導** —— 這一條**只在本檔斷言**。
 *    `env.test.ts`（T004）刻意不重覆，同一條規則兩處斷言時，改動只會有一處被改到。
 */
import { describe, expect, it } from 'vitest';
import { createMailer } from '@/lib/mail';
import { ConsoleMailer } from '@/lib/mail/consoleMailer';
import { MemoryMailer } from '@/lib/mail/memoryMailer';
import { ResendMailer } from '@/lib/mail/resendMailer';
import { validateEnv } from '@/lib/env';

function baseSource(overrides: Record<string, string | undefined> = {}) {
  return {
    SESSION_SECRET: 'a'.repeat(32),
    DATABASE_PROVIDER: 'sqlite',
    DATABASE_URL: 'file:./dev.db',
    VIEW_HASH_SECRET: 'b'.repeat(32),
    ...overrides,
  };
}

describe('createMailer：三個 MAIL_MODE 值各選到哪支實作', () => {
  it('production → ResendMailer（唯一會真的對外送信的實作）', () => {
    expect(createMailer('production')).toBeInstanceOf(ResendMailer);
  });

  it('memory → MemoryMailer（寫入 outbox，供三套自動化測試斷言內容）', () => {
    expect(createMailer('memory')).toBeInstanceOf(MemoryMailer);
  });

  it('console → ConsoleMailer（把含重設連結的全文印到主控台，SC-014）', () => {
    expect(createMailer('console')).toBeInstanceOf(ConsoleMailer);
  });
});

describe('MAIL_MODE 未設定時依 NODE_ENV 推導（FR-002b）', () => {
  it('NODE_ENV=production → production', () => {
    const result = validateEnv(
      baseSource({
        NODE_ENV: 'production',
        RESEND_API_KEY: 're_test_key',
        MAIL_FROM: 'NovelSite <noreply@example.tw>',
        NEXT_PUBLIC_SITE_URL: 'https://example.tw',
      })
    );
    expect(result.MAIL_MODE).toBe('production');
  });

  /**
   * 推導出的 `production` **一樣要通過那三道拒絕啟動**——
   * 若只對顯式設定的 `MAIL_MODE=production` 檢查，正式部署忘了寫這一行就會靜默跳過全部把關。
   */
  it('NODE_ENV=production 且缺憑證時仍拒絕啟動（推導出的模式不得享有豁免）', () => {
    expect(() => validateEnv(baseSource({ NODE_ENV: 'production' }))).toThrowError(
      /RESEND_API_KEY/
    );
  });

  it('NODE_ENV 非 production（development／test／未設定）→ console', () => {
    expect(validateEnv(baseSource({ NODE_ENV: 'development' })).MAIL_MODE).toBe('console');
    expect(validateEnv(baseSource({ NODE_ENV: 'test' })).MAIL_MODE).toBe('console');
    expect(validateEnv(baseSource()).MAIL_MODE).toBe('console');
  });

  it('顯式的 MAIL_MODE 覆蓋推導結果（.env.test 的 memory 正是靠這一條生效）', () => {
    const result = validateEnv(baseSource({ NODE_ENV: 'production', MAIL_MODE: 'memory' }));
    expect(result.MAIL_MODE).toBe('memory');
  });
});
