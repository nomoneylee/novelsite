/**
 * 全站基礎設定（Site Config）
 * =============================
 * 集中管理站點對外的正式網址與品牌資訊，供 metadata、sitemap、robots 共用。
 * 上線時可透過環境變數 `NEXT_PUBLIC_SITE_URL` 覆寫（例如 Vercel 部署網域）。
 */

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://novelsite.tw').replace(
  /\/$/,
  ''
);

export const SITE_NAME = 'NovelSite';

export const SITE_DESCRIPTION =
  '沉浸式繁體中文原創文學閱讀平台，收錄玄幻、都市、言情、科幻、歷史、懸疑等海量優質小說，提供極致閱讀體驗。';
