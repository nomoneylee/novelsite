/**
 * 密碼重設憑證的純函式層（FEAT-5 T016，arch.md §10.2「密碼重設憑證（純函式）」）
 * ===========================================================================
 * 覆蓋四件事：明碼熵長度、`sha256` 雜湊、`expiresAt` 計算、
 * 有效性判準的**四種 status**（`usable`／`consumed`／`expired`／`unknown`）。
 *
 * **為什麼判準要是一支可單獨呼叫的純函式**：data-model §2.2 要求
 * 「MUST NOT 於任何呼叫端各自拼裝這兩個條件」，而 arch.md §10.2 把它列為
 * **純函式**的單元案例 —— 判準若只活在 `confirmPasswordReset()` 內，
 * 唯一的驗證方式是連 DB 或 mock 掉整條服務相依，那測到的是流程不是判準。
 * 故 `src/lib/auth/passwordResetToken.ts` 為零 I/O 的憑證層（比照 `sessionToken.ts`），
 * 服務層呼叫它、不自行拼裝。
 */
import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import {
  generateResetToken,
  hashResetToken,
  resetTokenExpiresAt,
  resetTokenStatus,
} from '@/lib/auth/passwordResetToken';
import { env } from '@/lib/env';

describe('generateResetToken（明碼熵長度）', () => {
  it('為 base64url 字元集且解碼後恰為 32 bytes（256-bit）', () => {
    const token = generateResetToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(token, 'base64url').byteLength).toBe(32);
  });

  it('長度為 43 字元（32 bytes 的 base64url 無填充表示）', () => {
    // 寫死 43 是刻意的：熵被改小（例如退成 16 bytes）時字串仍然合法、外觀仍然像一把鑰匙，
    // 只驗字元集不會有任何測試變紅。
    expect(generateResetToken()).toHaveLength(43);
  });

  it('連續產生兩把不相同（隨機而非序號）', () => {
    expect(generateResetToken()).not.toBe(generateResetToken());
  });
});

describe('hashResetToken（DB 只存此值，FR-007）', () => {
  it('為 sha256 的 hex 字串（64 字元）且不等於明碼', () => {
    const token = generateResetToken();
    const hash = hashResetToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toBe(token);
  });

  it('與 node:crypto 的 sha256 逐字元相同（不是另一種摘要）', () => {
    const token = generateResetToken();
    expect(hashResetToken(token)).toBe(createHash('sha256').update(token).digest('hex'));
  });

  it('同一把明碼恆得同一個雜湊（查得到才找得回那一列）', () => {
    const token = generateResetToken();
    expect(hashResetToken(token)).toBe(hashResetToken(token));
  });
});

describe('resetTokenExpiresAt（有效期取自設定，FR-008）', () => {
  it('等於基準時刻加上 PASSWORD_RESET_TOKEN_TTL_MINUTES 分鐘', () => {
    const now = new Date('2026-08-10T00:00:00.000Z');
    const expiresAt = resetTokenExpiresAt(now);
    expect(expiresAt.getTime() - now.getTime()).toBe(env.PASSWORD_RESET_TOKEN_TTL_MINUTES * 60_000);
  });

  it('分鐘數 MUST 取自設定而非寫死（改設定即改結果）', () => {
    // 直接比對「與設定值相乘」而非比對某個固定毫秒數 —— 後者在設定改動時仍會綠，
    // 而信件文案的分鐘數也取自同一個設定值（T027a），兩者漂移會讓信上寫一個假的時間。
    const now = new Date('2026-08-10T00:00:00.000Z');
    expect(resetTokenExpiresAt(now).getTime()).toBe(
      now.getTime() + env.PASSWORD_RESET_TOKEN_TTL_MINUTES * 60_000
    );
  });

  it('未傳入基準時刻時以當下計算', () => {
    const before = Date.now();
    const expiresAt = resetTokenExpiresAt();
    const after = Date.now();
    const ttlMs = env.PASSWORD_RESET_TOKEN_TTL_MINUTES * 60_000;
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + ttlMs);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(after + ttlMs);
  });
});

describe('resetTokenStatus（有效性判準的四種 status，data-model §2.2）', () => {
  const NOW = new Date('2026-08-10T12:00:00.000Z');
  const FUTURE = new Date(NOW.getTime() + 60_000);
  const PAST = new Date(NOW.getTime() - 60_000);

  it('查無此列 → unknown', () => {
    expect(resetTokenStatus(null, NOW)).toBe('unknown');
  });

  it('consumedAt 非空 → consumed（已使用或已被作廢）', () => {
    expect(resetTokenStatus({ consumedAt: PAST, expiresAt: FUTURE }, NOW)).toBe('consumed');
  });

  it('expiresAt 已過 → expired', () => {
    expect(resetTokenStatus({ consumedAt: null, expiresAt: PAST }, NOW)).toBe('expired');
  });

  it('未使用且未逾期 → usable', () => {
    expect(resetTokenStatus({ consumedAt: null, expiresAt: FUTURE }, NOW)).toBe('usable');
  });

  it('已使用且已逾期時回 consumed（consumed 的判斷先於 expired，contracts §2.3 步驟 3b/3c）', () => {
    // 兩種失效在 UI 上是**不同**訊息（FR-015）。順序反過來時，一把「用過又放到過期」的憑證
    // 會被說成「已過期，請重新申請」—— 而使用者其實已經成功改過密碼了。
    expect(resetTokenStatus({ consumedAt: PAST, expiresAt: PAST }, NOW)).toBe('consumed');
  });

  it('expiresAt 恰等於當下視為已逾期（判準是 expiresAt > now，非 >=）', () => {
    expect(resetTokenStatus({ consumedAt: null, expiresAt: NOW }, NOW)).toBe('expired');
  });
});
