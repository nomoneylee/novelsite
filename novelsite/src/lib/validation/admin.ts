import { z } from 'zod';

/**
 * 管理後台輸入驗證（009-admin-dashboard / contracts/admin-actions.md）
 */

export const destructiveReasonSchema = z
  .string()
  .trim()
  .min(1, '請填寫操作理由')
  .max(200, '操作理由不能超過 200 字');

// ── 使用者管理 ──

export const adminUserFilterSchema = z.object({
  search: z.string().trim().optional(),
  role: z.enum(['reader', 'author', 'admin']).optional(),
  isSuspended: z.boolean().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const suspendUserSchema = z.object({
  userId: z.string().min(1, '缺少使用者 ID'),
  reason: destructiveReasonSchema,
});

export const reactivateUserSchema = z.object({
  userId: z.string().min(1, '缺少使用者 ID'),
  reason: destructiveReasonSchema,
});

export const changeRoleSchema = z.object({
  userId: z.string().min(1, '缺少使用者 ID'),
  newRole: z.enum(['reader', 'author', 'admin']),
  reason: destructiveReasonSchema,
});

export const resetUserPasswordSchema = z.object({
  userId: z.string().min(1, '缺少使用者 ID'),
  mode: z.enum(['email', 'link']),
});

// ── 內容管理 ──

export const adminNovelFilterSchema = z.object({
  search: z.string().trim().optional(),
  categoryId: z.string().optional(),
  status: z.enum(['draft', 'published', 'admin_suspended']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const adminSuspendNovelSchema = z.object({
  novelId: z.string().min(1, '缺少作品 ID'),
  reason: destructiveReasonSchema,
});

export const adminRestoreNovelSchema = z.object({
  novelId: z.string().min(1, '缺少作品 ID'),
  reason: destructiveReasonSchema,
});

export const adminDeleteNovelSchema = z.object({
  novelId: z.string().min(1, '缺少作品 ID'),
  reason: destructiveReasonSchema,
});

export const adminSuspendChapterSchema = z.object({
  chapterId: z.string().min(1, '缺少章節 ID'),
  reason: destructiveReasonSchema,
});

export const adminRestoreChapterSchema = z.object({
  chapterId: z.string().min(1, '缺少章節 ID'),
  reason: destructiveReasonSchema,
});

export const adminDeleteChapterSchema = z.object({
  chapterId: z.string().min(1, '缺少章節 ID'),
  reason: destructiveReasonSchema,
});

export const hideCommentSchema = z.object({
  commentId: z.string().min(1, '缺少留言 ID'),
  reason: destructiveReasonSchema,
});

export const deleteCommentSchema = z.object({
  commentId: z.string().min(1, '缺少留言 ID'),
  reason: destructiveReasonSchema,
});

// ── 標籤管理 ──

export const adminTagFilterSchema = z.object({
  search: z.string().trim().optional(),
  sortBy: z.enum(['name', 'count']).default('name'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
});

export const createTagSchema = z.object({
  name: z.string().trim().min(1, '請輸入標籤名稱').max(30, '標籤名稱不能超過 30 字'),
  slug: z
    .string()
    .trim()
    .min(1, '請輸入標籤代稱')
    .max(50, '標籤代稱不能超過 50 字')
    .regex(/^[a-z0-9-]+$/, '代稱僅能包含小寫英數字及連字號'),
});

export const renameTagSchema = z.object({
  tagId: z.string().min(1, '缺少標籤 ID'),
  name: z.string().trim().min(1, '請輸入標籤名稱').max(30, '標籤名稱不能超過 30 字'),
  slug: z
    .string()
    .trim()
    .min(1, '請輸入標籤代稱')
    .max(50, '標籤代稱不能超過 50 字')
    .regex(/^[a-z0-9-]+$/, '代稱僅能包含小寫英數字及連字號'),
});

export const tagMergeSchema = z.object({
  sourceTagId: z.string().min(1, '缺少來源標籤 ID'),
  targetTagId: z.string().min(1, '缺少目標標籤 ID'),
  reason: destructiveReasonSchema,
});

export const mergeTagsSchema = tagMergeSchema;

export const deleteTagSchema = z.object({
  tagId: z.string().min(1, '缺少標籤 ID'),
  force: z.boolean().default(false),
  reason: destructiveReasonSchema,
});

// ── 稽核管理 ──

export const adminAuditLogFilterSchema = z.object({
  actorId: z.string().optional(),
  action: z.string().optional(),
  targetType: z.string().optional(),
  targetId: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type AdminUserFilter = z.infer<typeof adminUserFilterSchema>;
export type AdminNovelFilter = z.infer<typeof adminNovelFilterSchema>;
export type AdminTagFilter = z.infer<typeof adminTagFilterSchema>;
export type AuditLogFilter = z.infer<typeof adminAuditLogFilterSchema>;
