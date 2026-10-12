import type { Metadata } from 'next';
import { StaticPage } from '@/components/layout/StaticPage';
import { env } from '@/lib/env';

export const metadata: Metadata = {
  title: '隱私政策',
  description: 'NovelSite 隱私政策：我們如何蒐集、使用與保護你的個人資料。',
};

/**
 * 逐請求求值（FEAT-5 T041 裁示，2026-08-10；SC-008）。
 *
 * SC-008 的字面要求是「**僅需變更設定並重啟服務**」—— 不含重新建置。
 * 本頁在此之前是純靜態頁，會被建置期預渲染，`env.CONTACT_EMAIL` 於是被**烤進 HTML**：
 * 營運者換了信箱、重啟服務，頁面上仍是建置當下的舊位址，
 * 而**畫面看起來完全正常**，只有寄到舊位址的個資權利行使請求沒有人收得到。
 *
 * 這一行的成本是本頁改為每次請求渲染（無資料查詢，僅字串組裝）；
 * `sitemap.ts` 因同一類理由（不得凍結在建置當下）已有先例。
 */
export const dynamic = 'force-dynamic';

export default function PrivacyPage() {
  return (
    <StaticPage title="隱私政策" updatedAt="2026-07-22" id="privacy-page">
      <p>
        NovelSite（以下稱「本平台」）重視你的隱私。本政策說明我們如何蒐集、使用與保護你的個人資料。使用本平台即表示你同意本政策所述的做法。
      </p>

      <h2>一、我們蒐集的資料</h2>
      <ul>
        <li>
          <strong>帳號資料</strong>：註冊時提供的 Email、暱稱等基本資訊。
        </li>
        <li>
          <strong>使用資料</strong>：閱讀歷史、書架收藏、閱讀偏好設定（字體、主題等）。
        </li>
        <li>
          <strong>技術資料</strong>：裝置類型、瀏覽器與必要的日誌資訊，以維持服務運作與安全。
        </li>
      </ul>

      <h2>二、資料的使用</h2>
      <p>我們使用蒐集到的資料以：</p>
      <ul>
        <li>提供並維持平台的閱讀與創作功能；</li>
        <li>記憶你的閱讀偏好，改善閱讀體驗；</li>
        <li>提供個人化的作品推薦；</li>
        <li>維護平台安全並防止濫用。</li>
      </ul>

      <h2>三、資料的分享</h2>
      <p>除非取得你的同意、或依法律要求，本平台不會將你的個人資料出售或提供給第三方。</p>

      <h2>四、你的權利</h2>
      {/*
        位址取自設定（FR-022／FR-024），MUST NOT 硬編：這裡是法遵管道而非一般功能入口，
        只給一個指向表單的連結等於「政策宣告了權利，但行使入口沒有出口」。
        既有的「聯絡我們」連結**保留**——新位址是追加，不是取代。
      */}
      <p>
        你有權查閱、更正或刪除你的個人資料，亦可要求停止特定的資料處理。如需行使上述權利，請透過
        <a href="/contact">聯絡我們</a>與我們聯繫，或直接來信{' '}
        <a href={`mailto:${env.CONTACT_EMAIL}`}>{env.CONTACT_EMAIL}</a>。
      </p>

      <h2>五、政策更新</h2>
      <p>本平台可能不定期修訂本政策，修訂內容將於本頁公告。建議你定期查閱以了解最新版本。</p>
    </StaticPage>
  );
}
