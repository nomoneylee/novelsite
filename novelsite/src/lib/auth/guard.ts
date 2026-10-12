import 'server-only';
import { redirect } from 'next/navigation';
import { cookies, headers } from 'next/headers';
import { readSession, SESSION_COOKIE, type ActiveSession } from './session';
import { usersRepo } from '@/lib/repositories';
import { logSecurityEvent } from './audit';
import { clientIpFrom } from './rateLimit';
import { assertNovelOwner } from './ownership';
import { ServiceError } from '@/lib/services/errors';
import type { Role } from './sessionToken';
import type { AuthUser } from '@/lib/types';

/**
 * 請求層輔助 + 身分守衛（getSession／requireUser／requireAuthor）。
 */

/**
 * 稽核記錄用的來源位址。
 *
 * `headers()` 只在請求範圍內可用；擁有者守衛同時被 Server Action（有請求範圍）
 * 與整合測試直接呼叫的服務層（無請求範圍）走到。取不到位址時記 `unknown`
 * 而非讓整個守衛擲錯 —— **稽核欄位缺一格，不該讓授權判斷連帶失敗**。
 */
async function currentIp(): Promise<string> {
  try {
    const h = await headers();
    return clientIpFrom(h, 'unknown');
  } catch {
    return 'unknown';
  }
}

/** 讀取當前請求的工作階段；未登入回 null（不轉址，供呼叫端自行決定） */
export async function getSession(): Promise<ActiveSession | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE.name)?.value;
  return readSession(token);
}

/** 未登入即轉址至登入頁（版面層第二道防線，FR-013） */
export async function requireUser(): Promise<ActiveSession> {
  const session = await getSession();
  if (!session) {
    redirect('/auth/login');
  }
  return session;
}

/**
 * 角色不足（role ∉ {author, admin}）即轉址（FR-013）。
 * MUST 以資料庫 User.role 覆核，不得只信 JWT 快照 —— 角色變更後舊憑證仍可能攜帶過期快照（FR-045）。
 */
export async function requireAuthor(): Promise<ActiveSession> {
  const session = await getSession();
  if (!session) {
    redirect('/auth/login');
  }

  const user = await usersRepo.findById(session.uid);
  const role = (user?.role as Role | undefined) ?? session.role;

  if (role !== 'author' && role !== 'admin') {
    logSecurityEvent({ event: 'authz.denied', ip: await currentIp(), result: 'insufficient_role' });
    redirect('/');
  }

  return { ...session, role };
}

/**
 * 管理後台頁面層守衛（FR-027）：
 * 1. 驗證 session 是否存在（未登入轉向 `/auth/login?next=/admin`）
 * 2. 透過 DB 覆核 user.role === 'admin' 且 !user.isSuspended
 * 3. 條件不符轉向首頁 `/` 並記錄 `authz.denied`
 * 4. 回傳包含覆核後角色的 ActiveSession
 */
export async function requireAdmin(): Promise<ActiveSession> {
  const session = await getSession();
  if (!session) {
    redirect('/auth/login?next=/admin');
  }

  const user = await usersRepo.findById(session.uid);
  if (!user || user.role !== 'admin' || user.isSuspended) {
    logSecurityEvent({ event: 'authz.denied', ip: await currentIp(), result: 'insufficient_role' });
    redirect('/');
  }

  return { ...session, role: 'admin' };
}

function toAuthUser(user: usersRepo.UserWithUnread): AuthUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatarColor: user.avatarColor,
    createdAt: user.createdAt.toISOString(),
    role: user.role as Role,
    unreadCount: user.unreadCount,
  };
}

/**
 * 供 root layout 建立 SessionProvider 用的完整使用者物件；未登入回 null（FR-014）。
 * 不轉址 —— 公開頁面亦需在未登入狀態下正常渲染（訪客視圖）。
 *
 * **未登入路徑 MUST 維持提前返回**（FEAT-4 T134、SC-020）：訪客沒有未讀數這個概念，
 * 其額外查詢成本是字面意義的 **0**。已登入者改走 `findByIdWithUnread` ——
 * 未讀數以過濾式關聯計數併入**同一次**查詢，故導覽列的未讀數是「每頁至多一次計數，
 * 且與既有查詢同一次往返」，而不是每頁多一次 `count()`（FR-053a、research R-6）。
 */
export async function getSessionUser(): Promise<AuthUser | null> {
  const session = await getSession();
  if (!session) return null;
  const user = await usersRepo.findByIdWithUnread(session.uid);
  return user ? toAuthUser(user) : null;
}

/**
 * 擁有權的判斷本體住在 `./ownership`（該檔不匯入 `next/navigation`，服務層才用得起）。
 * 契約（contracts/internal-modules.md §4）以 `guard.ts` 為 import 路徑，故在此 re-export。
 */
export { NotFoundError, assertNovelOwner } from './ownership';

/**
 * 擁有者守衛的頁面層入口（FR-004、contracts/internal-modules.md §4）。
 *
 * **非擁有者與資源不存在擲出完全相同的例外**，MUST NOT 回 403 ——
 * 403 等於告訴呼叫者「這個 id 是有效的，只是不是你的」，
 * 而作者的作品清單本身就是需要保護的資訊。
 *
 * 授權順序 MUST 為「身分（`requireUser`）→ 角色（`requireAuthor`）→ 擁有權（本函式）」；
 * 本函式**不**檢查身分與角色，呼叫端 MUST 已完成前兩者。
 */
export async function requireOwner(session: ActiveSession, novelId: string): Promise<void> {
  return assertNovelOwner(session.uid, novelId);
}

/**
 * Server Action 專用的身分＋角色守衛（FR-007、contracts/server-actions.md §0）。
 *
 * **為何不直接用 `requireAuthor()`**：那一個以 `redirect()` 收尾，是為頁面與版面設計的
 * ——瀏覽器收到 302 就換頁，使用者看得懂。Action 的回傳值卻是要交給表單顯示的
 * `ActionResult`，契約明文規定未登入回 `UNAUTHENTICATED`、角色不足回 `FORBIDDEN`；
 * 若沿用轉址版本，這兩個錯誤碼就永遠不會出現，前端也無從把「你不是作者」講清楚。
 * 兩者共用同一套判斷依據（工作階段查 DB、角色以 `User.role` 覆核，FR-045），
 * 差別只在「怎麼把拒絕講出去」。
 *
 * 授權順序 MUST 為身分 → 角色；擁有權由服務層的 `assertNovelOwner` 接手。
 */
export async function requireAuthorForAction(): Promise<ActiveSession> {
  const session = await getSession();
  if (!session) {
    logSecurityEvent({ event: 'authz.denied', ip: await currentIp(), result: 'unauthenticated' });
    throw new ServiceError('UNAUTHENTICATED', '請先登入');
  }

  const user = await usersRepo.findById(session.uid);
  const role = (user?.role as Role | undefined) ?? session.role;

  if (role !== 'author' && role !== 'admin') {
    logSecurityEvent({ event: 'authz.denied', ip: await currentIp(), result: 'insufficient_role' });
    throw new ServiceError('FORBIDDEN', '此操作僅限作者');
  }

  return { ...session, role };
}

/**
 * 管理後台 Server Action 層守衛（FR-027）：
 * 1. 驗證 session 是否存在（未登入擲出 ServiceError('UNAUTHENTICATED', '請先登入')）
 * 2. 透過 DB 覆核 user.role === 'admin' 且 !user.isSuspended
 * 3. 條件不符擲出 ServiceError('FORBIDDEN', '此操作僅限管理員') 並記錄 `authz.denied`
 * 4. 回傳包含覆核後角色的 ActiveSession
 */
export async function requireAdminForAction(): Promise<ActiveSession> {
  const session = await getSession();
  if (!session) {
    logSecurityEvent({ event: 'authz.denied', ip: await currentIp(), result: 'unauthenticated' });
    throw new ServiceError('UNAUTHENTICATED', '請先登入');
  }

  const user = await usersRepo.findById(session.uid);
  if (!user || user.role !== 'admin' || user.isSuspended) {
    logSecurityEvent({ event: 'authz.denied', ip: await currentIp(), result: 'insufficient_role' });
    throw new ServiceError('FORBIDDEN', '此操作僅限管理員');
  }

  return { ...session, role: 'admin' };
}

/** 個人設定 Action 專用：只驗身分，不驗角色（讀者也能改自己的個資） */
export async function requireUserForAction(): Promise<ActiveSession> {
  const session = await getSession();
  if (!session) {
    logSecurityEvent({ event: 'authz.denied', ip: await currentIp(), result: 'unauthenticated' });
    throw new ServiceError('UNAUTHENTICATED', '請先登入');
  }
  return session;
}

/**
 * 來源比對的本體住在 `./origin`（該檔不匯入 `next/navigation`，`routeHelpers.ts` 才用得起）。
 * 契約以 `guard.ts` 為 import 路徑，故在此 re-export —— 理由詳見該檔檔首。
 */
export { SameOriginError, assertSameOrigin } from './origin';

/**
 * 只接受站內路徑，外部網址（或協定相對網址）一律回傳預設頁（FR-017，防開放轉址）。
 */
export function safeNextPath(next: string | null): string {
  const fallback = '/';
  if (!next) return fallback;
  if (!next.startsWith('/')) return fallback;
  if (next.startsWith('//') || next.startsWith('/\\')) return fallback;
  return next;
}
