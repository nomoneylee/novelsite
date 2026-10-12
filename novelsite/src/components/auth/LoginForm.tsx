'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BookOpen, Envelope, LockKey } from '@phosphor-icons/react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { showToast } from '@/components/ui/Toast';
import { loginAction } from '@/app/auth/actions';
import { apiUrl } from '@/lib/apiUrl';
import styles from './AuthShell.module.css';

type FieldErrors = Partial<Record<'email' | 'password', string>>;

export function LoginForm({ redirectTo }: { redirectTo?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [cookieBlocked, setCookieBlocked] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    setFieldErrors({});
    setCookieBlocked(false);

    const result = await loginAction({ email, password });

    if (!result.success) {
      if (result.error.code === 'VALIDATION_ERROR' && result.error.fields) {
        setFieldErrors(result.error.fields as FieldErrors);
      } else {
        setFormError(result.error.message);
      }
      setSubmitting(false);
      return;
    }

    // 登入請求成功，但瀏覽器可能停用 Cookie 而未實際帶回憑證（FR-056）。
    // 此判斷純屬體驗，MUST NOT 作為授權依據，也 MUST NOT 反覆導回登入頁形成無限跳轉。
    const meRes = await fetch(apiUrl('/api/auth/me'));
    if (!meRes.ok) {
      setCookieBlocked(true);
      setSubmitting(false);
      return;
    }

    showToast('登入成功，歡迎回來', 'success');
    router.push(redirectTo ?? '/profile/bookshelf');
    router.refresh();
  };

  return (
    <main className={styles.shell}>
      <div className={styles.card}>
        <Link href="/" className={styles.logo}>
          <BookOpen size={24} weight="fill" />
          <span className={styles.logo__text}>NovelSite</span>
        </Link>

        <h1 className={styles.title}>登入</h1>
        <p className={styles.subtitle}>登入以繼續你的閱讀旅程</p>

        {cookieBlocked && (
          <p className={styles.error} role="alert">
            登入請求已成功，但瀏覽器似乎停用了 Cookie，無法維持登入狀態。請啟用瀏覽器 Cookie
            後再試一次。
          </p>
        )}

        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          {formError && (
            <p className={styles.error} role="alert">
              {formError}
            </p>
          )}

          <Input
            type="email"
            label="Email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            leftIcon={<Envelope size={16} />}
            error={fieldErrors.email}
            fullWidth
            required
          />

          <Input
            type="password"
            label="密碼"
            placeholder="請輸入密碼"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            leftIcon={<LockKey size={16} />}
            error={fieldErrors.password}
            fullWidth
            required
          />

          <Button type="submit" fullWidth loading={submitting}>
            登入
          </Button>
        </form>

        {/*
          忘記密碼入口（FEAT-5 T037，FR-014）。`arch.md` §7.2 原本明文禁止放這個連結——
          沒有可用流程時，入口就是假象。該禁令於本階段解除的前提是流程真的可用，
          回歸把關見 `tests/integration/auth-entry-point.test.ts`
        */}
        <p className={styles.footer}>
          <Link href="/auth/forgot-password">忘記密碼？</Link>
        </p>

        <p className={styles.footer}>
          還沒有帳號？<Link href="/auth/register">立即註冊</Link>
        </p>
      </div>
    </main>
  );
}
