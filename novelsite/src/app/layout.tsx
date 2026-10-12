import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { ThemeProvider } from '@/components/ThemeProvider';
import { ToastContainer } from '@/components/ui/Toast';
import { Analytics } from '@/components/Analytics';
import { SessionProvider } from '@/components/SessionProvider';
import { getSessionUser } from '@/lib/auth/guard';
import { SITE_URL, SITE_DESCRIPTION } from '@/lib/siteConfig';
import '@/styles/global.css';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'NovelSite — 繁體中文原創文學平台',
    template: '%s | NovelSite',
  },
  description: SITE_DESCRIPTION,
  keywords: ['小說', '繁體中文', '線上小說', '玄幻', '言情', '閱讀', '原創文學'],
  authors: [{ name: 'NovelSite Team' }],
  creator: 'NovelSite',
  openGraph: {
    type: 'website',
    locale: 'zh_TW',
    url: SITE_URL,
    siteName: 'NovelSite',
    title: 'NovelSite — 繁體中文原創文學平台',
    description: '沉浸式繁體中文原創文學閱讀平台',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'NovelSite — 繁體中文原創文學平台',
    description: '沉浸式繁體中文原創文學閱讀平台',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
    },
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // 讀取 nonce 同時使整棵樹進入動態產生（FR-027、FR-047，見 research.md R-2a）
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  const user = await getSessionUser();

  return (
    <html lang="zh-TW" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        {/* 防止主題閃爍的內聯腳本。suppressHydrationWarning：瀏覽器的 nonce 屬性隱藏機制會讓
            DOM 讀回的 nonce 為空字串，與伺服器渲染值不符，屬預期中的良性 hydration 差異
            （見 Next.js docs preventing-flash-before-hydration.md）*/}
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var stored = localStorage.getItem('novelsite-theme');
                  var validThemes = ['light', 'dark', 'eyecare'];
                  if (stored && validThemes.includes(stored)) {
                    document.documentElement.setAttribute('data-theme', stored);
                  } else {
                    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                    document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
                  }
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>
      <body>
        <SessionProvider user={user}>
          <ThemeProvider>
            {children}
            <ToastContainer />
          </ThemeProvider>
          <Analytics />
        </SessionProvider>
      </body>
    </html>
  );
}
