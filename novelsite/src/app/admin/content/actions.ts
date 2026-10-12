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
  console.error('[admin content action error]', err);
  return { success: false, error: { code: 'INTERNAL_ERROR', message: '操作失敗，請稍後再試' } };
}

export async function suspendNovelAction(
  input: unknown
): Promise<AdminActionResult<{ success: true }>> {
  try {
    const session = await requireAdminForAction();
    await enforceAdminQuota(session.uid);
    const ip = await resolveIp();
    await adminService.adminSuspendNovel(session.uid, input, ip);
    return { success: true, data: { success: true } };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function restoreNovelAction(
  input: unknown
): Promise<AdminActionResult<{ success: true }>> {
  try {
    const session = await requireAdminForAction();
    await enforceAdminQuota(session.uid);
    const ip = await resolveIp();
    await adminService.adminRestoreNovel(session.uid, input, ip);
    return { success: true, data: { success: true } };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function deleteNovelAction(
  input: unknown
): Promise<AdminActionResult<{ success: true }>> {
  try {
    const session = await requireAdminForAction();
    await enforceAdminQuota(session.uid);
    const ip = await resolveIp();
    await adminService.adminDeleteNovel(session.uid, input, ip);
    return { success: true, data: { success: true } };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function suspendChapterAction(
  input: unknown
): Promise<AdminActionResult<{ success: true }>> {
  try {
    const session = await requireAdminForAction();
    await enforceAdminQuota(session.uid);
    const ip = await resolveIp();
    await adminService.adminSuspendChapter(session.uid, input, ip);
    return { success: true, data: { success: true } };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function restoreChapterAction(
  input: unknown
): Promise<AdminActionResult<{ success: true }>> {
  try {
    const session = await requireAdminForAction();
    await enforceAdminQuota(session.uid);
    const ip = await resolveIp();
    await adminService.adminRestoreChapter(session.uid, input, ip);
    return { success: true, data: { success: true } };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function deleteChapterAction(
  input: unknown
): Promise<AdminActionResult<{ wordCount: number; chapterCount: number }>> {
  try {
    const session = await requireAdminForAction();
    await enforceAdminQuota(session.uid);
    const ip = await resolveIp();
    const data = await adminService.adminDeleteChapter(session.uid, input, ip);
    return { success: true, data };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function moderateCommentAction(input: {
  commentId: string;
  action: 'hide' | 'delete';
  reason: string;
}): Promise<AdminActionResult<{ success: true }>> {
  try {
    const session = await requireAdminForAction();
    await enforceAdminQuota(session.uid);
    const ip = await resolveIp();
    await adminService.moderateComment(
      session.uid,
      input.commentId,
      input.action,
      input.reason,
      ip
    );
    return { success: true, data: { success: true } };
  } catch (err) {
    return handleActionError(err);
  }
}
