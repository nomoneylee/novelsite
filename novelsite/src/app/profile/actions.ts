'use server';

import { cookies, headers } from 'next/headers';
import { requireUserForAction } from '@/lib/auth/guard';
import { SESSION_COOKIE } from '@/lib/auth/session';
import { sessionCookieOptions } from '@/lib/auth/sessionToken';
import { clientIpFrom } from '@/lib/auth/rateLimit';
import { errorResult as toFailure, ok, type ActionResult, type Failure } from '@/lib/actionResult';
import {
  updateProfile,
  changePassword,
  becomeAuthor,
  revokeAllSessions,
} from '@/lib/services/userService';
import type { RequestCtx } from '@/lib/services/authService';

/**
 * 個人設定的四個 Server Action（contracts/server-actions.md §3）
 * ==============================================================
 * **每一個 Action 的第一行都是 `requireUserForAction()`**（FR-007、T088a）——
 * 只驗身分不驗角色：讀者也能改自己的個資，「成為作者」更是只有讀者才會按。
 *
 * MUST NOT 依賴 `proxy.ts` 的 matcher 承擔授權：matcher 以路徑前綴比對，
 * 而 Server Action 是 POST 到某個頁面路徑再由框架派送 —— 只要有人為了別的理由
 * 把某條路徑排除在 matcher 外，那條路徑上的 Action 就會連帶失去保護，
 * 而且不會有任何一個測試變紅。
 *
 * 角色檢查（已是作者 → `CONFLICT`）與限流都在服務層，且**都在身分之後**：
 * 未登入的人不該消耗任何人的限流額度，也不該從回應裡讀出「這個帳號已經是作者」。
 *
 * CSRF 由框架內建的 `Origin`／`Host` 比對承擔（research R-6），Action 內不自寫。
 */

const errorResult = (err: unknown): Failure => toFailure('profile action', err);

async function resolveCtx(): Promise<RequestCtx> {
  const h = await headers();
  return {
    ip: clientIpFrom(h, 'unknown'),
    userAgent: h.get('user-agent') ?? '',
  };
}

export async function updateProfileAction(input: unknown): Promise<ActionResult> {
  try {
    const session = await requireUserForAction();
    await updateProfile(session.uid, input);
    return ok;
  } catch (err) {
    return errorResult(err);
  }
}

/**
 * 改密碼。成功後全部工作階段（**含本裝置**）失效且**刻意不補發**（FR-026）——
 * 使用者必須以新密碼重新登入，前端的告知文案 MUST 與開通作者那一段區分開。
 */
export async function changePasswordAction(input: unknown): Promise<ActionResult> {
  try {
    const session = await requireUserForAction();
    await changePassword(session.uid, input);
    return ok;
  } catch (err) {
    return errorResult(err);
  }
}

/**
 * 開通作者。撤銷全部工作階段後**為當前裝置補發**憑證並寫回 Cookie（FR-023、research R-12）
 * —— 少了這一步，使用者按下「成為作者」的結果是被登出，看起來像操作失敗。
 */
export async function becomeAuthorAction(input: unknown): Promise<ActionResult> {
  try {
    const session = await requireUserForAction();
    const { token } = await becomeAuthor(session.uid, input, await resolveCtx());

    const store = await cookies();
    store.set(SESSION_COOKIE.name, token, sessionCookieOptions());
    return ok;
  } catch (err) {
    return errorResult(err);
  }
}

/** 登出所有裝置（FR-024）。本裝置也一併失效 —— 那正是這個操作的用途 */
export async function revokeSessionsAction(): Promise<ActionResult> {
  try {
    const session = await requireUserForAction();
    await revokeAllSessions(session.uid);
    return ok;
  } catch (err) {
    return errorResult(err);
  }
}
