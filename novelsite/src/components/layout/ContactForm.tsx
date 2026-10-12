'use client';

import React, { useId, useState, type FormEvent } from 'react';
import { Button, Input, Textarea } from '@/components/ui';
import { contactSchema } from '@/lib/validation/contact';
import { fieldErrorsOf } from '@/lib/validation/fieldErrors';
import { apiUrl } from '@/lib/apiUrl';
import styles from './ContactForm.module.css';

interface FormState {
  name: string;
  email: string;
  message: string;
}

interface ContactFormProps {
  /** 寄送失敗時的替代管道（FR-021）。由 Server Component 下傳，MUST NOT 於本檔讀設定 */
  contactEmail: string;
}

/**
 * 聯絡表單（FEAT-5 T054）
 * =======================
 * 接 `POST /api/contact`，三種狀態各自不同：送出中／成功／失敗（contracts/contact-api §2.1）。
 *
 * **失敗時 MUST NOT 出現任何形式的「已送出」**（FR-020）：這支表單的寄送是同步的，
 * 回應到手時信的成敗已成定局 —— 沒有「先報喜再說」的餘地。
 * 失敗提示一併給出可直接來信的位址（FR-021）：訊息沒出去，使用者要有下一步。
 */
export function ContactForm({ contactEmail }: ContactFormProps) {
  const honeypotId = useId();
  const [form, setForm] = useState<FormState>({ name: '', email: '', message: '' });
  /**
   * honeypot（contracts §1.4）。**表單不渲染這個欄位，伺服器端那條判定就永遠收不到值，
   * FR-018 的濫用防護實際等於不存在** —— 而 `validation-contact` 與 route 的測試
   * 只驗得到伺服器端那一半。
   */
  const [website, setWebsite] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  /**
   * 逐欄位訊息（contracts §1.3 的 `error.fields`）。
   *
   * **欄位錯誤 MUST NOT 走 `failed` 那條提示**：那條會請使用者改用信箱直接來信，
   * 而少打幾個字並不需要換一個管道 —— 使用者要的是知道**哪一欄**不合格。
   * 沒有這一段，`400 VALIDATION_ERROR` 在畫面上只剩一句「輸入格式不正確」，
   * 三個欄位都可能是兇手，使用者只能亂猜（2026-08-13 實測回報）。
   */
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const update = (key: keyof FormState, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    // 使用者一動手就撤掉該欄的紅字，否則改完仍掛著舊訊息
    setFieldErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  /**
   * 欄位錯誤上畫面。**honeypot（`website`）不在使用者看得見的欄位裡**——
   * 只把它寫進 `fieldErrors` 會讓按鈕按下去什麼都不動、也沒有任何訊息，
   * 比原本那句含糊的提示更糟。故命中時退回 `failed` 那條（含可直接來信的位址）：
   * 機器人不看畫面，而**萬一是瀏覽器／密碼管理器自動填了它**，真人至少還有下一步。
   */
  const showValidationErrors = (fields: Record<string, string>) => {
    const { website: honeypotError, ...visible } = fields;
    setFieldErrors(visible);
    if (honeypotError) {
      setErrorMessage('訊息目前無法送出，請稍後再試');
      setStatus('failed');
      return;
    }
    setStatus('idle');
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setFieldErrors({});

    // 送出前先以**同一份 schema** 驗一次（`validation/contact.ts` client/server 共用）：
    // 省下一次注定 400 的往返，也讓錯誤在使用者按下按鈕的當下就指到欄位上
    const parsed = contactSchema.safeParse({ ...form, website });
    if (!parsed.success) {
      showValidationErrors(fieldErrorsOf(parsed.error));
      return;
    }

    setStatus('sending');

    try {
      const res = await fetch(apiUrl('/api/contact'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, website }),
      });

      // 成功提示只在這一條分支內：等過寄送（await）且看過結果（res.ok）
      if (res.ok) {
        setStatus('sent');
        return;
      }

      const body = await res.json().catch(() => null);
      const error = body?.error as
        { message?: string; fields?: Record<string, string> } | undefined;

      // 400 且帶 `fields`：欄位問題，指回欄位而非丟出「改用信箱」的死路
      if (res.status === 400 && error?.fields && Object.keys(error.fields).length > 0) {
        showValidationErrors(error.fields);
        return;
      }

      setErrorMessage(error?.message ?? '訊息目前無法送出，請稍後再試');
      setStatus('failed');
    } catch {
      setErrorMessage('網路連線似乎有問題，訊息沒有送出');
      setStatus('failed');
    }
  };

  if (status === 'sent') {
    return (
      <p className={styles.notice} role="status">
        訊息已送出，我們會盡快回覆你。
      </p>
    );
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      {status === 'failed' && (
        <p className={styles.error} role="alert">
          {errorMessage}你可以直接來信 <a href={`mailto:${contactEmail}`}>{contactEmail}</a>。
        </p>
      )}

      <Input
        label="稱呼"
        placeholder="我們該怎麼稱呼你？"
        value={form.name}
        onChange={(e) => update('name', e.target.value)}
        error={fieldErrors.name}
        fullWidth
        id="contact-name"
      />
      <Input
        label="Email"
        type="email"
        placeholder="you@example.com"
        value={form.email}
        onChange={(e) => update('email', e.target.value)}
        error={fieldErrors.email}
        fullWidth
        id="contact-email"
      />
      <Textarea
        label="訊息內容"
        placeholder="想告訴我們的建議、問題或合作提案…"
        value={form.message}
        onChange={(e) => update('message', e.target.value)}
        error={fieldErrors.message}
        rows={6}
        hint="至少 10 個字"
        fullWidth
        id="contact-message"
      />

      {/*
        honeypot：對人不可見（`aria-hidden` 使輔助技術亦跳過）、不會被鍵盤走訪
        （`tabIndex={-1}`）、不會被瀏覽器自動填入（`autoComplete="off"`）。
        以 CSS 移出視線而非 `display: none` —— 部分機器人會略過完全不顯示的欄位。
      */}
      <div className={styles.honeypot} aria-hidden="true">
        <label htmlFor={honeypotId}>請留空</label>
        <input
          id={honeypotId}
          name="website"
          type="text"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <div className={styles.actions}>
        <Button
          type="submit"
          variant="primary"
          size="lg"
          disabled={status === 'sending'}
          aria-busy={status === 'sending'}
        >
          {status === 'sending' ? '傳送中…' : '送出訊息'}
        </Button>
      </div>
    </form>
  );
}
