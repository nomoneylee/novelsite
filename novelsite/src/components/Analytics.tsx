import Script from 'next/script';
import { headers } from 'next/headers';

/**
 * Google Analytics 4 埋點
 * =========================
 * 由環境變數 `NEXT_PUBLIC_GA_ID`（如 `G-XXXXXXXXXX`）啟用。
 * 未設定時完全不輸出任何 script，開發／預覽環境保持乾淨，正式環境設定即生效。
 * 之後若改用 Plausible 或 Vercel Analytics，只需替換本元件。
 */
export async function Analytics() {
  const gaId = process.env.NEXT_PUBLIC_GA_ID;
  if (!gaId) return null;

  const nonce = (await headers()).get('x-nonce') ?? undefined;

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`}
        strategy="afterInteractive"
        nonce={nonce}
      />
      <Script id="ga4-init" strategy="afterInteractive" nonce={nonce}>
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${gaId}');
        `}
      </Script>
    </>
  );
}
