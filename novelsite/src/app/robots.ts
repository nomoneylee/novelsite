import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/siteConfig';

/**
 * robots.txt
 * ============
 * 允許索引公開內容，排除個人／作者後台等私有路由，並指向 sitemap。
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/author/', '/profile/', '/auth/'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
