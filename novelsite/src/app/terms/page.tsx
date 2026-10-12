import type { Metadata } from 'next';
import { StaticPage } from '@/components/layout/StaticPage';

export const metadata: Metadata = {
  title: '服務條款',
  description: 'NovelSite 服務條款：使用本平台前請詳閱以下條款。',
};

export default function TermsPage() {
  return (
    <StaticPage title="服務條款" updatedAt="2026-07-22" id="terms-page">
      <p>
        歡迎使用
        NovelSite（以下稱「本平台」）。當你存取或使用本平台的服務時，即表示你已閱讀、理解並同意受本條款約束。
      </p>

      <h2>一、帳號使用</h2>
      <ul>
        <li>你應對帳號的安全負責，並對透過該帳號進行的所有活動負責。</li>
        <li>你承諾提供正確、完整的註冊資訊，並在資訊變更時即時更新。</li>
      </ul>

      <h2>二、內容與著作權</h2>
      <ul>
        <li>
          作者於本平台發表的作品，其著作權歸原作者所有。作者授予本平台於平台上展示、傳輸與推廣該作品的必要權利。
        </li>
        <li>你不得未經授權重製、散布或改作他人於本平台發表的內容。</li>
      </ul>

      <h2>三、使用者行為</h2>
      <p>使用本平台時，你同意不從事下列行為：</p>
      <ul>
        <li>發表違法、侵權、誹謗或令人反感的內容；</li>
        <li>干擾或破壞平台的正常運作與安全；</li>
        <li>以自動化方式大量擷取平台內容。</li>
      </ul>

      <h2>四、服務變更與中止</h2>
      <p>本平台保留隨時修改、暫停或終止全部或部分服務的權利，並將於合理範圍內事先通知。</p>

      <h2>五、免責聲明</h2>
      <p>
        本平台之服務係以「現狀」提供。對於使用者發表之內容，本平台不對其正確性或合法性承擔責任。
      </p>

      <h2>六、條款修訂</h2>
      <p>
        本平台可能不定期修訂本條款，修訂後之條款將於本頁公告後生效。若你於修訂後繼續使用服務，即視為同意修訂內容。
      </p>
    </StaticPage>
  );
}
