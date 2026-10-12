import { NextResponse } from 'next/server';
import { assertSameOrigin, getSession } from '@/lib/auth/guard';
import { resolveRequestCtx, serviceErrorResponse } from '@/lib/auth/routeHelpers';
import { recordChapterView } from '@/lib/services/statsService';

/**
 * `POST /api/chapters/{chapterId}/view`（contracts/analytics-scheduling-api.md §1）
 * ==================================================================================
 * **對匿名開放**（多數讀者未登入，只收登入者會使曝光大幅低估），
 * 但**匿名可用不等於任何站台可用** —— 本端點寫入 `ChapterView`，屬 FR-006 所稱
 * 「本階段新增的所有寫入入口」，故六步之前先接上既有的來源比對；
 * 缺它則任何外部網站都能對本站刷曝光與排行分數。
 *
 * **兩種拒絕的語意刻意相反，MUST NOT 混為一談**：
 * 跨站來源 MUST **明確拒絕**（403）；限流超額 MUST **靜默捨棄**（回 200 不寫入，FR-035a）。
 * 前者防的是別的站台，後者防的是測門檻。
 *
 * 六步順序與「任何一步的略過都回 `{ ok: true }`」位於服務層（T101）——
 * 靜默的意思是回應**逐字相同**，故本檔對成功與被擋下的情形走的是同一行程式碼。
 */
export const dynamic = 'force-dynamic';

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, ctx: Ctx) {
  try {
    assertSameOrigin(request);
    const { id } = await ctx.params;
    // 未登入不轉址、不報錯：本端點的授權是「無」，登入與否只影響 viewerHash 的取法
    const session = await getSession();
    const { ip, userAgent } = resolveRequestCtx(request);

    await recordChapterView(id, { userId: session?.uid, clientIp: ip, userAgent });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return serviceErrorResponse(err);
  }
}
