import 'server-only';
import { env } from '@/lib/env';
import { logSecurityEvent } from '@/lib/auth/audit';
import { hashPassword } from '@/lib/auth/password';
import { accountKey, rateLimitStore } from '@/lib/auth/rateLimit';
import {
  generateResetToken,
  hashResetToken,
  resetTokenExpiresAt,
  resetTokenStatus,
} from '@/lib/auth/passwordResetToken';
import { revokeAllSessionsForUser } from '@/lib/auth/session';
import { mailer } from '@/lib/mail';
import { logMailAttempt } from '@/lib/mail/log';
import { passwordResetMail } from '@/lib/mail/templates';
import { MailSendError } from '@/lib/mail/types';
import { passwordResetTokensRepo, usersRepo, withTransaction } from '@/lib/repositories';
import { ServiceError, parseOrThrow } from '@/lib/services/errors';
import { extractRawEmail, type RequestCtx } from '@/lib/services/authService';
import { passwordResetConfirmSchema, passwordResetRequestSchema } from '@/lib/validation/auth';

/**
 * 密碼重設（FEAT-5 5-B，contracts/password-reset-api.md）
 * ======================================================
 * 申請與確認兩件事，非對稱到近乎相反：
 *
 *   - **申請**（`requestPasswordReset`）的回應**永遠一樣**（FR-006）。
 *     任何差異——狀態碼、主體、回應時間——都是一條枚舉管道。
 *   - **確認**（`confirmPasswordReset`）逐一回答失敗原因（FR-015）。
 *     token 是 256-bit 隨機值，猜中的機率與「這個 Email 存不存在」無關，
 *     這裡沒有可洩漏的東西，而使用者必須知道連結為什麼不能用。
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

/**
 * 背景寄送。**整個函式體包在 try/catch 內，例外只進記錄**（FR-006a：
 * MUST NOT 使行程異常終止）。
 *
 * **這也是為什麼 outbox 驗證是必要的**：本函式吞掉一切例外之後，
 * 「信根本沒寄」在畫面上與「寄成功」完全一樣
 * （`tests/integration/password-reset-after.test.ts` 是唯一的證明）。
 */
async function deliverPasswordReset(email: string, ip: string): Promise<void> {
  try {
    const user = await usersRepo.findByEmail(email);
    if (!user) {
      // 不存在的帳號在此**什麼都不做**：不建憑證、不寄信、不回報差異（FR-006）
      logSecurityEvent({ event: 'auth.password_reset_requested', ip, result: 'no_account' });
      return;
    }

    try {
      await passwordResetTokensRepo.deletePastForUser(user.id);
    } catch {
      // FR-011a：順帶清理。清理失敗 MUST NOT 導致申請失敗（data-model §3）
    }

    const token = generateResetToken();
    // 交易內先作廢再建立（FR-010）：一個帳號同時只有一把有效鑰匙。
    // 不用部分唯一索引 —— 那是雙軌分歧點（research R-9）
    await withTransaction(async (tx) => {
      await passwordResetTokensRepo.invalidateActiveForUser(user.id, tx);
      await passwordResetTokensRepo.create(
        { userId: user.id, tokenHash: hashResetToken(token), expiresAt: resetTokenExpiresAt() },
        tx
      );
    });
    logSecurityEvent({ event: 'auth.password_reset_requested', ip, result: 'token_issued' });

    // 收件人是**帳號的信箱**而非送入端點的那一串：兩者可能只差大小寫，
    // 但用送入值就等於讓申請者指定收件位址
    const message = passwordResetMail(user.email, token);
    // 寄送成功與失敗兩種結果皆經 `logMailAttempt()` 輸出（contracts §1.4 的後兩列）——
    // MUST NOT 另外寫一份含正文或連結的記錄（FR-004）
    try {
      await mailer.send(message);
      logMailAttempt({ mode: env.MAIL_MODE, message, result: 'sent' });
    } catch (err) {
      logMailAttempt({
        mode: env.MAIL_MODE,
        message,
        result: 'failed',
        errorCode: err instanceof MailSendError ? err.cause : 'UNKNOWN',
      });
    }
  } catch (err) {
    logSecurityEvent({ event: 'auth.password_reset_requested', ip, result: 'deliver_failed' });
    console.error('[passwordReset] 背景作業失敗', err);
  }
}

/**
 * 申請重設：**只做限流與驗證**，把「查 DB、發憑證、寄信」包成 `deliver` 交還呼叫端。
 *
 * **服務層 MUST NOT 自己呼叫 `after()`**（contracts/internal-modules §4.1）：
 * 那是框架的請求期 API，服務層一旦依賴它就無法在單元測試中直接呼叫。
 * 「什麼時候跑」留在 Route Handler，「跑什麼」留在服務層。
 *
 * 限流的兩鍵 MUST 早於查 DB（FR-005）：先查 DB 再限流會讓 429 只發生在存在的帳號上，
 * 而 429 與 200 的差異本身就是枚舉管道。
 */
export async function requestPasswordReset(
  input: unknown,
  ctx: RequestCtx
): Promise<{ deliver: () => Promise<void> }> {
  // 位址鍵沿用 `LOGIN_RATE_IP_MAX`（5 次/分鐘）：與登入同性質，防的是枚舉掃描。
  // MUST NOT 另訂變數（FR-005a）—— 多一個就多一個會與登入漂移的值
  const ipLimit = await rateLimitStore.hit(
    `pwreset:ip:${ctx.ip}`,
    MINUTE_MS,
    env.LOGIN_RATE_IP_MAX
  );
  if (!ipLimit.allowed) {
    logSecurityEvent({
      event: 'auth.rate_limited',
      ip: ctx.ip,
      result: 'password_reset_ip_limited',
    });
    throw new ServiceError('RATE_LIMITED', '請稍後再試', {
      retryAfterSeconds: ipLimit.retryAfterSeconds,
    });
  }

  // 帳號鍵取自**原始輸入**，對所有送入值一律計數（FR-005）：
  // 只對存在的帳號計數時，未註冊者第 4 次回 200、已註冊者回 429 —— 差異即洩漏
  const rawEmail = extractRawEmail(input);
  const accountLimit = await rateLimitStore.hit(
    `pwreset:account:${accountKey(rawEmail)}`,
    HOUR_MS,
    env.PASSWORD_RESET_RATE_ACCOUNT_MAX
  );
  if (!accountLimit.allowed) {
    logSecurityEvent({
      event: 'auth.rate_limited',
      ip: ctx.ip,
      result: 'password_reset_account_limited',
    });
    throw new ServiceError('RATE_LIMITED', '請稍後再試', {
      retryAfterSeconds: accountLimit.retryAfterSeconds,
    });
  }

  // 400 只回答「這串字不是 Email」，與帳號是否註冊無關，故不洩漏帳號存在性
  const { email } = parseOrThrow(passwordResetRequestSchema, input);

  return { deliver: () => deliverPasswordReset(email, ctx.ip) };
}

/**
 * 以憑證設定新密碼（contracts §2.3 的執行順序）。
 *
 * **`consume` MUST 早於改密碼**：反過來的話，中間任何一步失敗都會留下一把仍可用的鑰匙。
 * **成功後不簽發工作階段**：剛剛才撤銷該使用者的全部 session，當下立刻簽發一張新的
 * 與 FR-012 的意圖相左 —— 導回登入頁請使用者以新密碼登入。
 */
export async function confirmPasswordReset(input: unknown): Promise<void> {
  const { token, password } = parseOrThrow(passwordResetConfirmSchema, input);

  const row = await passwordResetTokensRepo.findByHash(hashResetToken(token));
  // 判準的唯一實作處是 `resetTokenStatus()`（data-model §2.2）——
  // MUST NOT 在此自行拼裝 `consumedAt` 與 `expiresAt` 那兩個條件。
  // `row === null` 恰是它的 `unknown`，寫出來只為了讓下方取得 `row.id` 時型別收斂
  const status = resetTokenStatus(row);
  if (row === null || status !== 'usable') {
    throw status === 'expired'
      ? new ServiceError('EXPIRED_TOKEN', '重設連結已過期，請重新申請')
      : new ServiceError('INVALID_TOKEN', '重設連結已失效，請重新申請');
  }

  // 併發搶用：兩個請求同時拿同一把 token 進來時兩者都會通過上方判準，
  // 只有 `updateMany` 的受影響列數分得出誰真的拿到了（data-model §4.1）
  const consumed = await passwordResetTokensRepo.consume(row.id);
  if (consumed === 0) {
    throw new ServiceError('INVALID_TOKEN', '重設連結已失效，請重新申請');
  }

  await usersRepo.updatePasswordHash(row.userId, await hashPassword(password));
  // FR-012／SC-004：帳號被盜用時，重設密碼的意義就是把入侵者踢出去
  await revokeAllSessionsForUser(row.userId);
  // 同使用者其餘未使用的憑證一併作廢：一次重設只該消耗掉全部在外的鑰匙
  await passwordResetTokensRepo.invalidateActiveForUser(row.userId);

  logSecurityEvent({ event: 'auth.password_reset_confirmed', ip: '-', result: 'password_updated' });
}
