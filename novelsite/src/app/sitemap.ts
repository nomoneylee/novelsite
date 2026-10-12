import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/siteConfig';
import { getAllNovels, getCategories } from '@/lib/repositories';

/**
 * 全站 Sitemap
 * ==============
 * 靜態頁 + 動態作品頁（/novels/[id]）+ 分類頁（/categories/[id]）。
 * 資料來源一律走 repository 層，與底層資料庫解耦。
 *
 * 作品清單只收**已發佈**者（FR-037）—— 條件落在 `getAllNovels()` 內（T029）。
 */

/**
 * 逐請求求值，MUST NOT 依賴建置期產物（FR-037、US1 AC8、research.md R-16.1）。
 *
 * `sitemap.ts` 在 Next 16 是「**預設被快取**」的 Route Handler：只補上 `status` 條件
 * 而不加這一行的話，網站地圖會凍結在建置當下的作品清單 —— 作者下架作品後，
 * 搜尋引擎拿到的地圖仍然指向一個已經 404 的網址，而且要等到下一次部署才會修正。
 * 這正是 T006 查證時發現、而任務原文沒有涵蓋的部分。
 */
export const dynamic = 'force-dynamic';
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  // 靜態頁面（含優先權與更新頻率）
  const staticRoutes: MetadataRoute.Sitemap = (
    [
      { url: `${SITE_URL}/`, changeFrequency: 'daily', priority: 1 },
      { url: `${SITE_URL}/novels`, changeFrequency: 'daily', priority: 0.9 },
      { url: `${SITE_URL}/categories`, changeFrequency: 'weekly', priority: 0.8 },
      { url: `${SITE_URL}/new-releases`, changeFrequency: 'daily', priority: 0.8 },
      { url: `${SITE_URL}/ranking`, changeFrequency: 'daily', priority: 0.8 },
      { url: `${SITE_URL}/search`, changeFrequency: 'monthly', priority: 0.5 },
      { url: `${SITE_URL}/author/guide`, changeFrequency: 'monthly', priority: 0.4 },
      { url: `${SITE_URL}/about`, changeFrequency: 'monthly', priority: 0.4 },
      { url: `${SITE_URL}/help`, changeFrequency: 'monthly', priority: 0.3 },
      { url: `${SITE_URL}/contact`, changeFrequency: 'monthly', priority: 0.3 },
      { url: `${SITE_URL}/privacy`, changeFrequency: 'yearly', priority: 0.2 },
      { url: `${SITE_URL}/terms`, changeFrequency: 'yearly', priority: 0.2 },
    ] as const
  ).map((route) => ({ ...route, lastModified: now }));

  // 動態作品頁
  const novels = await getAllNovels();
  const novelRoutes: MetadataRoute.Sitemap = novels.map((novel) => ({
    url: `${SITE_URL}/novels/${novel.id}`,
    lastModified: now,
    changeFrequency: 'daily',
    priority: 0.7,
  }));

  // 動態分類頁
  const categories = await getCategories();
  const categoryRoutes: MetadataRoute.Sitemap = categories.map((category) => ({
    url: `${SITE_URL}/categories/${category.id}`,
    lastModified: now,
    changeFrequency: 'weekly',
    priority: 0.6,
  }));

  return [...staticRoutes, ...novelRoutes, ...categoryRoutes];
}
