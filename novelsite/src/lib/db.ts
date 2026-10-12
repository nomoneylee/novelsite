/**
 * 資料庫連線（最底層存取點）
 * ================================
 * 【可抽換設計核心】
 * 這是整個專案唯一直接建立資料庫連線的地方。依 DATABASE_PROVIDER 選擇對應的
 * driver adapter（FR-019、FR-021）：
 *
 *   - sqlite     → @prisma/adapter-better-sqlite3
 *   - postgresql → @prisma/adapter-pg
 *
 * 上層一律透過 `src/lib/repositories/*` 取資料，不 import 本檔，
 * 因此 DB 抽換不會擴散到頁面與元件。
 */
import { PrismaClient } from '@/generated/prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '@/lib/env';

function createPrismaClient(): PrismaClient {
  const adapter =
    env.DATABASE_PROVIDER === 'postgresql'
      ? new PrismaPg(env.DATABASE_URL)
      : new PrismaBetterSqlite3({ url: env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

// Singleton 不分環境一律掛 globalThis（FR-021）—— MUST NOT 因執行環境不同而改變此行為，
// 否則每次模組重新載入都會建立新連線（尤其是 serverless／HMR 情境）。
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient = (globalForPrisma.prisma ??= createPrismaClient());
