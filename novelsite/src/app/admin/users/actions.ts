'use server';

import { headers } from 'next/headers';
import { requireAdminForAction } from '@/lib/auth/guard';
import { enforceAdminQuota, clientIpFrom } from '@/lib/auth/rateLimit';
import * as adminService from '@/lib/services/adminService';
import { ServiceError } from '@/lib/services/errors';

export type AdminActionResult<T = unknown> =
  { success: true; data: T } | { success: false; error: { code: string; message: string } };

async function resolveIp(): Promise<string> {
  try {
    const h = await headers();
    return clientIpFrom(h, 'unknown');
  } catch {
    return 'unknown';
  }
}

function handleActionError(err: unknown): {
  success: false;
  error: { code: string; message: string };
} {
  if (err instanceof ServiceError) {
    return { success: false, error: { code: err.code, message: err.message } };
  }
  console.error('[admin user action error]', err);
  return { success: false, error: { code: 'INTERNAL_ERROR', message: '操作失敗，請稍後再試' } };
}

export async function suspendUserAction(
  input: unknown
): Promise<AdminActionResult<{ id: string; isSuspended: boolean }>> {
  try {
    const session = await requireAdminForAction();
    await enforceAdminQuota(session.uid);
    const ip = await resolveIp();
    const data = await adminService.suspendUser(session.uid, input, ip);
    return { success: true, data };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function reactivateUserAction(
  input: unknown
): Promise<AdminActionResult<{ id: string; isSuspended: boolean }>> {
  try {
    const session = await requireAdminForAction();
    await enforceAdminQuota(session.uid);
    const ip = await resolveIp();
    const data = await adminService.reactivateUser(session.uid, input, ip);
    return { success: true, data };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function changeRoleAction(
  input: unknown
): Promise<AdminActionResult<{ id: string; role: string }>> {
  try {
    const session = await requireAdminForAction();
    await enforceAdminQuota(session.uid);
    const ip = await resolveIp();
    const data = await adminService.changeUserRole(session.uid, input, ip);
    return { success: true, data };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function resetUserPasswordAction(
  input: unknown
): Promise<
  AdminActionResult<{ mode: 'email' } | { mode: 'link'; resetUrl: string; expiresAt: string }>
> {
  try {
    const session = await requireAdminForAction();
    await enforceAdminQuota(session.uid);
    const ip = await resolveIp();
    const data = await adminService.resetUserPassword(session.uid, input, ip);
    return { success: true, data };
  } catch (err) {
    return handleActionError(err);
  }
}
