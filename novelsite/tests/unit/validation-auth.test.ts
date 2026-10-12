import { describe, expect, it } from 'vitest';
import {
  registerSchema,
  loginSchema,
  passwordResetRequestSchema,
  passwordResetConfirmSchema,
} from '@/lib/validation/auth';

const VALID = {
  name: '測試使用者',
  email: 'user@example.com',
  password: 'abcd1234',
  acceptTerms: true as const,
};

describe('registerSchema', () => {
  it('合法輸入通過驗證', () => {
    expect(registerSchema.safeParse(VALID).success).toBe(true);
  });

  it('Email 格式不正確時失敗', () => {
    const result = registerSchema.safeParse({ ...VALID, email: 'not-an-email' });
    expect(result.success).toBe(false);
  });

  it('密碼少於 8 字元時失敗', () => {
    const result = registerSchema.safeParse({ ...VALID, password: 'ab12' });
    expect(result.success).toBe(false);
  });

  it('密碼僅含英文字母（無數字）時失敗', () => {
    const result = registerSchema.safeParse({ ...VALID, password: 'abcdefgh' });
    expect(result.success).toBe(false);
  });

  it('密碼僅含數字（無英文字母）時失敗', () => {
    const result = registerSchema.safeParse({ ...VALID, password: '12345678' });
    expect(result.success).toBe(false);
  });

  it('acceptTerms 為 false 時失敗', () => {
    const result = registerSchema.safeParse({ ...VALID, acceptTerms: false });
    expect(result.success).toBe(false);
  });

  it('acceptTerms 缺漏時失敗（繞過前端直送）', () => {
    const rest: Record<string, unknown> = { ...VALID };
    delete rest.acceptTerms;
    const result = registerSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

describe('loginSchema', () => {
  it('合法輸入通過驗證', () => {
    expect(loginSchema.safeParse({ email: 'user@example.com', password: 'anything' }).success).toBe(
      true
    );
  });

  it('Email 格式不正確時失敗', () => {
    expect(loginSchema.safeParse({ email: 'bad', password: 'anything' }).success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FEAT-5 T022a：密碼重設沿用既有密碼規則（FR-013）
//
// **為什麼需要這一節**：「沿用既有 `passwordSchema`」若被寫成另訂一套較寬的規則，
// 不會有任何測試變紅 —— 而重設是設定密碼的**第三個入口**（註冊、改密碼、重設）。
// 故此處不比對某個寫死的訊息，而是**逐案比對重設 schema 與註冊 schema 的拒絕結果**：
// 兩者不同源時必然出現差異，兩者同源時本節恆綠且不需要隨文案改動維護。
// ─────────────────────────────────────────────────────────────────────────────

/** 自 safeParse 結果取出 `password` 欄位的第一則訊息（通過驗證時為 null） */
function passwordIssue(result: {
  success: boolean;
  error?: { issues: readonly { path: PropertyKey[]; message: string }[] };
}): string | null {
  if (result.success) return null;
  const issue = result.error?.issues.find((i) => i.path[0] === 'password');
  return issue ? issue.message : '(password 欄位無 issue)';
}

describe('passwordResetConfirmSchema：密碼規則與註冊用 schema 逐案一致（FR-013）', () => {
  const CASES: { label: string; password: unknown }[] = [
    { label: '合法密碼', password: 'abcd1234' },
    { label: '過短（少於 8 字元）', password: 'ab12' },
    { label: '弱密碼：僅英文字母、無數字', password: 'abcdefgh' },
    { label: '弱密碼：僅數字、無英文字母', password: '12345678' },
    { label: '空字串', password: '' },
    { label: '缺漏（繞過前端直送）', password: undefined },
    { label: '型別不符（非字串）', password: 12345678 },
  ];

  it.each(CASES)('$label：接受／拒絕與訊息皆與 registerSchema 相同', ({ password }) => {
    const registerInput: Record<string, unknown> = { ...VALID };
    const confirmInput: Record<string, unknown> = { token: 'a'.repeat(43) };
    if (password === undefined) {
      delete registerInput.password;
    } else {
      registerInput.password = password;
      confirmInput.password = password;
    }

    const registerResult = registerSchema.safeParse(registerInput);
    const confirmResult = passwordResetConfirmSchema.safeParse(confirmInput);

    expect(confirmResult.success).toBe(registerResult.success);
    expect(passwordIssue(confirmResult)).toBe(passwordIssue(registerResult));
  });

  it('token 缺漏或為空字串時失敗（憑證是這個端點的唯一身分依據）', () => {
    expect(passwordResetConfirmSchema.safeParse({ password: 'abcd1234' }).success).toBe(false);
    expect(passwordResetConfirmSchema.safeParse({ token: '', password: 'abcd1234' }).success).toBe(
      false
    );
  });
});

describe('passwordResetRequestSchema', () => {
  it('合法 Email 通過驗證', () => {
    expect(passwordResetRequestSchema.safeParse({ email: 'user@example.com' }).success).toBe(true);
  });

  it('Email 格式不正確或缺漏時失敗（400 只回答「這串字不是 Email」，與帳號是否註冊無關）', () => {
    expect(passwordResetRequestSchema.safeParse({ email: 'not-an-email' }).success).toBe(false);
    expect(passwordResetRequestSchema.safeParse({}).success).toBe(false);
  });
});
