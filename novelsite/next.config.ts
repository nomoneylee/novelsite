import type { NextConfig } from 'next';

// 五個安全性標頭（CSP 除外，CSP 需逐請求 nonce，見 src/proxy.ts）。
// 套用於所有回應（含靜態資源），正好與 proxy.ts 的 matcher 排除清單互補，
// 達成「靜態資源有防護但無 CSP 標頭」的要求（FR-025、FR-053）。
const SECURITY_HEADERS = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  // 子路徑部署（FR-072）。**MUST NOT 寫死 `/novelsite`** —— 寫死之後本機開發、
  // 四套既有測試與 E2E 全部得改走子路徑，而它們至今唯一驗證過的形態是網域根目錄。
  // 未設定時回落空字串＝維持根目錄部署，行為與本階段前完全相同（SC-019）。
  // 此值為**建置期常數**（被 inline 進 client bundle），改動它 MUST 重新建置。
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? '',
  // 容器映像只需 `.next/standalone` 與其相依，不必整包 node_modules（US3 的 Dockerfile 依賴此輸出）
  output: 'standalone',
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
