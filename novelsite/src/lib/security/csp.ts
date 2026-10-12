/**
 * 純函式：輸入 nonce 與模式旗標，輸出完整 CSP 政策字串。
 * MUST NOT 讀 process.env —— isDev 由呼叫端傳入，讓單元測試可同時斷言兩種模式（FR-035）。
 */
export function buildCspPolicy(nonce: string, opts: { isDev: boolean }): string {
  const { isDev } = opts;

  const scriptSrc = [
    `'self'`,
    `'nonce-${nonce}'`,
    `'strict-dynamic'`,
    ...(isDev ? [`'unsafe-eval'`] : []),
  ].join(' ');

  const directives = [
    `default-src 'self'`,
    `script-src ${scriptSrc}`,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
    `img-src 'self' data: https://www.google-analytics.com https://www.googletagmanager.com`,
    `font-src 'self' data: https://fonts.gstatic.com`,
    `connect-src 'self' https://www.google-analytics.com https://www.googletagmanager.com https://www.google.com`,
    `object-src 'none'`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
  ];

  return directives.join('; ');
}
