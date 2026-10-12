'use client';

import { useId, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BookOpen, User, Envelope, LockKey } from '@phosphor-icons/react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { showToast } from '@/components/ui/Toast';
import { registerAction } from '@/app/auth/actions';
import styles from './AuthShell.module.css';

type FieldErrors = Partial<Record<'name' | 'email' | 'password' | 'acceptTerms', string>>;

export function RegisterForm() {
  const router = useRouter();
  const acceptTermsId = useId();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    setFieldErrors({});

    const result = await registerAction({ name, email, password, acceptTerms });

    if (result.success) {
      showToast('註冊成功，歡迎加入 NovelSite', 'success');
      router.push('/profile/bookshelf');
      router.refresh();
      return;
    }

    if (result.error.code === 'VALIDATION_ERROR' && result.error.fields) {
      setFieldErrors(result.error.fields as FieldErrors);
    } else {
      setFormError(result.error.message);
    }
    setSubmitting(false);
  };

  return (
    <main className={styles.shell}>
      <div className={styles.card}>
        <Link href="/" className={styles.logo}>
          <BookOpen size={24} weight="fill" />
          <span className={styles.logo__text}>NovelSite</span>
        </Link>

        <h1 className={styles.title}>建立帳號</h1>
        <p className={styles.subtitle}>加入 NovelSite，開啟沉浸式閱讀體驗</p>

        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          {formError && (
            <p className={styles.error} role="alert">
              {formError}
            </p>
          )}

          <Input
            type="text"
            label="暱稱"
            placeholder="你的顯示名稱"
            value={name}
            onChange={(e) => setName(e.target.value)}
            leftIcon={<User size={16} />}
            error={fieldErrors.name}
            fullWidth
            required
          />

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
            hint="至少 8 個字元，須同時包含英文字母與數字"
            placeholder="請設定密碼"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            leftIcon={<LockKey size={16} />}
            error={fieldErrors.password}
            fullWidth
            required
          />

          <div className={styles.checkboxRow}>
            <input
              id={acceptTermsId}
              type="checkbox"
              checked={acceptTerms}
              onChange={(e) => setAcceptTerms(e.target.checked)}
              aria-invalid={!!fieldErrors.acceptTerms}
              aria-describedby={fieldErrors.acceptTerms ? `${acceptTermsId}-error` : undefined}
              required
            />
            <label htmlFor={acceptTermsId}>
              我已閱讀並同意
              <Link href="/terms">服務條款</Link>與<Link href="/privacy">隱私權政策</Link>
            </label>
          </div>
          {fieldErrors.acceptTerms && (
            <p id={`${acceptTermsId}-error`} className={styles.error} role="alert">
              {fieldErrors.acceptTerms}
            </p>
          )}

          <Button type="submit" fullWidth loading={submitting}>
            註冊
          </Button>
        </form>

        <p className={styles.footer}>
          已經有帳號？<Link href="/auth/login">前往登入</Link>
        </p>
      </div>
    </main>
  );
}
