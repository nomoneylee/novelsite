import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { AuthServiceError, type RequestCtx } from '@/lib/services/authService';
import { SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth/sessionToken';
import { clientIpFrom } from '@/lib/auth/rateLimit';
// 自 `./origin` 而非 `./guard` 取得：後者匯入 `next/navigation`，會把 App Router 的
// React context 拉進本檔，使整合測試無法直接呼叫 `assertCronSecret`（見 origin.ts 檔首）
import { SameOriginError } from '@/lib/auth/origin';
import { ServiceError, type ErrorCode } from '@/lib/services/errors';

/**
 * Next.js Route Handler 無法取得原始 TCP 連線位址（App Router 未提供此 API，見
 * research.md 對隨版文件的查證），故未設定可信代理層數時的「直連位址」僅為佔位值。
 * 正式部署 MUST 設定 TRUSTED_PROXY_HOPS 並經反向代理注入 X-Forwarded-For。
 */
const UNKNOWN_DIRECT_IP = 'unknown';

export function resolveRequestCtx(request: Request): RequestCtx {
  return {
    ip: clientIpFrom(request.headers, UNKNOWN_DIRECT_IP),
    userAgent: request.headers.get('user-agent') ?? '',
  };
}

const STATUS_BY_CODE: Record<AuthServiceError['code'], number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  SUSPENDED: 403,
};

/** 將 authService 擲出的錯誤轉為契約規範的 HTTP 回應（contracts/http-api.md 通用回應格式） */
export function authErrorResponse(err: unknown): NextResponse {
  if (err instanceof AuthServiceError) {
    const status = STATUS_BY_CODE[err.code];
    const res = NextResponse.json(
      {
        error: {
          code: err.code,
          message: err.message,
          ...(err.fields ? { fields: err.fields } : {}),
        },
      },
      { status }
    );
    if (err.code === 'RATE_LIMITED' && err.retryAfterSeconds) {
      res.headers.set('Retry-After', String(err.retryAfterSeconds));
    }
    return res;
  }

  console.error('[auth] unexpected error', err);
  return NextResponse.json(
    { error: { code: 'INTERNAL_ERROR', message: '未預期錯誤' } },
    { status: 500 }
  );
}

export function setSessionCookie(res: NextResponse, token: string): void {
  res.cookies.set(SESSION_COOKIE.name, token, sessionCookieOptions());
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.delete({ name: SESSION_COOKIE.name, path: SESSION_COOKIE.path });
}

// ─────────────────────────────────────────────────────────────
// FEAT-4：讀者狀態與互動 Route Handler 的共用錯誤轉譯（T033）
// ─────────────────────────────────────────────────────────────

const STATUS_BY_SERVICE_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  SUSPENDED: 403,
  // FEAT-5（T031）：兩個碼、同一個狀態。兩者與 `ErrorCode` 是同一個聯集型別的兩半，
  // 漏一處即 TypeScript 紅燈 —— 刻意如此
  INVALID_TOKEN: 400,
  EXPIRED_TOKEN: 400,
  // FEAT-5（T050）：**502 而非 500** —— 失敗來自上游郵件服務，不是本站程式錯誤。
  // 與 `ErrorCode` 的 `MAIL_FAILED` 是同一個聯集型別的兩半，漏一處即 TypeScript 紅燈
  MAIL_FAILED: 502,
  INTERNAL_ERROR: 500,
};

/**
 * `ServiceError` → 契約規範的 HTTP 回應（FR-003 的錯誤碼語意）。
 *
 * `SameOriginError` 在此一併轉為 **403 FORBIDDEN** —— 跨站來源的比對是每一個新增
 * 寫入端點的前置（FR-006），把它留給各檔自行 try/catch 的結果是漏掉一兩個，
 * 而漏掉的那一個不會有任何症狀，直到有人從別的網站借使用者的 Cookie 改資料。
 *
 * 未預期的例外一律 500 且**只給一句話**：錯誤回應 MUST NOT 外洩內部細節。
 */
export function serviceErrorResponse(err: unknown): NextResponse {
  if (err instanceof SameOriginError) {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: '請求來源不被信任' } },
      { status: 403 }
    );
  }

  if (err instanceof ServiceError) {
    const status = STATUS_BY_SERVICE_CODE[err.code];
    const res = NextResponse.json(
      {
        error: {
          code: err.code,
          message: err.message,
          ...(err.fields ? { fields: err.fields } : {}),
        },
      },
      { status }
    );
    if (err.code === 'RATE_LIMITED' && err.retryAfterSeconds) {
      res.headers.set('Retry-After', String(err.retryAfterSeconds));
    }
    return res;
  }

  console.error('[api] 未預期錯誤', err);
  return NextResponse.json(
    { error: { code: 'INTERNAL_ERROR', message: '系統忙碌中，請稍後再試' } },
    { status: 500 }
  );
}

/** 請求主體解析。非 JSON 或空主體一律當成驗證失敗，MUST NOT 讓它變成 500 */
export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ServiceError('VALIDATION_ERROR', '請求內容不是有效的 JSON');
  }
}

/** 查詢字串 → 純物件，供 Zod 驗證（MUST NOT 直接把原值餵給 repository，FR-005） */
export function searchParamsOf(request: Request): Record<string, string> {
  return Object.fromEntries(new URL(request.url).searchParams);
}

const BEARER_PREFIX = 'Bearer ';

/**
 * 排程入口的密鑰守衛（FEAT-4 4-C / T102，FR-055、contracts/analytics-scheduling-api.md §4）。
 *
 * 三個 cron 入口是**沒有使用者**的寫入端點：它們改資料、清資料，卻沒有工作階段可以驗。
 * 唯一的門就是這個 Bearer 密鑰，故三種失敗方式都是同一個答案 —— 401、且什麼都不做。
 *
 * **`CRON_SECRET` 未設定時一律拒絕**（憲章：設定不足即失敗，MUST NOT 靜默降級）。
 * 「沒設定就先放行，等設定了再驗」是很自然的寫法，而它的後果是**忘記設定的環境完全
 * 不設防**，任何人都能對它反覆觸發彙總與清理。
 *
 * **設定值於呼叫當下讀取**，MUST NOT 在模組載入時解構成常數 ——
 * 否則「未設定」這條分支永遠無法被測試驗證（tests/integration/cron-auth.test.ts）。
 *
 * 比對用 `timingSafeEqual`；長度不同時直接拒絕（該函式要求兩邊等長）。
 */
export function assertCronSecret(request: Request): void {
  const secret = env.CRON_SECRET;
  const header = request.headers.get('authorization');
  // 只收 `Bearer <密鑰>`：另外寬容地接受裸密鑰等於多開一種通過方式，而多的那一種
  // 不會有人記得在下一次調整時一併檢查
  const provided =
    header && header.startsWith(BEARER_PREFIX) ? header.slice(BEARER_PREFIX.length) : null;

  if (!secret || provided === null) {
    throw new ServiceError('UNAUTHENTICATED', '排程入口需要有效的密鑰');
  }

  const providedBytes = Buffer.from(provided, 'utf8');
  const expectedBytes = Buffer.from(secret, 'utf8');
  if (
    providedBytes.length !== expectedBytes.length ||
    !timingSafeEqual(providedBytes, expectedBytes)
  ) {
    throw new ServiceError('UNAUTHENTICATED', '排程入口需要有效的密鑰');
  }
}
