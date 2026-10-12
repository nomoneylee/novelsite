// 注意：本檔 MUST NOT import 'server-only' —— prisma/seed.ts 經 tsx（非 Next 打包環境）
// 直接呼叫 hashPassword，'server-only' 在該執行環境下的 exports 一律解析到會擲錯的進入點。
import { hash, hashSync, verify } from '@node-rs/argon2';

/**
 * 成本參數集中定義於此，MUST NOT 散落於呼叫端（SC-009 的唯一變數）。
 * OWASP Password Storage Cheat Sheet 對 argon2id 的最低建議組合（research.md R-8a）。
 * 若 SC-009 的 p95 量測逼近 1 秒，MUST 下調 memoryCost 並重新量測。
 * algorithm: 2 = Algorithm.Argon2id —— 以數值常值取代 const enum 參照，
 * 因 tsconfig 的 isolatedModules 不允許跨模組存取 ambient const enum（TS2748）。
 */
export const ARGON2_PARAMS = {
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
  algorithm: 2,
} as const;

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2_PARAMS);
}

export async function verifyPassword(hashValue: string, plain: string): Promise<boolean> {
  return verify(hashValue, plain);
}

/**
 * 帳號不存在時對此固定假雜湊執行一次 verify，維持時序不可區分（FR-005）。
 * 以 ARGON2_PARAMS 產生 —— 參數不同則耗時不同，時序要求即落空。
 */
export const DUMMY_HASH: string = hashSync(
  'dummy-password-for-timing-safety-only-never-matches',
  ARGON2_PARAMS
);
