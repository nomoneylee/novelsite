import 'server-only';
import { usersRepo, withTransaction } from '@/lib/repositories';
import { issueSession, revokeAllSessionsForUser } from '@/lib/auth/session';
import { rateLimitStore } from '@/lib/auth/rateLimit';
import { env } from '@/lib/env';
import {
  updateProfileSchema,
  becomeAuthorSchema,
  changePasswordSchema,
} from '@/lib/validation/profile';
import { changePassword as changePasswordCore, AuthServiceError } from './authService';
import { rebuildSearchTextForAuthor } from './novelService';
import { ServiceError, parseOrThrow, translateDbError } from './errors';
import type { RequestCtx } from './authService';

/**
 * 個人設定的業務規則（FR-021／FR-023／FR-024／FR-024a、contracts/internal-modules.md §1.3）
 * ==========================================================================================
 * `arch.md` §2.3 的服務清單沒有 user／profile 這一項，本檔為加性新增
 * （理由見 plan.md 的 Complexity Tracking）：四個個人設定 Action 需要一個落點，
 * 而併進 `authService` 會讓暱稱與簡介的更新和登入註冊的限流、帳號枚舉防護共處一檔。
 *
 * **改密碼不在此重複實作**：沿用既有 `authService.changePassword`（contracts §1.3），
 * 本檔只負責它外面那一層限流。
 */

export { ServiceError } from './errors';

const RATE_WINDOW_MS = 15 * 60_000;

/**
 * 身分敏感操作的限流（FR-024a）。
 *
 * 鍵為**使用者識別碼**（不是位址）：要防的是「持有有效工作階段的人反覆試舊密碼」，
 * 而那個人換一條網路就換一個位址。
 * 時間窗沿用 FEAT-1 登入的**帳號窗**（15 分鐘）—— spec 明文「沿用既有登入限流窗」，
 * 而登入的兩個窗之中，以身分為鍵的是帳號窗。
 */
async function enforceRateLimit(key: string, max: number): Promise<void> {
  const result = await rateLimitStore.hit(key, RATE_WINDOW_MS, max);
  if (!result.allowed) {
    throw new ServiceError('RATE_LIMITED', '操作太頻繁，請稍後再試', {
      retryAfterSeconds: result.retryAfterSeconds,
    });
  }
}

/** `authService` 的錯誤語意與本層一致，轉成同一個型別供 Action 統一處理 */
function fromAuthError(err: unknown): never {
  if (err instanceof AuthServiceError) {
    throw new ServiceError(err.code, err.message, {
      ...(err.fields ? { fields: err.fields } : {}),
      ...(err.retryAfterSeconds !== undefined ? { retryAfterSeconds: err.retryAfterSeconds } : {}),
    });
  }
  throw translateDbError(err, '操作衝突，請重試');
}

/**
 * 更新個人資料（FR-021、FR-028a）。
 *
 * `penName` 異動時，個資更新與**該作者全部作品**的搜尋預算重算位於**同一交易**：
 * 先提交個資再事後補算，中途失敗會留下「筆名已改但舊筆名仍搜得到」——
 * 那個狀態沒有任何錯誤訊息，只有搜尋結果不對。
 *
 * 筆名沒變時**不進重算**：每次存個資都改寫全部作品的排序鍵，等於作者改一次頭像色
 * 就把自己的作品全部推到搜尋結果最前面。
 */
export async function updateProfile(uid: string, input: unknown): Promise<void> {
  const data = parseOrThrow(updateProfileSchema, input);

  const user = await usersRepo.findById(uid);
  if (!user) throw new ServiceError('UNAUTHENTICATED', '使用者不存在');

  // 空字串 = 清空（落庫為 null）；未帶 = 不動。兩者在這一行分流
  const nextPenName =
    data.penName === undefined ? undefined : data.penName === '' ? null : data.penName;
  const penNameChanged = nextPenName !== undefined && nextPenName !== user.penName;

  try {
    await withTransaction(async (tx) => {
      await usersRepo.updateProfile(
        uid,
        {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(nextPenName !== undefined ? { penName: nextPenName } : {}),
          ...(data.bio !== undefined ? { bio: data.bio } : {}),
          ...(data.avatarColor !== undefined ? { avatarColor: data.avatarColor } : {}),
        },
        tx
      );

      if (penNameChanged) {
        await rebuildSearchTextForAuthor(tx, uid);
      }
    });
  } catch (err) {
    throw translateDbError(err, '個人資料更新衝突，請重試');
  }
}

/**
 * 改密碼（FR-024a 的限流 + 既有的 `authService.changePassword`）。
 *
 * **限流早於密碼驗證**：反過來的話，錯誤的舊密碼不消耗額度，
 * 這個入口就成了一個可無限猜測的密碼預言機（FR-024a 明文禁止）。
 * 成功後全部工作階段（含當前）失效且**不補發** —— 與開通作者刻意不同（FR-026）。
 */
export async function changePassword(uid: string, input: unknown): Promise<void> {
  await enforceRateLimit(`pwchg:${uid}`, env.PASSWORD_CHANGE_RATE_MAX);

  const data = parseOrThrow(changePasswordSchema, input);

  try {
    await changePasswordCore(uid, data.currentPassword, data.newPassword);
  } catch (err) {
    fromAuthError(err);
  }
}

/**
 * 自助開通作者（FR-023、research R-12）。
 *
 * 順序 MUST 為 **改角色 → 撤銷全部工作階段 → 為當前裝置補發**：
 *  - 先撤銷再改角色，補發的憑證會帶著舊的角色快照；
 *  - 不補發，使用者按下「成為作者」的結果是被登出，看起來像操作失敗。
 *
 * 角色檢查在限流之前：已經是作者的人再按一次是誤觸，不該消耗額度也不該回 429
 * （那會讓「你已經是作者了」這句話講不出來）。
 */
export async function becomeAuthor(
  uid: string,
  input: unknown,
  ctx: RequestCtx
): Promise<{ token: string }> {
  const user = await usersRepo.findById(uid);
  if (!user) throw new ServiceError('UNAUTHENTICATED', '使用者不存在');

  if (user.role === 'author' || user.role === 'admin') {
    throw new ServiceError('CONFLICT', '你已經是作者了');
  }

  // 限流早於 Zod（沿用 FEAT-1 register 的計數語意）：格式錯誤的送出一樣消耗額度
  await enforceRateLimit(`upgrade:${uid}`, env.AUTHOR_UPGRADE_RATE_MAX);

  const data = parseOrThrow(becomeAuthorSchema, input);

  try {
    await usersRepo.updateRoleAndPenName(uid, 'author', data.penName);
    await revokeAllSessionsForUser(uid);
  } catch (err) {
    throw translateDbError(err, '開通作者衝突，請重試');
  }

  try {
    const token = await issueSession({ id: uid, role: 'author' }, ctx);
    return { token };
  } catch (err) {
    // 角色已經改好了，只是這台裝置的憑證沒補上 —— 講清楚下一步比回一個 500 有用
    console.error('[userService] 開通作者後補發工作階段失敗', err);
    throw new ServiceError('INTERNAL_ERROR', '已開通作者身分，但需要請你重新登入一次');
  }
}

/** 登出所有裝置（FR-024）；發動的那一台也一併失效 —— 那正是這個操作的用途 */
export async function revokeAllSessions(uid: string): Promise<void> {
  await revokeAllSessionsForUser(uid);
}
