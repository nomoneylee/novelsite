'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BookOpen, LockKey } from '@phosphor-icons/react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { showToast } from '@/components/ui/Toast';
import { apiUrl } from '@/lib/apiUrl';
import styles from './AuthShell.module.css';

/**
 * 以重設連結設定新密碼（FEAT-5 T033，FR-015）
 * ==========================================
 * **三種失效狀態各有各的說明訊息**，且每一種都附上重新申請的入口 ——
 * 只給一句含糊的「連結無效」時，使用者不知道該重新申請還是該檢查有沒有複製完整。
 *
 * | 狀態 | 來源 | 訊息 |
 * |---|---|---|
 * | 連結不完整 | 網址沒有 `token` 參數（信件被截斷、手動複製漏字） | 請重新開啟信中的連結 |
 * | `INVALID_TOKEN` | 已使用過、或已被新的申請作廢 | 已失效 |
 * | `EXPIRED_TOKEN` | 超過有效期 | 已過期 |
 *
 * **成功後不自動登入**：伺服器端剛剛才撤銷該帳號的全部工作階段（FR-012），
 * 當下立刻簽發一張新的與那個意圖相左 —— 導回登入頁請使用者以新密碼登入。
 */
export function ResetPasswordForm({ token }: { token?: string }) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFieldError(undefined);
    setFormError(null);

    try {
      const res = await fetch(apiUrl('/api/auth/password-reset/confirm'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });

      if (res.ok) {
        showToast('密碼已更新，請以新密碼登入', 'success');
        router.push('/auth/login');
        return;
      }

      const body = await res.json().catch(() => null);
      const error = body?.error as
        { code?: string; message?: string; fields?: Record<string, string> } | undefined;
      if (error?.fields?.password) {
        setFieldError(error.fields.password);
      } else {
        setFormError(error?.message ?? '目前無法完成重設，請稍後再試');
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

        <h1 className={styles.title}>設定新密碼</h1>

        {token ? (
          <>
            <p className={styles.subtitle}>設定完成後，請以新密碼重新登入</p>

            <form className={styles.form} onSubmit={handleSubmit} noValidate>
              {formError && (
                <p className={styles.error} role="alert">
                  {formError} <Link href="/auth/forgot-password">重新申請重設連結</Link>
                </p>
              )}

              <Input
                type="password"
                label="新密碼"
                hint="至少 8 個字元，須同時包含英文字母與數字"
                placeholder="請設定新密碼"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                leftIcon={<LockKey size={16} />}
                error={fieldError}
                fullWidth
                required
              />

              <Button type="submit" fullWidth loading={submitting}>
                設定新密碼
              </Button>
            </form>
          </>
        ) : (
          <p className={styles.error} role="alert">
            這個重設連結不完整，缺少憑證參數。請重新開啟信中的連結，或{' '}
            <Link href="/auth/forgot-password">重新申請重設連結</Link>。
          </p>
        )}

        <p className={styles.footer}>
          <Link href="/auth/login">回到登入</Link>
        </p>
      </div>
    </main>
  );
}
