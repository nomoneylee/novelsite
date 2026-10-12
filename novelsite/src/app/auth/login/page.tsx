import type { Metadata } from 'next';
import { LoginForm } from '@/components/auth/LoginForm';
import { safeNextPath } from '@/lib/auth/guard';

export const metadata: Metadata = {
  title: '登入',
  description: '登入 NovelSite 帳號，繼續你的閱讀旅程。',
};

/**
 * next 查詢參數為轉址至登入頁時攜帶的「登入後返回位置」（proxy.ts 的守衛分支寫入）。
 * MUST 經 safeNextPath 過濾外部網址（FR-017，防開放轉址）；未帶時維持既有預設頁。
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const redirectTo = next ? safeNextPath(next) : undefined;
  return <LoginForm redirectTo={redirectTo} />;
}
