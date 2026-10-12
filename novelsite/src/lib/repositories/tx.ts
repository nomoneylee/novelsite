import 'server-only';
import { prisma } from '@/lib/db';
import type { Prisma } from '@/generated/prisma/client';

/**
 * 交易客戶端的共用型別與取用輔助。
 *
 * 寫入函式一律接受選填的 `tx`：服務層需要把「資料寫入 + 計數回填」綁在同一個交易裡
 * （data-model.md §4.1「重算與該次章節寫入 MUST 位於同一交易」），
 * 而同一個函式在交易外也要能單獨使用。若不收 `tx`，服務層就只能在 repository 外
 * 自己拼 `prisma.$transaction`，等於把資料存取的細節漏回上層（憲章第 III 條）。
 */
export type TxClient = Prisma.TransactionClient;

/** 有交易就用交易，沒有就用預設連線 */
export function db(tx?: TxClient): TxClient | typeof prisma {
  return tx ?? prisma;
}

/**
 * 交易邊界。服務層經此開交易，MUST NOT 自行 `import { prisma }` ——
 * 一旦上層拿得到客戶端本體，「所有寫入經 service → repository」就只剩下自律，
 * 而自律在第一個趕時間的下午就會失效。
 *
 * 第二參數為**選填**（FEAT-7 T011）：既有 24 個呼叫端（散在 9 個服務檔）一行不改。
 * 批次匯入是唯一會傳它的呼叫端 —— 1000 章的上界下，Prisma 互動式交易預設的 5 秒
 * timeout 必然逾時，而 FR-012 的全有全無不允許把交易拆開（research R-3）。
 */
export function withTransaction<T>(
  fn: (tx: TxClient) => Promise<T>,
  options?: { timeout?: number; maxWait?: number }
): Promise<T> {
  return prisma.$transaction(fn, options);
}
