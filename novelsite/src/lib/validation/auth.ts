import { z } from 'zod';

/** client / server 共用同一份定義（contracts/internal-modules.md） */
const passwordSchema = z
  .string()
  .min(8, '密碼至少需要 8 個字元')
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), {
    message: '密碼須同時包含英文字母與數字',
  });

export const registerSchema = z.object({
  name: z.string().trim().min(1, '請輸入暱稱'),
  email: z.string().trim().min(1, '請輸入 Email').email('Email 格式不正確'),
  password: passwordSchema,
  acceptTerms: z.literal(true, { message: '請先閱讀並同意服務條款與隱私權政策' }),
});

export const loginSchema = z.object({
  email: z.string().trim().min(1, '請輸入 Email').email('Email 格式不正確'),
  password: z.string().min(1, '請輸入密碼'),
});

export const changePasswordSchema = z.object({
  oldPassword: z.string().min(1, '請輸入目前密碼'),
  newPassword: passwordSchema,
});

// ─────────────────────────────────────────────────────────────
// 密碼重設（FEAT-5，FR-013／contracts/password-reset-api.md）
// ─────────────────────────────────────────────────────────────

/**
 * 申請重設。**只驗「這串字是不是 Email」**——400 與帳號是否註冊無關，
 * 故它不洩漏帳號存在性（contracts §1.2）。
 */
export const passwordResetRequestSchema = z.object({
  email: z.string().trim().min(1, '請輸入 Email').email('Email 格式不正確'),
});

/**
 * 以憑證設定新密碼。密碼規則**沿用上方同一個 `passwordSchema`**（FR-013）。
 *
 * MUST NOT 另訂一套：重設是設定密碼的**第三個入口**（註冊、改密碼、重設），
 * 另訂較寬的規則不會有任何測試變紅 —— 故 `tests/unit/validation-auth.test.ts`
 * 改為逐案比對本 schema 與 `registerSchema` 的拒絕結果與訊息（T022a）。
 */
export const passwordResetConfirmSchema = z.object({
  token: z.string().min(1, '缺少重設憑證'),
  password: passwordSchema,
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type PasswordResetRequestInput = z.infer<typeof passwordResetRequestSchema>;
export type PasswordResetConfirmInput = z.infer<typeof passwordResetConfirmSchema>;
