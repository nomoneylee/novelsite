'use server';

import { requireAdminForAction } from '@/lib/auth/guard';
import { enforceAdminQuota } from '@/lib/auth/rateLimit';
import * as adminService from '@/lib/services/adminService';
import { ServiceError } from '@/lib/services/errors';
import type { AuditLogRow } from '@/lib/types';

export type AdminActionResult<T = unknown> =
  { success: true; data: T } | { success: false; error: { code: string; message: string } };

function handleActionError(err: unknown): {
  success: false;
  error: { code: string; message: string };
} {
  if (err instanceof ServiceError) {
    return { success: false, error: { code: err.code, message: err.message } };
  }
  console.error('[admin audit action error]', err);
  return { success: false, error: { code: 'INTERNAL_ERROR', message: '操作失敗，請稍後再試' } };
}

/**
 * 分頁查詢稽核紀錄（純唯讀，嚴禁任何修改或刪除 Action，憲章第 II 條）
 */
export async function listAuditLogsAction(
  input: unknown
): Promise<
  AdminActionResult<{ items: AuditLogRow[]; nextCursor: string | null; totalCount: number }>
> {
  try {
    const session = await requireAdminForAction();
    await enforceAdminQuota(session.uid);
    const data = await adminService.listAuditLogs(input);
    return { success: true, data };
  } catch (err) {
    return handleActionError(err);
  }
}
