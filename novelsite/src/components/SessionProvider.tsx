'use client';

import { createContext, useContext } from 'react';
import { useReaderStateMerge } from '@/hooks/useReaderStateMerge';
import type { AuthUser } from '@/lib/types';

const SessionContext = createContext<AuthUser | null>(null);

/**
 * 伺服器傳入的登入狀態（FR-014）。MUST 掛載於 root layout —— SiteHeader 出現在全部頁面，
 * 只覆蓋受保護區域會讓公開頁面取不到 context。
 *
 * **未讀通知數併入同一份 `AuthUser` 向下傳遞**（FEAT-4 T135）：它由
 * `getSessionUser()` 與使用者查詢在同一次往返取回，故此處 MUST NOT 為它新增任何
 * 客戶端請求 —— 那會讓「每頁至多一次計數」變成「每頁一次查詢 ＋ 一次請求」（FR-053a）。
 * 標記已讀後由 `router.refresh()` 使版面重取，未讀數因而不需要客戶端狀態。
 */
export function SessionProvider({
  user,
  children,
}: {
  user: AuthUser | null;
  children: React.ReactNode;
}) {
  // 登入成功後自動把本機累積的書架與閱讀歷史帶進帳號（FEAT-4 T039）。
  // 掛在這裡而非登入頁：使用者也可能是「帶著既有 Cookie 直接開站」，
  // 那條路徑不經過登入表單，但同樣需要合併。
  useReaderStateMerge(user !== null);

  return <SessionContext.Provider value={user}>{children}</SessionContext.Provider>;
}

export function useSessionUser(): AuthUser | null {
  return useContext(SessionContext);
}
