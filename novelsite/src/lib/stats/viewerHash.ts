/**
 * 閱讀者識別雜湊（FEAT-4 4-C / T095，FR-034、contracts/internal-modules.md §3）
 * ==============================================================================
 * `viewerHash` 同時扛兩件事：去重的鍵，以及成效總覽「不重複讀者數」的分母。
 * 它必須**恆定**（同一位讀者跨日、跨重啟皆為同值，否則分母從「人」變成「人次」），
 * 又必須**不可還原**（它是把來源位址與瀏覽器識別字串留在資料庫裡的唯一形式）。
 *
 * 鹽值取自 `VIEW_HASH_SECRET`：固定、專用、未設定即拒絕啟動、**不隨日期輪替**。
 * 前綴 `u:`／`a:` 使兩個命名空間不可能碰撞 —— 少了前綴，一位識別碼恰為
 * `<ip>|<ua>` 的使用者會與那個位址上的匿名讀者算出同一個雜湊。
 */
import { createHmac } from 'node:crypto';
import { env } from '@/lib/env';

/** `HMAC-SHA256(VIEW_HASH_SECRET, payload)`，輸出 64 個小寫十六進位字元 */
function hmac(payload: string): string {
  return createHmac('sha256', env.VIEW_HASH_SECRET).update(payload).digest('hex');
}

export function viewerHashForUser(userId: string): string {
  return hmac(`u:${userId}`);
}

export function viewerHashForAnonymous(clientIp: string, userAgent: string): string {
  return hmac(`a:${clientIp}|${userAgent}`);
}
