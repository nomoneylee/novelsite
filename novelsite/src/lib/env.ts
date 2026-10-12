/**
 * 環境變數驗證（contracts/env.md）
 * 設定不足時 MUST 明確失敗，MUST NOT 靜默降級（FR-049）。
 */
import path from 'node:path';

/**
 * 寄送實作的**唯一**選用依據（FEAT-5 FR-002b、research R-3）。
 *
 * 為什麼是顯式設定而不是只依 `NODE_ENV` 推導：整合測試以**正式建置產物**啟動測試伺服器，
 * 該伺服器的 `NODE_ENV` 是 `production`；只依環境推導就會撞上「正式環境缺憑證即拒絕啟動」，
 * 而 `.env.test` 又禁止放憑證（FR-003）—— 三者相加使測試伺服器根本起不來。
 */
export type MailMode = 'production' | 'memory' | 'console';

/** `CONTACT_EMAIL` 未設定時的過渡預設值（FR-022），未設定會於啟動記錄標示 */
export const DEFAULT_CONTACT_EMAIL = 'contact@example.com';

/**
 * memory 模式的寄件落地檔名。基準是 `process.cwd()`，即應用根 `novelsite/`（**非 repo 根**）——
 * `novelsite/.gitignore` 的 `/.mail-outbox.jsonl` 開頭的 `/` 錨定該目錄，
 * 基準取成 repo 根會使落地檔逃過忽略而被版控追蹤（research R-6）。
 *
 * **`tests/helpers/outbox.ts` 自行複製了同一個預設值**（該檔 MUST NOT import `src/**`）。
 * 兩處不一致時測試永遠讀到空 outbox，而症狀是「信沒寄」——會被誤判成 `after()` 或寄送實作壞了。
 */
export const DEFAULT_MAIL_OUTBOX_FILENAME = '.mail-outbox.jsonl';

export interface ValidatedEnv {
  DATABASE_PROVIDER: 'sqlite' | 'postgresql';
  DATABASE_URL: string;
  SESSION_SECRET: string;
  SESSION_TTL_DAYS: number;
  SESSION_ABSOLUTE_TTL_DAYS: number;
  SESSION_SLIDING_THROTTLE_HOURS: number;
  /**
   * 工作階段 Cookie 是否加上 `Secure`。預設 `NODE_ENV === 'production'`（行為不變）。
   *
   * **唯一的正當關閉理由是「以正式建置產物在 `http://localhost` 上跑測試」**
   * （FEAT-4 T150）：WebKit 不把 `http://localhost` 當成安全內容，
   * `Secure` 的 Cookie 會被直接丟棄，讀者流在 webkit 上連登入都過不了；
   * Chromium 與 Firefox 則允許，故這個差異只在跨引擎驗收時才會現形。
   * 關閉時 MUST 於啟動記錄明確警示 —— 一個能悄悄關掉的安全屬性等於沒有。
   */
  SESSION_COOKIE_SECURE: boolean;
  TRUSTED_PROXY_HOPS: number;
  HEALTH_CHECK_SECRET: string | undefined;
  SEED_USER_PASSWORD: string | undefined;
  LOGIN_RATE_IP_MAX: number;
  LOGIN_RATE_ACCOUNT_MAX: number;
  REGISTER_RATE_IP_MAX: number;
  /** 身分敏感操作的額度（FEAT-3 FR-024a），鍵為使用者識別碼、時間窗沿用登入的帳號窗 */
  PASSWORD_CHANGE_RATE_MAX: number;
  AUTHOR_UPGRADE_RATE_MAX: number;
  NEXT_PUBLIC_SITE_URL: string;
  NEXT_PUBLIC_GA_ID: string | undefined;
  // ── FEAT-4 讀者互動與數據（data-model.md §9 的 11 個設定值） ──
  /** `ChapterView.viewerHash` 的固定鹽值；未設定或 < 32 bytes 即拒絕啟動（FR-034） */
  VIEW_HASH_SECRET: string;
  /**
   * 三個排程入口的 Bearer 密鑰。**刻意可為 undefined**：
   * 它的「未設定即拒絕」發生在 Route Handler 內（research R-11）。
   */
  CRON_SECRET: string | undefined;
  VIEW_DEDUPE_WINDOW_MINUTES: number;
  /** 閱讀明細保留期；同時是成效總覽期間的上界 */
  VIEW_RETENTION_DAYS: number;
  CHAPTER_VIEW_RATE_MAX: number;
  INTERACTION_RATE_MAX: number;
  READING_HISTORY_MAX: number;
  MERGE_BATCH_MAX: number;
  NOTIFICATION_RETENTION_DAYS: number;
  PROGRESS_REPORT_INTERVAL_SECONDS: number;
  CRON_BASE_URL: string;
  // ── FEAT-5 郵件基礎設施（data-model.md §5 的 9 個設定值） ──
  /** 寄送實作的唯一選用依據；未設定時依 `NODE_ENV` 推導（FR-002b） */
  MAIL_MODE: MailMode;
  /** `MAIL_MODE=production` 時缺漏即拒絕啟動；其餘模式一律 undefined 亦可 */
  RESEND_API_KEY: string | undefined;
  /** 寄件位址。同上，MUST NOT 寫死於原始碼（FR-003） */
  MAIL_FROM: string | undefined;
  /** 對外聯絡信箱（FR-022）。未設定時回落至 `DEFAULT_CONTACT_EMAIL` 並於啟動記錄標示 */
  CONTACT_EMAIL: string;
  /** 重設憑證有效期（分鐘，FR-008）。信件文案的分鐘數 MUST 取自此值而非寫死 */
  PASSWORD_RESET_TOKEN_TTL_MINUTES: number;
  /**
   * 重設申請的**帳號鍵**額度（3 次/小時，FR-005a）。
   * **位址鍵刻意不新增變數**：沿用 `LOGIN_RATE_IP_MAX`（與登入同性質，防的是枚舉掃描）——
   * 多一個變數就多一個會與登入漂移的值。
   */
  PASSWORD_RESET_RATE_ACCOUNT_MAX: number;
  /** 聯絡表單的位址鍵額度（3 次/小時，FR-018） */
  CONTACT_RATE_IP_MAX: number;
  /** 僅 `memory` 模式使用（research R-6）。預設基準見 `DEFAULT_MAIL_OUTBOX_FILENAME` */
  MAIL_OUTBOX_PATH: string;
  /**
   * 僅 `memory` 模式使用：寫入 outbox 前先等這麼久。
   * `.env.test` 設 300 —— 這是「寄送確實在回應之後」那道測試的**解析度**，
   * 設 0 會使該測試失去鑑別力（research R-6）。
   */
  MAIL_MEMORY_DELAY_MS: number;
}

/** 啟動記錄的一則輸出。副作用一律在 `validateEnv()` 之外（research R-15） */
export interface StartupNotice {
  level: 'log' | 'warn';
  message: string;
}

/** quickstart.md §1 的範例佔位字串；直接沿用未替換即拒絕啟動 */
export const EXAMPLE_SESSION_SECRET = '<至少 32 bytes 的隨機值，不得使用範例值>';

function toInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * 純函式：輸入設定來源，輸出驗證後的設定；不通過即擲出指明缺漏項的錯誤。
 * MUST NOT 讀 process.env、MUST NOT 有副作用（FR-049）。
 */
export function validateEnv(source: Record<string, string | undefined>): ValidatedEnv {
  const sessionSecret = source.SESSION_SECRET;
  if (!sessionSecret) {
    throw new Error(
      '環境變數驗證失敗：缺少 SESSION_SECRET（jose 簽章密鑰，MUST 設定且 ≥ 32 bytes，不得為範例值）'
    );
  }
  if (sessionSecret === EXAMPLE_SESSION_SECRET) {
    throw new Error('環境變數驗證失敗：SESSION_SECRET 仍為文件範例值，MUST 換成實際的隨機密鑰');
  }
  if (Buffer.byteLength(sessionSecret, 'utf8') < 32) {
    throw new Error('環境變數驗證失敗：SESSION_SECRET 長度不足 32 bytes');
  }

  const providerRaw = source.DATABASE_PROVIDER ?? 'sqlite';
  if (providerRaw !== 'sqlite' && providerRaw !== 'postgresql') {
    throw new Error(
      `環境變數驗證失敗：DATABASE_PROVIDER 必須為 "sqlite" 或 "postgresql"，收到 "${providerRaw}"`
    );
  }
  const provider = providerRaw;

  const databaseUrl = source.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('環境變數驗證失敗：缺少 DATABASE_URL');
  }
  const isFileUrl = databaseUrl.startsWith('file:');
  if (provider === 'postgresql' && isFileUrl) {
    throw new Error(
      '環境變數驗證失敗：DATABASE_PROVIDER=postgresql 但 DATABASE_URL 為 SQLite 連線字串（file:），兩者不相符'
    );
  }
  if (provider === 'sqlite' && !isFileUrl) {
    throw new Error(
      '環境變數驗證失敗：DATABASE_PROVIDER=sqlite 但 DATABASE_URL 非 SQLite 連線字串（file:），兩者不相符'
    );
  }

  /**
   * FEAT-4（FR-034）：閱讀去重雜湊的鹽值。
   * 它**固定、專用、不隨日期輪替** —— 換值等同讓既有的每一筆 `viewerHash` 失去可比性，
   * 去重窗口會在換值當下整個失效。故它 MUST 於啟動期就位，MUST NOT 由應用程式自行產生。
   */
  const viewHashSecret = source.VIEW_HASH_SECRET;
  if (!viewHashSecret) {
    throw new Error(
      '環境變數驗證失敗：缺少 VIEW_HASH_SECRET（閱讀去重雜湊的固定鹽值，MUST 設定且 ≥ 32 bytes）'
    );
  }
  if (Buffer.byteLength(viewHashSecret, 'utf8') < 32) {
    throw new Error('環境變數驗證失敗：VIEW_HASH_SECRET 長度不足 32 bytes');
  }

  /**
   * FEAT-5（FR-002b、research R-3）：三個值以外一律擲錯。
   * **拼錯 MUST NOT 靜默退到某個模式** —— 把 `MAIL_MODE=prod` 當成 `console`，
   * 正式站就會在完全沒有徵兆的情況下一封信也不寄。
   */
  const mailModeRaw = source.MAIL_MODE;
  if (
    mailModeRaw !== undefined &&
    mailModeRaw !== 'production' &&
    mailModeRaw !== 'memory' &&
    mailModeRaw !== 'console'
  ) {
    throw new Error(
      `環境變數驗證失敗：MAIL_MODE 必須為 "production"、"memory" 或 "console"，收到 "${mailModeRaw}"`
    );
  }
  const mailMode: MailMode =
    mailModeRaw ?? (source.NODE_ENV === 'production' ? 'production' : 'console');

  const resendApiKey = source.RESEND_API_KEY;
  const mailFrom = source.MAIL_FROM;
  if (mailMode === 'production') {
    // 三道各自獨立、訊息各自指名缺漏項（SC-013）：合併成一句「郵件設定不完整」，
    // 讀到的人還是得自己一個一個試
    if (!resendApiKey) {
      throw new Error(
        '環境變數驗證失敗：MAIL_MODE=production 但缺少 RESEND_API_KEY（寄送服務的 API 金鑰）'
      );
    }
    if (!mailFrom) {
      throw new Error(
        '環境變數驗證失敗：MAIL_MODE=production 但缺少 MAIL_FROM（寄件位址，MUST NOT 寫死於原始碼）'
      );
    }
    /**
     * FR-016a／SC-013a：重設連結是**絕對網址**，取自 `siteConfig.SITE_URL`。
     * 該值靜默回落到 `https://novelsite.tw` 對 metadata／sitemap 只是標註不準，
     * 對重設信卻是「每一封信的連結都指向別的網站，而系統仍回報已寄出」——
     * SC-001 表面通過、實際全滅。故在此把回落改成拒絕啟動（僅限 production 模式）。
     */
    if (!source.NEXT_PUBLIC_SITE_URL) {
      throw new Error(
        '環境變數驗證失敗：MAIL_MODE=production 但未明示 NEXT_PUBLIC_SITE_URL（重設連結的絕對網址來源，MUST NOT 使用回落值）'
      );
    }
  }

  return {
    DATABASE_PROVIDER: provider,
    DATABASE_URL: databaseUrl,
    SESSION_SECRET: sessionSecret,
    SESSION_TTL_DAYS: toInt(source.SESSION_TTL_DAYS, 30),
    SESSION_ABSOLUTE_TTL_DAYS: toInt(source.SESSION_ABSOLUTE_TTL_DAYS, 90),
    SESSION_SLIDING_THROTTLE_HOURS: toInt(source.SESSION_SLIDING_THROTTLE_HOURS, 24),
    // 只認字面上的 'false'：任何其他值（含空字串與拼錯）一律回退到預設，
    // 讓「打錯字」的結果是保守而非把 Secure 關掉
    // `source.NODE_ENV`（MUST NOT 讀 process.env —— 本函式是純函式）
    SESSION_COOKIE_SECURE:
      source.SESSION_COOKIE_SECURE === 'false' ? false : source.NODE_ENV === 'production',
    TRUSTED_PROXY_HOPS: toInt(source.TRUSTED_PROXY_HOPS, 0),
    HEALTH_CHECK_SECRET: source.HEALTH_CHECK_SECRET,
    SEED_USER_PASSWORD: source.SEED_USER_PASSWORD,
    LOGIN_RATE_IP_MAX: toInt(source.LOGIN_RATE_IP_MAX, 5),
    LOGIN_RATE_ACCOUNT_MAX: toInt(source.LOGIN_RATE_ACCOUNT_MAX, 5),
    REGISTER_RATE_IP_MAX: toInt(source.REGISTER_RATE_IP_MAX, 3),
    // 開通作者的額度比改密碼更緊：一個帳號一生只需要成功一次（FR-024a）
    PASSWORD_CHANGE_RATE_MAX: toInt(source.PASSWORD_CHANGE_RATE_MAX, 5),
    AUTHOR_UPGRADE_RATE_MAX: toInt(source.AUTHOR_UPGRADE_RATE_MAX, 3),
    NEXT_PUBLIC_SITE_URL: source.NEXT_PUBLIC_SITE_URL ?? 'https://novelsite.tw',
    NEXT_PUBLIC_GA_ID: source.NEXT_PUBLIC_GA_ID,
    VIEW_HASH_SECRET: viewHashSecret,
    // CRON_SECRET **MUST NOT** 列入啟動期必要變數（research R-11）：把它列為必要，
    // 會讓本機開發者沒設就整個站啟動不了，而它只影響三個排程入口。
    // 「未設定即拒絕」由 `assertCronSecret()` 在 handler 內執行。
    CRON_SECRET: source.CRON_SECRET,
    VIEW_DEDUPE_WINDOW_MINUTES: toInt(source.VIEW_DEDUPE_WINDOW_MINUTES, 30),
    VIEW_RETENTION_DAYS: toInt(source.VIEW_RETENTION_DAYS, 7),
    CHAPTER_VIEW_RATE_MAX: toInt(source.CHAPTER_VIEW_RATE_MAX, 60),
    INTERACTION_RATE_MAX: toInt(source.INTERACTION_RATE_MAX, 10),
    READING_HISTORY_MAX: toInt(source.READING_HISTORY_MAX, 500),
    MERGE_BATCH_MAX: toInt(source.MERGE_BATCH_MAX, 200),
    NOTIFICATION_RETENTION_DAYS: toInt(source.NOTIFICATION_RETENTION_DAYS, 90),
    PROGRESS_REPORT_INTERVAL_SECONDS: toInt(source.PROGRESS_REPORT_INTERVAL_SECONDS, 30),
    CRON_BASE_URL: source.CRON_BASE_URL ?? 'http://localhost:3100',
    MAIL_MODE: mailMode,
    RESEND_API_KEY: resendApiKey,
    MAIL_FROM: mailFrom,
    CONTACT_EMAIL: source.CONTACT_EMAIL ?? DEFAULT_CONTACT_EMAIL,
    PASSWORD_RESET_TOKEN_TTL_MINUTES: toInt(source.PASSWORD_RESET_TOKEN_TTL_MINUTES, 30),
    PASSWORD_RESET_RATE_ACCOUNT_MAX: toInt(source.PASSWORD_RESET_RATE_ACCOUNT_MAX, 3),
    CONTACT_RATE_IP_MAX: toInt(source.CONTACT_RATE_IP_MAX, 3),
    // `process.cwd()` 不是 `process.env`，不違反本函式的純度約束；
    // 而工作目錄一律是 novelsite/，故此預設在 dev、next start 與三套測試下皆同值
    MAIL_OUTBOX_PATH:
      source.MAIL_OUTBOX_PATH ?? path.join(process.cwd(), DEFAULT_MAIL_OUTBOX_FILENAME),
    MAIL_MEMORY_DELAY_MS: toInt(source.MAIL_MEMORY_DELAY_MS, 0),
  };
}

/**
 * 郵件相關的啟動記錄（research R-15 的六種情況）。
 *
 * **刻意做成回傳字串而非直接 `console`**：`validateEnv()` MUST 維持純函式，
 * 而「降級模式要有警示」本身是一條需要被斷言的規則（SC-013 的另一半）。
 * 若把 `console.warn` 寫死在模組載入處，唯一的測試方式是「重設模組快取 + 改寫
 * `process.env`」——那測的是模組載入時序，不是規則，且會在測試檔之間互相污染
 * （`arch.md` §3.5 明文禁止）。
 *
 * `source` 是為了分辨「顯式設定成預設值」與「根本沒設定」——
 * 兩者在 `validated.CONTACT_EMAIL` 上看起來完全一樣。
 */
export function mailStartupNotices(
  validated: ValidatedEnv,
  source: Record<string, string | undefined>
): StartupNotice[] {
  const notices: StartupNotice[] = [];

  switch (validated.MAIL_MODE) {
    case 'production':
      // MUST NOT 印出 RESEND_API_KEY：啟動記錄是站上少數會被整段貼進 issue 的輸出
      notices.push({ level: 'log', message: `[mail] mode=production from=${validated.MAIL_FROM}` });
      break;
    case 'console':
      notices.push({
        level: 'warn',
        message:
          '[mail] mode=console：目前不會真的寄信，收件人／主旨／全文（含重設連結）只會印到伺服器主控台。MUST NOT 用於對外部署。',
      });
      break;
    case 'memory':
      notices.push({
        level: 'warn',
        message: `[mail] mode=memory：目前不會真的寄信，內容寫入 ${validated.MAIL_OUTBOX_PATH}。MUST NOT 用於對外部署。`,
      });
      break;
  }

  if (source.CONTACT_EMAIL === undefined) {
    notices.push({
      level: 'warn',
      message: `[mail] CONTACT_EMAIL 未設定，採用過渡預設值 ${DEFAULT_CONTACT_EMAIL}`,
    });
  }

  return notices;
}

export const env: ValidatedEnv = validateEnv(process.env);

// 啟動記錄（副作用，MUST NOT 寫進 validateEnv，見 contracts/env.md §3）
console.log('[env] rateLimitMode=single-instance');
if (!env.SESSION_COOKIE_SECURE && process.env.NODE_ENV === 'production') {
  console.warn(
    '[env] SESSION_COOKIE_SECURE=false：工作階段 Cookie 未加上 Secure，將可經未加密連線傳送。此設定僅供以正式建置產物在 http://localhost 執行測試之用，MUST NOT 用於任何對外部署。'
  );
}
if (process.env.TRUSTED_PROXY_HOPS === undefined) {
  console.warn(
    '[env] TRUSTED_PROXY_HOPS 未設定（預設 0）：部署於代理／CDN 後方時，來源位址將退化為全站共用單一值，限流與安全事件記錄會失去意義。'
  );
}
// FEAT-5（research R-15）：「不會真的寄信」的降級 MUST 在啟動時被看見 ——
// 沒有警示的降級就是靜默降級（SC-013 的另一半）
for (const notice of mailStartupNotices(env, process.env)) {
  if (notice.level === 'warn') console.warn(notice.message);
  else console.log(notice.message);
}
