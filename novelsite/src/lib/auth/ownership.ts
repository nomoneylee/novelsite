import 'server-only';
import { headers } from 'next/headers';
import { novelBelongsToAuthor } from '@/lib/repositories';
import { logSecurityEvent } from './audit';
import { clientIpFrom } from './rateLimit';

/**
 * 擁有權判斷（FR-004、contracts/internal-modules.md §4）
 * ========================================================
 * **為何自成一個模組而不留在 `guard.ts`**：`guard.ts` 匯入 `next/navigation` 的
 * `redirect()`，那條相依會連帶把 App Router 的 React context 拉進任何 import 它的模組。
 * 服務層需要的只是「這部作品是不是他的」，卻會因此在純 Node 環境（單元測試）中
 * 於載入階段就爆掉。把不需要轉址的部分拆出來，服務層才不必為了一個布林判斷
 * 扛上整個路由層的執行期。
 *
 * `guard.ts` 仍會 re-export 這裡的兩個名稱，契約上的 import 路徑不變。
 */

/**
 * 「找不到」語意的擲出型別（FR-004）。
 *
 * 服務層與 Action 層 MUST 把它轉譯為 `NOT_FOUND` 回傳值，
 * MUST NOT 讓它穿透到 `error.tsx`（穿透即是把「別人的作品」變成五百錯誤畫面，
 * 而錯誤畫面與真正的 404 長得不一樣，區別本身就是洩漏）。
 */
export class NotFoundError extends Error {
  constructor(message = '找不到指定的資源') {
    super(message);
    this.name = 'NotFoundError';
  }
}

/**
 * 稽核記錄用的來源位址。
 *
 * `headers()` 只在請求範圍內可用，而擁有權守衛同時被 Server Action（有請求範圍）
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

/**
 * 擁有者守衛的核心：**非擁有者與資源不存在擲出完全相同的例外**，MUST NOT 回 403 ——
 * 403 等於告訴呼叫者「這個 id 是有效的，只是不是你的」，
 * 而作者的作品清單本身就是需要保護的資訊。
 *
 * 本函式**不**檢查身分與角色，呼叫端 MUST 已完成前兩者
 * （順序：身分 → 角色 → 擁有權）。
 */
export async function assertNovelOwner(uid: string, novelId: string): Promise<void> {
  const owned = await novelBelongsToAuthor(uid, novelId);
  if (!owned) {
    logSecurityEvent({ event: 'authz.denied', ip: await currentIp(), result: 'not_owner' });
    throw new NotFoundError();
  }
}
