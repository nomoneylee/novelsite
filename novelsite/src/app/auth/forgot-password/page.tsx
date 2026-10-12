import type { Metadata } from 'next';
import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm';

export const metadata: Metadata = {
  title: '忘記密碼',
  description: '輸入註冊時使用的 Email，我們會寄出 NovelSite 密碼重設連結。',
};

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
