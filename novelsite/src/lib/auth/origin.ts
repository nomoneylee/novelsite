/**
 * 來源比對（FR-006／FR-016，contracts/internal-modules.md §4）
 * ============================================================
 * **為何自成一個模組而不留在 `guard.ts`**：與 `ownership.ts` 完全相同的理由 ——
 * `guard.ts` 匯入 `next/navigation` 的 `redirect()`，那條相依會把 App Router 的
 * React context 拉進任何 import 它的模組，於是 `routeHelpers.ts` 在純 Node 環境
 * （整合測試直接呼叫守衛函式，例如 `assertCronSecret` 的「密鑰未設定」那一案）
 * 會在**載入階段**就爆掉，而錯誤訊息（`React.createContext is not a function`）
 * 完全看不出跟來源比對有關。
 *
 * 比對本身只需要兩個請求標頭，不需要轉址，故拆出來（2026-08-08，T102 落地時發現）。
 * `guard.ts` 仍 re-export 兩者，既有的 import 路徑不變。
 */

export class SameOriginError extends Error {
  constructor() {
    super('Origin 與 Host 不符');
    this.name = 'SameOriginError';
  }
}

/**
 * 比對 Origin 與 Host，不符即擲出 SameOriginError（Route Handler 專用，FR-016）。
 * 呼叫端 MUST 以 try/catch 轉換為 403 FORBIDDEN 回應 —— Route Handler 沒有框架內建的
 * CSRF 保護（與 Server Action 不同，見 research.md R-4）。
 */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');

  if (!origin || !host) {
    throw new SameOriginError();
  }

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new SameOriginError();
  }

  if (originHost !== host) {
    throw new SameOriginError();
  }
}
