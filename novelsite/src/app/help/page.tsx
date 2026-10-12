import type { Metadata } from 'next';
import { StaticPage } from '@/components/layout/StaticPage';

export const metadata: Metadata = {
  title: '幫助中心',
  description: 'NovelSite 常見問題與使用說明，快速找到你需要的答案。',
};

export default function HelpPage() {
  return (
    <StaticPage title="幫助中心" subtitle="常見問題與使用說明" id="help-page">
      <h2>閱讀相關</h2>
      <h3>如何調整閱讀的字體與主題？</h3>
      <p>
        進入任一章節的閱讀頁後，底部的浮動工具欄提供字體大小（A- / A / A+）與背景主題（白紙 / 護眼 /
        夜間）切換，你的偏好會自動記憶，跨章節維持一致。
      </p>

      <h3>如何切換上一章／下一章？</h3>
      <p>
        閱讀頁上下方均有章節導航按鈕；在電腦上也可直接使用鍵盤左右方向鍵（←
        →），行動裝置則支援左右滑動換章。
      </p>

      <h2>帳號與書架</h2>
      <h3>如何收藏作品？</h3>
      <p>在作品頁點擊「加入書架」即可收藏；收藏的作品會出現在「我的書架」，方便隨時接續閱讀。</p>

      <h3>閱讀歷史如何運作？</h3>
      <p>
        當你閱讀章節時，系統會自動記錄最近讀到的位置，你可以在個人中心的「閱讀歷史」查看並快速回到上次的進度。
      </p>

      <h2>創作相關</h2>
      <h3>我要如何開始創作？</h3>
      <p>
        前往作者後台的「開始創作」建立作品，接著在章節編輯器撰寫內容。更多細節可參考我們的
        <a href="/author/guide">創作指南</a>。
      </p>

      <h2>還是找不到答案？</h2>
      <p>
        歡迎前往<a href="/contact">聯絡我們</a>，我們會盡快回覆你的問題。
      </p>
    </StaticPage>
  );
}
