import React, { useId } from 'react';
import styles from './Input.module.css';

export type InputType = 'text' | 'email' | 'password' | 'search' | 'number' | 'tel' | 'url';

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  hint?: string;
  error?: string;
  size?: 'sm' | 'md' | 'lg';
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      hint,
      error,
      size = 'md',
      leftIcon,
      rightIcon,
      fullWidth = false,
      className = '',
      id,
      ...props
    },
    ref
  ) => {
    const generatedId = useId();
    const inputId = id ?? `input-${generatedId}`;

    const wrapperClass = [styles.input__wrapper, fullWidth ? styles['input__wrapper--full'] : '']
      .filter(Boolean)
      .join(' ');

    const fieldClass = [
      styles.input__field,
      styles[`input__field--${size}`],
      leftIcon ? styles['input__field--has-left'] : '',
      rightIcon ? styles['input__field--has-right'] : '',
      error ? styles['input__field--error'] : '',
      className,
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <div className={wrapperClass}>
        {label && (
          <label className={styles.input__label} htmlFor={inputId}>
            {label}
          </label>
        )}
        <div className={styles.input__container}>
          {leftIcon && (
            <span
              className={`${styles.input__icon} ${styles['input__icon--left']}`}
              aria-hidden="true"
            >
              {leftIcon}
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            className={fieldClass}
            aria-invalid={!!error}
            aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
            {...props}
          />
          {rightIcon && (
            <span
              className={`${styles.input__icon} ${styles['input__icon--right']}`}
              aria-hidden="true"
            >
              {rightIcon}
            </span>
          )}
        </div>
        {error && (
          <p id={`${inputId}-error`} className={styles.input__error} role="alert">
            {error}
          </p>
        )}
        {!error && hint && (
          <p id={`${inputId}-hint`} className={styles.input__hint}>
            {hint}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';

// ── Textarea ──────────────────────────────────
export interface TextareaProps extends Omit<
  React.TextareaHTMLAttributes<HTMLTextAreaElement>,
  'size'
> {
  label?: string;
  hint?: string;
  error?: string;
  fullWidth?: boolean;
  resize?: 'none' | 'vertical' | 'horizontal' | 'both';
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      label,
      hint,
      error,
      fullWidth = false,
      resize = 'vertical',
      className = '',
      id,
      rows = 4,
      ...props
    },
    ref
  ) => {
    const generatedId = useId();
    const textareaId = id ?? `textarea-${generatedId}`;

    const wrapperClass = [styles.input__wrapper, fullWidth ? styles['input__wrapper--full'] : '']
      .filter(Boolean)
      .join(' ');

    const fieldClass = [
      styles.input__field,
      styles['input__field--md'],
      styles.input__textarea,
      error ? styles['input__field--error'] : '',
      className,
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <div className={wrapperClass}>
        {label && (
          <label className={styles.input__label} htmlFor={textareaId}>
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          className={fieldClass}
          rows={rows}
          style={{ resize }}
          aria-invalid={!!error}
          aria-describedby={error ? `${textareaId}-error` : hint ? `${textareaId}-hint` : undefined}
          {...props}
        />
        {error && (
          <p id={`${textareaId}-error`} className={styles.input__error} role="alert">
            {error}
          </p>
        )}
        {!error && hint && (
          <p id={`${textareaId}-hint`} className={styles.input__hint}>
            {hint}
          </p>
        )}
      </div>
    );
  }
);

Textarea.displayName = 'Textarea';
