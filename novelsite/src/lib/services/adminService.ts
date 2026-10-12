import 'server-only';
import {
  adminRepo,
  auditLogRepo,
  usersRepo,
  passwordResetTokensRepo,
  withTransaction,
  getNovelSearchSource,
  setNovelSearchText,
  type TxClient,
} from '@/lib/repositories';
import { ServiceError, parseOrThrow, translateDbError } from '@/lib/services/errors';
import type { AdminUserDetail } from '@/lib/types';
import { buildSearchText } from './searchText';
import {
  adminUserFilterSchema,
  suspendUserSchema,
  reactivateUserSchema,
  changeRoleSchema,
  resetUserPasswordSchema,
} from '@/lib/validation/admin';
import { generateResetToken, hashResetToken } from '@/lib/auth/passwordResetToken';
import { mailer } from '@/lib/mail';
import { logMailAttempt } from '@/lib/mail/log';
import { passwordResetMail } from '@/lib/mail/templates';
import { MailSendError } from '@/lib/mail/types';
import { env } from '@/lib/env';
import { invalidateNovel, invalidateNovelsList, invalidateChapter } from '@/lib/cache';
import {
  adminNovelFilterSchema,
  adminSuspendNovelSchema,
  adminRestoreNovelSchema,
  adminDeleteNovelSchema,
  adminSuspendChapterSchema,
  adminRestoreChapterSchema,
  adminDeleteChapterSchema,
  adminTagFilterSchema,
  createTagSchema,
  renameTagSchema,
  mergeTagsSchema,
  deleteTagSchema,
  adminAuditLogFilterSchema,
} from '@/lib/validation/admin';

/**
 * 管理後台業務邏輯服務層（FEAT-9 / 009-admin-dashboard）
 * ========================================================
 * 所有破壞性管理操作一律查驗自我防呆、最後管理員保護，並在同一交易內寫入 AuditLog。
 */

// ─────────────────────────────────────────────
// §1 使用者管理
// ─────────────────────────────────────────────

export async function listUsersForAdmin(filterRaw: unknown = {}) {
  const filter = parseOrThrow(adminUserFilterSchema, filterRaw);
  return adminRepo.listUsers(
    {
      search: filter.search,
      role: filter.role,
      isSuspended: filter.isSuspended,
    },
    filter.cursor,
    filter.limit
  );
}

/**
 * 單一使用者的管理端詳情（FR-007／US2）。
 *
 * 與 `listUsersForAdmin` 分開的理由：列表為了分頁只帶 `novels`／`comments` 兩個計數，
 * 詳情頁還要「違規狀況」需要的評論數與停權時間，硬塞進列表查詢等於每頁都多算一次。
 */
export async function getUserForAdmin(userId: string): Promise<AdminUserDetail | null> {
  const user = await adminRepo.getUserById(userId);
  if (!user) return null;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role as AdminUserDetail['role'],
    isSuspended: user.isSuspended,
    suspendedAt: user.suspendedAt ? user.suspendedAt.toISOString() : null,
    penName: user.penName,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    novelCount: user._count.novels,
    commentCount: user._count.comments,
    reviewCount: user._count.reviews,
  };
}

export async function suspendUser(operatorId: string, inputRaw: unknown, operatorIp = 'unknown') {
  const input = parseOrThrow(suspendUserSchema, inputRaw);

  if (operatorId === input.userId) {
    throw new ServiceError('CONFLICT', '不可停權自己的帳號');
  }

  const target = await usersRepo.findById(input.userId);
  if (!target) {
    throw new ServiceError('NOT_FOUND', '使用者不存在');
  }

  if (target.isSuspended) {
    return { id: target.id, isSuspended: true };
  }

  // 若目標為管理員，確保不是最後一位有效管理員
  if (target.role === 'admin') {
    const activeAdmins = await adminRepo.countActiveAdmins();
    if (activeAdmins <= 1) {
      throw new ServiceError('CONFLICT', '不可停權系統中最後一位有效管理員');
    }
  }

  await withTransaction(async (tx) => {
    await adminRepo.setUserSuspension(target.id, true, tx);
    await auditLogRepo.createAuditLog(
      {
        actorId: operatorId,
        action: 'user.suspend',
        targetType: 'User',
        targetId: target.id,
        diff: JSON.stringify({ isSuspended: { before: false, after: true } }),
        reason: input.reason,
        ip: operatorIp,
      },
      tx
    );
  });

  return { id: target.id, isSuspended: true };
}

export async function reactivateUser(
  operatorId: string,
  inputRaw: unknown,
  operatorIp = 'unknown'
) {
  const input = parseOrThrow(reactivateUserSchema, inputRaw);

  const target = await usersRepo.findById(input.userId);
  if (!target) {
    throw new ServiceError('NOT_FOUND', '使用者不存在');
  }

  if (!target.isSuspended) {
    return { id: target.id, isSuspended: false };
  }

  await withTransaction(async (tx) => {
    await adminRepo.setUserSuspension(target.id, false, tx);
    await auditLogRepo.createAuditLog(
      {
        actorId: operatorId,
        action: 'user.reactivate',
        targetType: 'User',
        targetId: target.id,
        diff: JSON.stringify({ isSuspended: { before: true, after: false } }),
        reason: input.reason,
        ip: operatorIp,
      },
      tx
    );
  });

  return { id: target.id, isSuspended: false };
}

export async function changeUserRole(
  operatorId: string,
  inputRaw: unknown,
  operatorIp = 'unknown'
) {
  const input = parseOrThrow(changeRoleSchema, inputRaw);

  if (operatorId === input.userId && input.newRole !== 'admin') {
    throw new ServiceError('CONFLICT', '不可變更或降級自己的管理員角色');
  }

  const target = await usersRepo.findById(input.userId);
  if (!target) {
    throw new ServiceError('NOT_FOUND', '使用者不存在');
  }

  if (target.role === input.newRole) {
    return { id: target.id, role: target.role };
  }

  // 若降級管理員，確保不是最後一位有效管理員
  if (target.role === 'admin' && input.newRole !== 'admin') {
    const activeAdmins = await adminRepo.countActiveAdmins();
    if (activeAdmins <= 1) {
      throw new ServiceError('CONFLICT', '不可降級系統中最後一位有效管理員');
    }
  }

  await withTransaction(async (tx) => {
    await adminRepo.setUserRole(target.id, input.newRole, tx);
    await auditLogRepo.createAuditLog(
      {
        actorId: operatorId,
        action: 'user.change_role',
        targetType: 'User',
        targetId: target.id,
        diff: JSON.stringify({ role: { before: target.role, after: input.newRole } }),
        reason: input.reason,
        ip: operatorIp,
      },
      tx
    );
  });

  return { id: target.id, role: input.newRole };
}

export async function resetUserPassword(
  operatorId: string,
  inputRaw: unknown,
  operatorIp = 'unknown'
) {
  const input = parseOrThrow(resetUserPasswordSchema, inputRaw);

  const target = await usersRepo.findById(input.userId);
  if (!target) {
    throw new ServiceError('NOT_FOUND', '使用者不存在');
  }

  const token = generateResetToken();
  // 依規格 009-admin-dashboard：管理員產生之重設連結 TTL 為 15 分鐘
  const expiresAt = new Date(Date.now() + 15 * 60_000);

  await withTransaction(async (tx) => {
    await passwordResetTokensRepo.invalidateActiveForUser(target.id, tx);
    await passwordResetTokensRepo.create(
      {
        userId: target.id,
        tokenHash: hashResetToken(token),
        expiresAt,
      },
      tx
    );

    await auditLogRepo.createAuditLog(
      {
        actorId: operatorId,
        action: `user.reset_password_${input.mode}`,
        targetType: 'User',
        targetId: target.id,
        reason: `管理員重設密碼（模式：${input.mode}）`,
        ip: operatorIp,
      },
      tx
    );
  });

  if (input.mode === 'email') {
    const message = passwordResetMail(target.email, token);
    try {
      await mailer.send(message);
      logMailAttempt({ mode: env.MAIL_MODE, message, result: 'sent' });
    } catch (err) {
      logMailAttempt({
        mode: env.MAIL_MODE,
        message,
        result: 'failed',
        errorCode: err instanceof MailSendError ? err.cause : 'UNKNOWN',
      });
      throw new ServiceError('MAIL_FAILED', '郵件發送失敗，請稍後重試');
    }

    return { mode: 'email' as const };
  }

  // mode === 'link'
  const resetUrl = `/auth/reset-password?token=${token}`;
  return {
    mode: 'link' as const,
    resetUrl,
    expiresAt: expiresAt.toISOString(),
  };
}

// ─────────────────────────────────────────────
// §2 內容管理（作品、章節、留言）
// ─────────────────────────────────────────────

export async function listNovelsForAdmin(filterRaw: unknown = {}) {
  const filter = parseOrThrow(adminNovelFilterSchema, filterRaw);
  return adminRepo.listNovelsForAdmin(
    {
      search: filter.search,
      categoryId: filter.categoryId,
      status: filter.status,
    },
    filter.cursor,
    filter.limit
  );
}

export async function getNovelForAdmin(novelId: string) {
  return adminRepo.getNovelById(novelId);
}

export async function adminSuspendNovel(
  operatorId: string,
  inputRaw: unknown,
  operatorIp = 'unknown'
) {
  const input = parseOrThrow(adminSuspendNovelSchema, inputRaw);
  const novel = await adminRepo.getNovelById(input.novelId);
  if (!novel) {
    throw new ServiceError('NOT_FOUND', '找不到指定作品');
  }

  await withTransaction(async (tx) => {
    await adminRepo.setNovelStatus(input.novelId, 'admin_suspended', tx);
    await auditLogRepo.createAuditLog(
      {
        actorId: operatorId,
        action: 'novel.admin_suspend',
        targetType: 'Novel',
        targetId: input.novelId,
        diff: JSON.stringify({
          status: { before: novel.status, after: 'admin_suspended' },
          title: novel.title,
        }),
        reason: input.reason,
        ip: operatorIp,
      },
      tx
    );
  });

  invalidateNovel(input.novelId);
  invalidateNovelsList();
}

export async function adminRestoreNovel(
  operatorId: string,
  inputRaw: unknown,
  operatorIp = 'unknown'
) {
  const input = parseOrThrow(adminRestoreNovelSchema, inputRaw);
  const novel = await adminRepo.getNovelById(input.novelId);
  if (!novel) {
    throw new ServiceError('NOT_FOUND', '找不到指定作品');
  }

  await withTransaction(async (tx) => {
    await adminRepo.setNovelStatus(input.novelId, 'published', tx);
    await auditLogRepo.createAuditLog(
      {
        actorId: operatorId,
        action: 'novel.restore',
        targetType: 'Novel',
        targetId: input.novelId,
        diff: JSON.stringify({
          status: { before: novel.status, after: 'published' },
          title: novel.title,
        }),
        reason: input.reason,
        ip: operatorIp,
      },
      tx
    );
  });

  invalidateNovel(input.novelId);
  invalidateNovelsList();
}

export async function adminDeleteNovel(
  operatorId: string,
  inputRaw: unknown,
  operatorIp = 'unknown'
) {
  const input = parseOrThrow(adminDeleteNovelSchema, inputRaw);
  const novel = await adminRepo.getNovelById(input.novelId);
  if (!novel) {
    throw new ServiceError('NOT_FOUND', '找不到指定作品');
  }

  await withTransaction(async (tx) => {
    await adminRepo.deleteNovelCascade(input.novelId, tx);
    await auditLogRepo.createAuditLog(
      {
        actorId: operatorId,
        action: 'novel.delete',
        targetType: 'Novel',
        targetId: input.novelId,
        diff: JSON.stringify({
          title: novel.title,
          authorId: novel.authorId,
        }),
        reason: input.reason,
        ip: operatorIp,
      },
      tx
    );
  });

  invalidateNovel(input.novelId);
  invalidateNovelsList();
}

export async function listChaptersForAdmin(novelId: string) {
  return adminRepo.listChaptersForAdmin(novelId);
}

export async function adminSuspendChapter(
  operatorId: string,
  inputRaw: unknown,
  operatorIp = 'unknown'
) {
  const input = parseOrThrow(adminSuspendChapterSchema, inputRaw);
  const chapter = await adminRepo.getChapterById(input.chapterId);
  if (!chapter) {
    throw new ServiceError('NOT_FOUND', '找不到指定章節');
  }

  await withTransaction(async (tx) => {
    await adminRepo.setChapterStatus(input.chapterId, 'admin_suspended', tx);
    await auditLogRepo.createAuditLog(
      {
        actorId: operatorId,
        action: 'chapter.admin_suspend',
        targetType: 'Chapter',
        targetId: input.chapterId,
        diff: JSON.stringify({
          status: { before: chapter.status, after: 'admin_suspended' },
          novelId: chapter.novelId,
          number: chapter.number,
        }),
        reason: input.reason,
        ip: operatorIp,
      },
      tx
    );
  });

  invalidateChapter(input.chapterId);
  invalidateNovel(chapter.novelId);
  invalidateNovelsList();
}

export async function adminRestoreChapter(
  operatorId: string,
  inputRaw: unknown,
  operatorIp = 'unknown'
) {
  const input = parseOrThrow(adminRestoreChapterSchema, inputRaw);
  const chapter = await adminRepo.getChapterById(input.chapterId);
  if (!chapter) {
    throw new ServiceError('NOT_FOUND', '找不到指定章節');
  }

  await withTransaction(async (tx) => {
    await adminRepo.setChapterStatus(input.chapterId, 'published', tx);
    await auditLogRepo.createAuditLog(
      {
        actorId: operatorId,
        action: 'chapter.restore',
        targetType: 'Chapter',
        targetId: input.chapterId,
        diff: JSON.stringify({
          status: { before: chapter.status, after: 'published' },
          novelId: chapter.novelId,
          number: chapter.number,
        }),
        reason: input.reason,
        ip: operatorIp,
      },
      tx
    );
  });

  invalidateChapter(input.chapterId);
  invalidateNovel(chapter.novelId);
  invalidateNovelsList();
}

export async function adminDeleteChapter(
  operatorId: string,
  inputRaw: unknown,
  operatorIp = 'unknown'
) {
  const input = parseOrThrow(adminDeleteChapterSchema, inputRaw);
  const chapter = await adminRepo.getChapterById(input.chapterId);
  if (!chapter) {
    throw new ServiceError('NOT_FOUND', '找不到指定章節');
  }

  const result = await withTransaction(async (tx) => {
    const recount = await adminRepo.deleteChapterAndRecount(input.chapterId, chapter.novelId, tx);
    await auditLogRepo.createAuditLog(
      {
        actorId: operatorId,
        action: 'chapter.delete',
        targetType: 'Chapter',
        targetId: input.chapterId,
        diff: JSON.stringify({
          novelId: chapter.novelId,
          number: chapter.number,
          title: chapter.title,
          recountedWordCount: recount.wordCount,
          recountedChapterCount: recount.chapterCount,
        }),
        reason: input.reason,
        ip: operatorIp,
      },
      tx
    );
    return recount;
  });

  invalidateChapter(input.chapterId);
  invalidateNovel(chapter.novelId);
  invalidateNovelsList();

  return result;
}

export async function moderateComment(
  operatorId: string,
  commentId: string,
  action: 'hide' | 'delete',
  reason: string,
  operatorIp = 'unknown'
) {
  await withTransaction(async (tx) => {
    if (action === 'hide') {
      await adminRepo.hideComment(commentId, tx);
    } else {
      await adminRepo.deleteComment(commentId, tx);
    }

    await auditLogRepo.createAuditLog(
      {
        actorId: operatorId,
        action: `comment.${action}`,
        targetType: 'Comment',
        targetId: commentId,
        reason,
        ip: operatorIp,
      },
      tx
    );
  });
}

// ─────────────────────────────────────────────
// §3 標籤治理
// ─────────────────────────────────────────────

/**
 * 稽核 diff 裡受影響作品清單的上限（2026-09-06）。
 *
 * **為何要記 id 而不只記數量**：憲章要求稽核能回答「誰在什麼時候對誰做了什麼」，
 * 而標籤刪除與合併都是**不可逆**的（`Tag.id` 是 cuid，重建同名標籤拿到的是新 id，
 * 原關聯回不來）。只記 `affectedNovelsCount` 的話，事後看日誌知道「影響 3 部作品」，
 * 卻查不出是哪 3 部 —— 想補救得靠人腦回憶。
 *
 * **為何要設上限**：`AuditLog.diff` 是 String 欄，不設限的話一個掛了數千部作品的標籤
 * 會寫進一筆數百 KB 的紀錄。超出上限時保留前 N 筆並標記 `truncated`，
 * 讓看日誌的人知道「這份清單不完整」，而不是誤以為只影響了 N 部。
 */
const AUDIT_NOVEL_ID_LIMIT = 500;

function auditNovelIds(novelIds: string[]) {
  return novelIds.length > AUDIT_NOVEL_ID_LIMIT
    ? { affectedNovelIds: novelIds.slice(0, AUDIT_NOVEL_ID_LIMIT), truncated: true }
    : { affectedNovelIds: novelIds };
}

async function rebuildSearchText(novelId: string, tx?: TxClient): Promise<void> {
  const source = await getNovelSearchSource(novelId, tx);
  if (!source) return;
  await setNovelSearchText(novelId, buildSearchText(source), tx);
}

export async function listTags(filterRaw: unknown = {}) {
  const filter = parseOrThrow(adminTagFilterSchema, filterRaw);
  return adminRepo.listTagsWithCount(filter.search, filter.sortBy, filter.sortOrder);
}

export async function createTag(operatorId: string, inputRaw: unknown, operatorIp = 'unknown') {
  const input = parseOrThrow(createTagSchema, inputRaw);

  try {
    return await withTransaction(async (tx) => {
      const created = await adminRepo.createTag(input.name, input.slug, tx);
      await auditLogRepo.createAuditLog(
        {
          actorId: operatorId,
          action: 'tag.create',
          targetType: 'Tag',
          targetId: created.id,
          diff: JSON.stringify(input),
          reason: '管理員建立新標籤',
          ip: operatorIp,
        },
        tx
      );
      return created;
    });
  } catch (err) {
    throw translateDbError(err, '標籤名稱或代稱已存在');
  }
}

export async function renameTag(operatorId: string, inputRaw: unknown, operatorIp = 'unknown') {
  const input = parseOrThrow(renameTagSchema, inputRaw);

  const tag = await adminRepo.getTagWithCount(input.tagId);
  if (!tag) {
    throw new ServiceError('NOT_FOUND', '找不到指定標籤');
  }

  try {
    await withTransaction(async (tx) => {
      await adminRepo.updateTagRow(input.tagId, { name: input.name, slug: input.slug }, tx);
      const novelIds = await adminRepo.listNovelIdsByTagId(input.tagId, tx);

      for (const novelId of novelIds) {
        await rebuildSearchText(novelId, tx);
        invalidateNovel(novelId);
      }

      await auditLogRepo.createAuditLog(
        {
          actorId: operatorId,
          action: 'tag.rename',
          targetType: 'Tag',
          targetId: input.tagId,
          diff: JSON.stringify({
            before: { name: tag.name, slug: tag.slug },
            after: { name: input.name, slug: input.slug },
            affectedNovelsCount: novelIds.length,
          }),
          reason: '管理員編輯標籤名稱或代稱',
          ip: operatorIp,
        },
        tx
      );
    });

    invalidateNovelsList();
  } catch (err) {
    if (err instanceof ServiceError) throw err;
    throw translateDbError(err, '標籤名稱或代稱已存在');
  }
}

export async function mergeTags(operatorId: string, inputRaw: unknown, operatorIp = 'unknown') {
  const input = parseOrThrow(mergeTagsSchema, inputRaw);

  if (input.sourceTagId === input.targetTagId) {
    throw new ServiceError('VALIDATION_ERROR', '來源標籤與目標標籤不可相同');
  }

  const source = await adminRepo.getTagWithCount(input.sourceTagId);
  const target = await adminRepo.getTagWithCount(input.targetTagId);

  if (!source || !target) {
    throw new ServiceError('NOT_FOUND', '找不到來源或目標標籤');
  }

  const result = await withTransaction(async (tx) => {
    const mergeResult = await adminRepo.mergeTags(input.sourceTagId, input.targetTagId, tx);

    for (const novelId of mergeResult.affectedNovelIds) {
      await rebuildSearchText(novelId, tx);
      invalidateNovel(novelId);
    }

    await auditLogRepo.createAuditLog(
      {
        actorId: operatorId,
        action: 'tag.merge',
        targetType: 'Tag',
        targetId: input.targetTagId,
        diff: JSON.stringify({
          sourceTag: { id: source.id, name: source.name },
          targetTag: { id: target.id, name: target.name },
          affectedNovelsCount: mergeResult.affectedCount,
          ...auditNovelIds(mergeResult.affectedNovelIds),
        }),
        reason: input.reason,
        ip: operatorIp,
      },
      tx
    );

    return mergeResult;
  });

  invalidateNovelsList();
  return result;
}

export async function deleteTag(operatorId: string, inputRaw: unknown, operatorIp = 'unknown') {
  const input = parseOrThrow(deleteTagSchema, inputRaw);

  const tag = await adminRepo.getTagWithCount(input.tagId);
  if (!tag) {
    throw new ServiceError('NOT_FOUND', '找不到指定標籤');
  }

  if (tag.novelCount > 0 && !input.force) {
    throw new ServiceError(
      'VALIDATION_ERROR',
      `此標籤目前仍有 ${tag.novelCount} 部關聯作品，如確定刪除請勾選確認`
    );
  }

  await withTransaction(async (tx) => {
    const novelIds = await adminRepo.listNovelIdsByTagId(input.tagId, tx);
    await adminRepo.deleteTag(input.tagId, tx);

    for (const novelId of novelIds) {
      await rebuildSearchText(novelId, tx);
      invalidateNovel(novelId);
    }

    await auditLogRepo.createAuditLog(
      {
        actorId: operatorId,
        action: 'tag.delete',
        targetType: 'Tag',
        targetId: input.tagId,
        diff: JSON.stringify({
          deletedTag: { name: tag.name, slug: tag.slug },
          affectedNovelsCount: novelIds.length,
          ...auditNovelIds(novelIds),
        }),
        reason: input.reason,
        ip: operatorIp,
      },
      tx
    );
  });

  invalidateNovelsList();
}

// ─────────────────────────────────────────────
// §4 稽核管理
// ─────────────────────────────────────────────

export async function listAuditLogs(filterRaw: unknown = {}) {
  const filter = parseOrThrow(adminAuditLogFilterSchema, filterRaw);
  return auditLogRepo.listAuditLogs(
    {
      actorId: filter.actorId,
      action: filter.action,
      targetType: filter.targetType,
      targetId: filter.targetId,
      dateFrom: filter.dateFrom,
      dateTo: filter.dateTo,
    },
    filter.cursor,
    filter.limit
  );
}
