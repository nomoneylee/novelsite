'use client';

/**
 * useAuth — 登入狀態讀取 Hook
 * 登入狀態改由伺服器端 SessionProvider 提供（root layout 以 getSession() 取得使用者後傳入），
 * localStorage 不再是信任來源。對外形狀維持不變，既有消費點不需連鎖改寫（FR-014）。
 */

import { useCallback } from 'react';
import { useSessionUser } from '@/components/SessionProvider';
import { loginAction, registerAction, logoutAction } from '@/app/auth/actions';

export interface LoginResult {
  success: boolean;
  error?: string;
}

export function useAuth() {
  const user = useSessionUser();

  const login = useCallback(async (email: string, password: string): Promise<LoginResult> => {
    const result = await loginAction({ email, password });
    return result.success ? { success: true } : { success: false, error: result.error.message };
  }, []);

  const register = useCallback(
    async (
      name: string,
      email: string,
      password: string,
      acceptTerms: boolean
    ): Promise<LoginResult> => {
      const result = await registerAction({ name, email, password, acceptTerms });
      return result.success ? { success: true } : { success: false, error: result.error.message };
    },
    []
  );

  const logout = useCallback(async () => {
    await logoutAction();
  }, []);

  // ready 因狀態來自伺服器渲染而恆為 true（不再有 client mount 後才讀 localStorage 的時間差）
  return { user, isLoggedIn: !!user, ready: true, login, register, logout };
}
