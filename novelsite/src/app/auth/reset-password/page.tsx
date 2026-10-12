import type { Metadata } from 'next';
import { ResetPasswordForm } from '@/components/auth/ResetPasswordForm';

export const metadata: Metadata = {
  title: '設定新密碼',
  description: '以 NovelSite 寄出的重設連結設定新密碼。',
};

/**
 * 憑證自 `?token=` 讀取後下傳（FEAT-5 T035）。
 *
 * **明碼憑證只經過這一段路**（信件連結 → 本頁 → confirm 端點），
 * MUST NOT 落庫、MUST NOT 進任何記錄（FR-007）。
 * 缺參數時由 `ResetPasswordForm` 顯示「連結不完整」並給重新申請的入口，
 * MUST NOT 在此轉址 —— 使用者會以為連結壞了而不知道要重新申請。
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return <ResetPasswordForm token={token} />;
}
