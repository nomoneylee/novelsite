import type { Metadata } from 'next';
import { StaticPage } from '@/components/layout/StaticPage';
import { ContactForm } from '@/components/layout/ContactForm';
import { env } from '@/lib/env';

export const metadata: Metadata = {
  title: '聯絡我們',
  description: '有任何建議、問題或合作提案？填寫表單與 NovelSite 團隊聯繫。',
};

/**
 * 逐請求求值（FEAT-5 T053，理由同 `privacy/page.tsx`）。
 *
 * 本頁把 `env.CONTACT_EMAIL` 以 prop 下傳給表單，供**寄送失敗時**的替代管道提示使用
 * （FR-021）。靜態預渲染會把位址烤進建置產物 —— 換了信箱重啟服務後，
 * 失敗提示仍會請使用者寫信到一個沒有人在看的舊信箱，
 * **而那個提示只在寄送已經失敗時才出現**，是最不該再錯第二次的地方。
 */
export const dynamic = 'force-dynamic';

export default function ContactPage() {
  return (
    <StaticPage title="聯絡我們" subtitle="我們很樂意聽見你的聲音" id="contact-page">
      <p>
        無論是使用上的問題、對平台的建議，或是任何合作提案，都歡迎透過以下表單與我們聯繫。我們會盡快回覆你。
      </p>
      {/* 位址由 Server Component 下傳，**MUST NOT 加 `NEXT_PUBLIC_` 前綴**——那會把它編進每一個 client bundle */}
      <ContactForm contactEmail={env.CONTACT_EMAIL} />
    </StaticPage>
  );
}
