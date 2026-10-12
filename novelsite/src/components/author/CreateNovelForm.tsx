'use client';

import React, { useState, useTransition } from 'react';
import { Button, Input, Textarea } from '@/components/ui';
import { createNovelAction } from '@/app/author/actions';
import type { Category } from '@/lib/types';
import styles from './CreateNovelForm.module.css';

interface CreateNovelFormProps {
  categories: Category[];
}

interface FormState {
  title: string;
  categoryId: string;
  excerpt: string;
}

/**
 * 新增作品表單（FR-012）。
 *
 * 成功時由 `createNovelAction` 內的 `redirect()` 直接導向作品管理頁，故本元件
 * **沒有成功狀態** —— 會回到這裡的只有失敗。這也是為什麼不需要「已建立」的提示文案：
 * 使用者看得到結果的地方是下一頁，不是這一頁上的一行字。
 *
 * 分類的 `value` 是 `categoryId` 而非 label：label 是顯示用的，拿它當識別碼會在
 * 有兩個同名分類時悄悄選錯，而且 `createNovelSchema` 要的本來就是識別碼。
 */
export function CreateNovelForm({ categories }: CreateNovelFormProps) {
  const [pending, startTransition] = useTransition();
  const [fields, setFields] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({
    title: '',
    categoryId: categories[0]?.id ?? '',
    excerpt: '',
  });

  const update = (key: keyof FormState, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFields({});
    setFormError(null);

    startTransition(async () => {
      const result = await createNovelAction(form);
      // 成功時 Action 以 redirect() 收尾，執行不會回到這裡
      if (result && !result.success) {
        setFields(result.error.fields ?? {});
        setFormError(result.error.fields ? null : result.error.message);
      }
    });
  };

  return (
    <form className={styles.form} noValidate onSubmit={onSubmit}>
      <Input
        label="作品名稱"
        placeholder="為你的故事取一個引人入勝的名字"
        value={form.title}
        onChange={(e) => update('title', e.target.value)}
        error={fields.title}
        fullWidth
        id="create-title"
      />

      <div className={styles.field}>
        <label className={styles.field__label} htmlFor="create-category">
          分類
        </label>
        <select
          id="create-category"
          className={styles.select}
          value={form.categoryId}
          onChange={(e) => update('categoryId', e.target.value)}
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.emoji} {c.label}
            </option>
          ))}
        </select>
      </div>

      <Textarea
        label="作品簡介"
        placeholder="用幾句話描述你的故事，吸引讀者點進來…"
        value={form.excerpt}
        onChange={(e) => update('excerpt', e.target.value)}
        error={fields.excerpt}
        rows={5}
        fullWidth
        id="create-excerpt"
      />

      {formError && (
        <p className={styles.disabledNote} role="alert">
          {formError}
        </p>
      )}

      <div className={styles.actions}>
        <Button type="submit" variant="primary" size="lg" disabled={pending}>
          {pending ? '建立中…' : '建立作品'}
        </Button>
      </div>
    </form>
  );
}
