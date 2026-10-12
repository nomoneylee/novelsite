import 'server-only';
import { prisma } from '@/lib/db';
import { db, type TxClient } from './tx';
import type { PasswordResetToken } from '@/generated/prisma/client';

/**
 * 密碼重設憑證的資料存取（FEAT-5，data-model.md §4）
 * ==================================================
 * **本檔不做任何有效性判斷**：那條判準（`consumedAt IS NULL AND expiresAt > now()`）
 * 的唯一實作處是 `lib/auth/passwordResetToken.ts` 的 `resetTokenStatus()`（data-model §2.2）。
 * `findByHash` 因此是純查詢 —— repository 回那一列，服務層交給判準函式問狀態。
 */

/**
 * FR-011a 的順帶清理：把該使用者**已失效**的憑證刪掉（已使用 或 已逾期）。
 *
 * 不建排程：這張表的量體是「有人忘記密碼」的次數，而清理的自然時機正是
 * 同一個人下一次申請。**呼叫端 MUST 以 try/catch 吞掉失敗** ——
 * 清理不成功 MUST NOT 導致申請失敗（data-model §3）。
 */
export async function deletePastForUser(userId: string): Promise<void> {
  const now = new Date();
  await prisma.passwordResetToken.deleteMany({
    where: {
      userId,
      OR: [{ consumedAt: { not: null } }, { expiresAt: { lt: now } }],
    },
  });
}

/**
 * FR-010／FR-011：把該使用者**未使用**的憑證一律填上 `consumedAt`。
 *
 * 兩個呼叫時機共用同一支函式：申請新憑證（交易內，緊接 `create`）與使用者自行改密碼。
 * 兩者對「舊的那幾把還能不能用」的答案完全相同，分成兩支只會有一天其中一支被忘記。
 */
export async function invalidateActiveForUser(userId: string, tx?: TxClient): Promise<void> {
  await db(tx).passwordResetToken.updateMany({
    where: { userId, consumedAt: null },
    data: { consumedAt: new Date() },
  });
}

export interface CreatePasswordResetTokenInput {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}

export async function create(
  input: CreatePasswordResetTokenInput,
  tx?: TxClient
): Promise<PasswordResetToken> {
  return db(tx).passwordResetToken.create({ data: input });
}

/** 純查詢，供服務層交給 `resetTokenStatus()` 判狀態（判斷邏輯不在 repository） */
export async function findByHash(tokenHash: string): Promise<PasswordResetToken | null> {
  return prisma.passwordResetToken.findUnique({ where: { tokenHash } });
}

/**
 * 標記為已使用，**回傳受影響列數**（data-model §4.1）。
 *
 * 「單次可用」（FR-009）在**併發**下的正確性全靠這個回傳值：兩個請求同時拿同一把
 * token 進來時，兩者都會通過 `resetTokenStatus()` 的判準；只有 `updateMany` 的
 * `where` 帶著 `consumedAt: null` 才會讓其中一個更新到 0 列。
 * **呼叫端 MUST 在列數為 0 時視為失效並中止**，MUST NOT 先讀後寫 ——
 * read-then-write 在兩個請求之間沒有任何互斥。
 */
export async function consume(id: string): Promise<number> {
  const result = await prisma.passwordResetToken.updateMany({
    where: { id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  return result.count;
}
