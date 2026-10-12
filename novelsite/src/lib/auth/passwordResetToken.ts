/**
 * 密碼重設憑證層：產生／雜湊／有效期／有效性判準。零 I/O（FEAT-5，data-model.md §2.2）
 * ==================================================================================
 * 比照 `sessionToken.ts` 之於 `session.ts`：本檔 MUST 只 import `node:crypto` 與
 * `@/lib/env`，MUST NOT import repositories、db 或任何帶 `import 'server-only'` 的模組。
 *
 * **為什麼有效性判準寫在這一層而不是服務層**：data-model §2.2 要求
 * 「MUST NOT 於任何呼叫端各自拼裝那兩個條件」，而 `arch.md` §10.2 把四種 status
 * 列為**純函式**的單元案例。判準若只活在 `confirmPasswordReset()` 內，
 * 唯一的驗證方式是 mock 掉整條相依鏈（該檔帶 `server-only` 並拉進 repositories 與
 * `lib/mail`），而那測到的是流程不是判準。
 */
import { createHash, randomBytes } from 'node:crypto';
import { env } from '@/lib/env';

/** 明碼熵：32 bytes（256-bit）。base64url 無填充表示恰為 43 字元 */
const TOKEN_BYTES = 32;

/**
 * 重設憑證的明碼。**只存在於「產生 → 組進信件連結 → 寄出」這一段**，
 * MUST NOT 落庫、MUST NOT 進任何記錄（FR-007）。
 *
 * base64url 而非 hex：同樣的熵少 21 個字元，而重設連結是使用者要從信裡點的東西。
 */
export function generateResetToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/** DB 只存此值（data-model §2）。與 `sessionToken.hashToken` 同一個摘要、同一個理由 */
export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * 失效時刻 = 基準時刻 + `PASSWORD_RESET_TOKEN_TTL_MINUTES`（FR-008）。
 *
 * 分鐘數 MUST 取自設定：信件文案的分鐘數也取自同一個值（`templates.ts`），
 * 兩處漂移會讓信上寫一個假的時間，而使用者要等到連結提早失效才會發現。
 */
export function resetTokenExpiresAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + env.PASSWORD_RESET_TOKEN_TTL_MINUTES * 60_000);
}

/**
 * 有效性判準的四種結果。
 *
 * **為什麼是四種而不是 `Token | null`**：兩個失效原因在 UI 上要顯示**不同**訊息
 * （FR-015：「連結已失效」／「連結已過期」），只回 `null` 就分不出三者，
 * 畫面只能給一句含糊的話。
 */
export type ResetTokenStatus = 'usable' | 'consumed' | 'expired' | 'unknown';

/** 判準所需的兩欄，刻意不收整列 —— 這一層不該知道 `userId` 或 `tokenHash` */
export interface ResetTokenTimestamps {
  consumedAt: Date | null;
  expiresAt: Date;
}

/**
 * ```
 * 可用 ⟺ consumedAt IS NULL AND expiresAt > now()
 * ```
 *
 * **`consumed` 的判斷先於 `expired`**（contracts/password-reset-api.md §2.3 步驟 3b/3c）：
 * 順序反過來時，一把「用過又放到過期」的憑證會被說成「已過期，請重新申請」——
 * 而使用者其實已經成功改過密碼了。
 *
 * 判準是 `expiresAt > now` 而非 `>=`：恰好等於當下即視為已逾期。
 */
export function resetTokenStatus(
  token: ResetTokenTimestamps | null,
  now: Date = new Date()
): ResetTokenStatus {
  if (!token) return 'unknown';
  if (token.consumedAt !== null) return 'consumed';
  if (token.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'usable';
}
