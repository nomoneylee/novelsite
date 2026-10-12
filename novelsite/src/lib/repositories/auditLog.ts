import 'server-only';
import { createHash } from 'node:crypto';
import { prisma } from '@/lib/db';
import type { TxClient } from './tx';
import type { AuditLogRow } from '@/lib/types';

/**
 * 管理動作稽核紀錄存取模組（FEAT-9 / 009-admin-dashboard）
 * =========================================================
 * 純追加（append-only），絕不提供修改或刪除介面（憲章第 II 條、R-4）。
 */

export interface CreateAuditLogInput {
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  diff?: string;
  reason?: string;
  ip?: string;
}

export interface ListAuditLogsFilter {
  actorId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  dateFrom?: string;
  dateTo?: string;
}

/** 寫入單筆稽核紀錄（純追加，支援傳入交易用戶端） */
export async function createAuditLog(
  data: CreateAuditLogInput,
  tx?: TxClient
): Promise<AuditLogRow> {
  const client = tx ?? prisma;
  const entry = await client.auditLog.create({
    data: {
      actorId: data.actorId,
      action: data.action,
      targetType: data.targetType,
      targetId: data.targetId,
      diff: data.diff ?? '{}',
      reason: data.reason ?? '',
      ip: data.ip ?? '',
    },
  });

  return {
    id: entry.id,
    actorId: entry.actorId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    diff: entry.diff,
    reason: entry.reason,
    ip: entry.ip,
    createdAt: entry.createdAt.toISOString(),
  };
}

/** 多維度游標/分頁查詢稽核紀錄 */
export async function listAuditLogs(
  filter: ListAuditLogsFilter = {},
  cursor?: string,
  limit = 20
): Promise<{ items: AuditLogRow[]; nextCursor: string | null; totalCount: number }> {
  const where: Record<string, unknown> = {};

  if (filter.actorId) {
    where.actorId = filter.actorId;
  }
  if (filter.action) {
    where.action = filter.action;
  }
  if (filter.targetType) {
    where.targetType = filter.targetType;
  }
  if (filter.targetId) {
    where.targetId = filter.targetId;
  }

  if (filter.dateFrom || filter.dateTo) {
    const createdAtFilter: Record<string, Date> = {};
    if (filter.dateFrom) {
      createdAtFilter.gte = new Date(filter.dateFrom);
    }
    if (filter.dateTo) {
      createdAtFilter.lte = new Date(filter.dateTo);
    }
    where.createdAt = createdAtFilter;
  }

  const [totalCount, entries] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      take: limit + 1,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const hasNextPage = entries.length > limit;
  const itemsSlice = hasNextPage ? entries.slice(0, limit) : entries;
  const nextCursor = hasNextPage ? itemsSlice[itemsSlice.length - 1].id : null;

  // 補充操作者姓名與 Email（以唯讀查詢批次批配，無外鍵）
  const actorIds = [...new Set(itemsSlice.map((e) => e.actorId))];
  const actors =
    actorIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, name: true, email: true },
        })
      : [];
  const actorMap = new Map(actors.map((a) => [a.id, a]));

  const items: AuditLogRow[] = itemsSlice.map((e) => {
    const actor = actorMap.get(e.actorId);
    return {
      id: e.id,
      actorId: e.actorId,
      actorName: actor?.name,
      actorEmail: actor?.email,
      action: e.action,
      targetType: e.targetType,
      targetId: e.targetId,
      diff: e.diff,
      reason: e.reason,
      ip: e.ip,
      createdAt: e.createdAt.toISOString(),
    };
  });

  return { items, nextCursor, totalCount };
}

/**
 * 90 天前 IP 不可逆雜湊化（R-5）
 * 將 createdAt < cutoffDate 且尚未雜湊化（長度非 64）的 IP 進行 sha256 處理
 */
export async function hashOldAuditIps(cutoffDate: Date): Promise<number> {
  const candidates = await prisma.auditLog.findMany({
    where: {
      createdAt: { lt: cutoffDate },
      ip: { not: '' },
    },
    select: { id: true, ip: true },
  });

  let count = 0;
  for (const item of candidates) {
    if (item.ip && item.ip.length !== 64) {
      const hashedIp = createHash('sha256').update(item.ip).digest('hex');
      await prisma.auditLog.update({
        where: { id: item.id },
        data: { ip: hashedIp },
      });
      count += 1;
    }
  }

  return count;
}
