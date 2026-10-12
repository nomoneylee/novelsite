import 'server-only';
import { prisma } from '@/lib/db';
import type { Session } from '@/generated/prisma/client';

export interface CreateSessionInput {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  userAgent: string;
  ip: string;
}

export async function create(input: CreateSessionInput): Promise<Session> {
  return prisma.session.create({ data: input });
}

export interface SessionWithUser extends Session {
  user?: {
    isSuspended: boolean;
    role: string;
  } | null;
}

export async function findByTokenHash(tokenHash: string): Promise<SessionWithUser | null> {
  return prisma.session.findUnique({
    where: { tokenHash },
    include: {
      user: {
        select: {
          isSuspended: true,
          role: true,
        },
      },
    },
  });
}

/** 節流延展：寫入新的 expiresAt 並更新 lastUsedAt（見 data-model.md §3.3） */
export async function touch(id: string, expiresAt: Date): Promise<void> {
  await prisma.session.update({ where: { id }, data: { expiresAt, lastUsedAt: new Date() } });
}

export async function revoke(id: string): Promise<void> {
  await prisma.session.update({ where: { id }, data: { revokedAt: new Date() } });
}

export async function revokeAllForUser(userId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** 供 FR-044 在登入成功後呼叫；失敗須被呼叫端吞掉、不影響登入 */
export async function deleteExpiredForUser(userId: string): Promise<void> {
  const now = new Date();
  await prisma.session.deleteMany({
    where: {
      userId,
      OR: [{ revokedAt: { not: null } }, { expiresAt: { lt: now } }],
    },
  });
}
