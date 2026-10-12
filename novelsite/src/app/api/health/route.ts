import { NextResponse } from 'next/server';
import { pingDatabase } from '@/lib/repositories';
import { env } from '@/lib/env';

/**
 * 健康檢查（FR-022）—— 密鑰分流。
 * dbLatencyMs / ok 一律取自 repositories/health.ts 的 pingDatabase()（憲章第 III 條，
 * MUST NOT 於本檔直接 import prisma 或發出 $queryRaw）。
 * 此端點不經路由攔截層（matcher 排除 /api），是整合測試伺服器的就緒探針（research.md R-6）。
 */
export async function GET(request: Request) {
  const { okay, latencyMs } = await pingDatabase();
  const status = okay ? 200 : 503;

  const providedSecret = request.headers.get('x-health-secret');
  const hasValidSecret =
    env.HEALTH_CHECK_SECRET !== undefined && providedSecret === env.HEALTH_CHECK_SECRET;

  if (!hasValidSecret) {
    return NextResponse.json({ ok: okay }, { status });
  }

  return NextResponse.json(
    {
      ok: okay,
      provider: env.DATABASE_PROVIDER,
      dbLatencyMs: latencyMs,
      trustedProxyHops: env.TRUSTED_PROXY_HOPS,
      rateLimitMode: 'single-instance',
    },
    { status }
  );
}
