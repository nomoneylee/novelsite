import type { Metadata } from 'next';
import { StaticPage } from '@/components/layout/StaticPage';

export const metadata: Metadata = {
  title: '關於我們',
  description: 'NovelSite 是一個以沉浸式閱讀體驗為核心的繁體中文原創文學平台。',
  openGraph: {
    title: '關於我們 | NovelSite',
    description: '了解 NovelSite 的理念：文字是主角，UI 是配角。',
    type: 'website',
  },
};

export default function AboutPage() {
  return (
    <StaticPage title="關於 NovelSite" subtitle="沉浸式繁體中文原創文學平台" id="about-page">
      <h2>我們的理念</h2>
      <p>
        NovelSite 相信「<strong>文字是主角，UI 是配角</strong>
        」。我們打造的不是又一個功能堆疊的閱讀站，而是一個讓讀者能真正沉浸於故事、進入心流狀態的閱讀空間。
      </p>
      <p>
        我們深度優化繁體中文的閱讀體驗——從行寬、行距、字間距，到白紙、護眼、夜間三段主題，每一個細節都是為了降低視覺疲勞，讓你能專注在文字本身。
      </p>

      <h2>給讀者</h2>
      <p>
        海量玄幻、都市、言情、科幻、歷史、懸疑等原創作品，每日更新。個人書架與閱讀歷史讓你隨時接續上次的故事，不錯過任何精彩章節。
      </p>

      <h2>給作者</h2>
      <p>
        我們提供完整的創作工具：支援 Markdown
        的章節編輯器、即時的數據儀表板，以及清楚的作品成效回饋。我們希望成為你創作路上最可靠的夥伴，讓好故事被更多人看見。
      </p>

      <h2>聯絡我們</h2>
      <p>
        有任何建議或合作提案，歡迎前往<a href="/contact">聯絡我們</a>頁面與我們聯繫。
      </p>
    </StaticPage>
  );
}
