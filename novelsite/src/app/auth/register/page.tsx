import type { Metadata } from 'next';
import { RegisterForm } from '@/components/auth/RegisterForm';

export const metadata: Metadata = {
  title: '註冊',
  description: '建立 NovelSite 帳號，開啟沉浸式閱讀體驗。',
};

export default function RegisterPage() {
  return <RegisterForm />;
}
