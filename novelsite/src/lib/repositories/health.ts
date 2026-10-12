import 'server-only';
import { prisma } from '@/lib/db';

/**
 * 發出一次 provider 中立的最小往返並計時，供 /api/health 使用。
 * 連線失敗 MUST 回 okay: false 而非擲出（FR-022：端點須回失敗狀態，不得逾時無回應）。
 */
export async function pingDatabase(): Promise<{ okay: boolean; latencyMs: number }> {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { okay: true, latencyMs: Date.now() - start };
  } catch {
    return { okay: false, latencyMs: Date.now() - start };
  }
}
