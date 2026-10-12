/**
 * 信件內容的唯一產出處（FEAT-5，contracts/internal-modules.md §2.1）
 * ================================================================
 * 兩支純函式，各自回傳 `MailMessage`。
 *
 * **為什麼獨立成檔而不是寫在服務層內**：FR-016 有三條 MUST，而信件是使用者在整個
 * 流程中**唯一看得到的產物** —— 把它散在 `deliver()` 裡，等於讓那三條 MUST 沒有
 * 可被單獨斷言的對象。有效期分鐘數寫死於文案是最典型的漂移點：改了設定值卻沒改文案，
 * 信上就會寫一個假的時間，而使用者要等到連結提早失效才會發現。
 *
 * **一律純文字**（research R-12）：`MailMessage` 沒有 `html` 欄位，
 * 而聯絡表單的本文是未登入者提供的任意字串。
 */
import { env } from '@/lib/env';
import { SITE_URL } from '@/lib/siteConfig';
import type { MailMessage } from './types';

/**
 * 密碼重設信（FR-016／FR-016a）。
 *
 * 收件人是**帳號的信箱**（`user.email`），不是送入端點的那一串 ——
 * 兩者可能只差大小寫，但用送入值就等於讓申請者指定收件位址。
 *
 * 連結 MUST 為絕對網址：`SITE_URL` 取自 `@/lib/siteConfig`，且 `MAIL_MODE=production`
 * 下 `NEXT_PUBLIC_SITE_URL` 未明示即拒絕啟動（SC-013a）—— 靜默回落的後果是
 * 每一封信的連結都指向別的網站，而系統仍回報已寄出。
 */
export function passwordResetMail(to: string, token: string): MailMessage {
  const link = `${SITE_URL}/auth/reset-password?token=${token}`;
  const minutes = env.PASSWORD_RESET_TOKEN_TTL_MINUTES;

  return {
    to,
    subject: '重設你的 NovelSite 密碼',
    text: [
      '你好，',
      '',
      '我們收到了重設你 NovelSite 帳號密碼的申請。請點開下方連結設定新密碼：',
      '',
      link,
      '',
      // 分鐘數取自設定值而非寫死於文案（FR-016 第 2 條）
      `此連結將於 ${minutes} 分鐘後失效，且只能使用一次。`,
      '',
      '若這不是你本人的申請，請直接忽略本信，你的密碼不會有任何變動。',
      '',
      'NovelSite',
    ].join('\n'),
  };
}

/**
 * 聯絡表單的轉寄信（FEAT-5 T050a，contracts/contact-api.md §1.6）。
 *
 * **本函式是 FR-019 的唯一實作處**：「表單填入的 Email 只作回覆位址、
 * 系統 MUST NOT 主動寄信給它」這條規則，全部由下面兩行（`to` 與 `replyTo` 各填什麼）決定。
 * 兩者對調在畫面上完全看不出來 —— 送出者照樣看到「已送出」，
 * 而站台就此成為 **spam 放大器**：任何人都能讓本站往任意信箱送出一封由本站寄出的信。
 *
 * **內文 MUST NOT 組成 HTML**（research R-12）：`message` 是未登入者提供的任意字串，
 * 而 `MailMessage` 本來就沒有 `html` 欄位 —— 這裡只是不要自己拼一個出來。
 */
export function contactMail(input: { name: string; email: string; message: string }): MailMessage {
  return {
    // 收件人是營運信箱，取自設定（FR-022：更換位址 MUST NOT 需要改原始碼）
    to: env.CONTACT_EMAIL,
    // 回覆位址才是表單填的那一個：營運者按「回覆」就回得到人，而系統不曾寄信給它
    replyTo: input.email,
    subject: `[NovelSite 聯絡表單] 來自 ${input.name}`,
    text: [
      `稱呼：${input.name}`,
      `回覆 Email：${input.email}`,
      '',
      '訊息內容：',
      input.message,
    ].join('\n'),
  };
}
