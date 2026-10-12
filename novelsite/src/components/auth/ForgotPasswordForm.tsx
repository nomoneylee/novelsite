'use client';

import { useId, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { BookOpen, Envelope } from '@phosphor-icons/react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { apiUrl } from '@/lib/apiUrl';
import styles from './AuthShell.module.css';

/**
 * 申請密碼重設（FEAT-5 T032，FR-006）
 * ===================================
 * 送出成功後**一律**顯示同一句話，MUST NOT 分辨該 Email 是否已註冊 ——
 * 「查無此帳號」這個貼心的提示就是一條枚舉管道，任何人都能用它把使用者名單撈出來。
 *
 * 400（格式不正確）仍逐欄顯示：它只回答「這串字不是 Email」，
 * 與帳號是否註冊無關，否則使用者連打錯字都無從得知。
 */
export function ForgotPasswordForm() {
  const noticeId = useId();
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFieldError(undefined);
    setFormError(null);

    try {
      const res = await fetch(apiUrl('/api/auth/password-reset/request'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      if (res.ok) {
        setSent(true);
        return;
      }

      const body = await res.json().catch(() => null);
      const error = body?.error as
        { code?: string; message?: string; fields?: Record<string, string> } | undefined;
      if (error?.fields?.email) {
        setFieldError(error.fields.email);
      } else {
        setFormError(error?.message ?? '目前無法處理這個申請，請稍後再試');
      }
    } catch {
      setFormError('網路連線似乎有問題，請稍後再試');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className={styles.shell}>
      <div className={styles.card}>
        <Link href="/" className={styles.logo}>
          <BookOpen size={24} weight="fill" />
          <span className={styles.logo__text}>NovelSite</span>
        </Link>

        <h1 className={styles.title}>忘記密碼</h1>
        <p className={styles.subtitle}>輸入註冊時使用的 Email，我們會寄出重設連結</p>

        {sent ? (
          <p id={noticeId} className={styles.hint} role="status">
            若該 Email 已註冊，重設信已寄出。請查看收件匣（含垃圾郵件匣），連結有時效限制。
          </p>
        ) : (
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
              error={fieldError}
              fullWidth
              required
            />

            <Button type="submit" fullWidth loading={submitting}>
              寄出重設連結
            </Button>
          </form>
        )}

        <p className={styles.footer}>
          想起密碼了？<Link href="/auth/login">回到登入</Link>
        </p>
      </div>
    </main>
  );
}
