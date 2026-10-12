/**
 * Server Action 的 HTTP 直呼輔助（T018／T018a／T021 共用）
 * ==========================================================
 * 純 HTTP + 檔案讀取，MUST NOT import 任何 `src/**` 模組（與 client.ts 同一條規則）。
 *
 * **為何需要這一層**：FR-007 要求「每個 Action 自行驗證身分與角色，MUST NOT 依賴
 * `proxy.ts` 的 matcher」。要驗證這句話，測試就得**真的把請求送到 Action 端點**——
 * 呼叫服務層函式只能證明服務層擋得住，證明不了 Action 有沒有漏接。
 *
 * Next 16 的 Server Action 以 `Next-Action: <id>` 標頭派送，`<id>` 是建置期產生的雜湊。
 * 建置產物 `.next/server/server-reference-manifest.json` 把 id 對應回
 * `{ filename, exportedName }`，故可由匯出名反查 —— MUST NOT 把雜湊寫死在測試裡
 * （雜湊隨每次建置變動，寫死的那一刻測試就開始說謊）。
 *
 * 請求主體格式：非 multipart 時 Next 以 `req.text()` 取字串後交給 React 的 `decodeReply`，
 * 該函式吃的是「引數陣列的 flight-JSON」。純 JSON 引數（本專案全部 Action 皆是）
 * 直接用 `JSON.stringify([arg])` 即為合法輸入。
 */
import fs from 'node:fs';
import path from 'node:path';
import { baseUrl } from './client';

const MANIFEST_PATH = path.resolve(__dirname, '../../.next/server/server-reference-manifest.json');

interface ManifestEntry {
  filename: string;
  exportedName: string;
  workers: Record<string, unknown>;
}

export interface ActionRef {
  id: string;
  /** 該 Action 已註冊的路由（可作為 POST 目標） */
  routes: string[];
}

let cache: Map<string, ActionRef> | null = null;

/** `app/author/create/page` → `/author/create`；`app/page` → `/` */
function workerKeyToRoute(key: string): string {
  const withoutSuffix = key.replace(/\/(page|route|layout)$/, '');
  const route = withoutSuffix.replace(/^app/, '');
  return route === '' ? '/' : route;
}

function loadManifest(): Map<string, ActionRef> {
  if (cache) return cache;

  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(
      `[serverAction] 找不到 ${MANIFEST_PATH}——本輔助依賴 globalSetup 的 next build 產物`
    );
  }

  const raw = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) as {
    node: Record<string, ManifestEntry>;
  };

  const map = new Map<string, ActionRef>();
  for (const [id, entry] of Object.entries(raw.node)) {
    const routes = Object.keys(entry.workers).map(workerKeyToRoute);
    map.set(entry.exportedName, { id, routes });
  }

  cache = map;
  return map;
}

/** 依匯出名取得 Action 的派送 id 與可用路由 */
export function actionRef(exportedName: string): ActionRef {
  const ref = loadManifest().get(exportedName);
  if (!ref) {
    const known = [...loadManifest().keys()].sort().join(', ');
    throw new Error(
      `[serverAction] 建置產物內找不到名為 "${exportedName}" 的 Server Action。已知的有：${known}`
    );
  }
  return ref;
}

/**
 * 挑一個**非動態**路由當 POST 目標 —— 動態段（`[novelId]`）無法直接組出合法網址。
 */
function pickRoute(ref: ActionRef, exportedName: string): string {
  const staticRoute = ref.routes.find((r) => !r.includes('['));
  if (!staticRoute) {
    throw new Error(
      `[serverAction] "${exportedName}" 只註冊在動態路由上（${ref.routes.join(', ')}），` +
        '請以 opts.route 指定一個具體網址'
    );
  }
  return staticRoute;
}

export interface CallActionOptions {
  ip: string;
  cookie?: string;
  /** 覆寫 POST 目標路由；預設取該 Action 已註冊的第一個靜態路由 */
  route?: string;
  /** 覆寫 Origin 標頭（跨站情境用）；預設同源 */
  origin?: string;
}

export interface ActionResponse {
  status: number;
  /** flight 回應原文；錯誤碼以 `"code":"XXX"` 的字面出現其中 */
  text: string;
  /**
   * Action 寫入的工作階段 Cookie（`name=value` 形式），沒有則為 null。
   *
   * `becomeAuthorAction` 會在撤銷全部工作階段後**為當前裝置補發**一份新憑證
   * （FR-023、research R-12）。「使用者無須重新登入」這句話能不能驗證，
   * 完全取決於測試拿不拿得到這個標頭。
   */
  setCookie: string | null;
}

/** 對 Server Action 端點發出一次真實 POST */
export async function callAction(
  exportedName: string,
  args: unknown[],
  opts: CallActionOptions
): Promise<ActionResponse> {
  const ref = actionRef(exportedName);
  const route = opts.route ?? pickRoute(ref, exportedName);

  const headers = new Headers({
    'Next-Action': ref.id,
    'Content-Type': 'text/plain;charset=UTF-8',
    'X-Forwarded-For': opts.ip,
    Origin: opts.origin ?? baseUrl(),
  });
  if (opts.cookie) headers.set('Cookie', opts.cookie);

  const res = await fetch(`${baseUrl()}${route}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(args),
    redirect: 'manual',
  });

  const rawSetCookie = res.headers.get('set-cookie');
  return {
    status: res.status,
    text: await res.text(),
    setCookie: rawSetCookie ? rawSetCookie.split(';')[0] : null,
  };
}

/** 回應中是否帶有指定的 ActionResult 錯誤碼 */
export function hasErrorCode(res: ActionResponse, code: string): boolean {
  return res.text.includes(`"code":"${code}"`);
}
