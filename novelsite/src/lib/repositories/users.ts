import 'server-only';
import { prisma } from '@/lib/db';
import { db, type TxClient } from './tx';
import type { User } from '@/generated/prisma/client';
import type { UserProfile } from '@/lib/types';
import type { Role } from '@/lib/auth/sessionToken';

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function findByEmail(email: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
}

export async function findById(id: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { id } });
}

export interface CreateUserInput {
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
  termsAcceptedAt: Date;
}

export async function create(input: CreateUserInput): Promise<User> {
  return prisma.user.create({
    data: { ...input, email: normalizeEmail(input.email) },
  });
}

export async function updatePasswordHash(id: string, passwordHash: string): Promise<User> {
  return prisma.user.update({ where: { id }, data: { passwordHash } });
}

// ─────────────────────────────────────────────
// 個人設定（FEAT-3 US3，FR-021／FR-023）
// ─────────────────────────────────────────────

/**
 * 個人設定表單的回填來源（只取表單真的會用到的四欄）。
 *
 * MUST NOT 改成回傳整個 `User` 交給用戶端 —— 那一列有 `passwordHash`，
 * 而「只是先撈出來、渲染時再挑」的資料一樣會被序列化進 flight payload。
 */
export async function findProfile(id: string): Promise<UserProfile | null> {
  const row = await prisma.user.findUnique({
    where: { id },
    select: { name: true, penName: true, bio: true, avatarColor: true },
  });
  if (!row) return null;

  return {
    name: row.name,
    penName: row.penName ?? '',
    bio: row.bio,
    avatarColor: row.avatarColor,
  };
}

export interface UpdateProfileRow {
  name?: string;
  /**
   * `null` 代表**清空**（公開顯示名遞補為 `name`），`undefined` 代表不動。
   * MUST NOT 以空字串落庫 —— `penName ?? name` 的遞補對空字串不成立，
   * 顯示名會變成一片空白，而且看起來像資料壞掉而不是使用者清空了筆名。
   */
  penName?: string | null;
  bio?: string;
  avatarColor?: string;
}

/** 更新個人資料欄位（MUST 於呼叫端的交易內執行，FR-028a） */
export async function updateProfile(
  id: string,
  data: UpdateProfileRow,
  tx?: TxClient
): Promise<void> {
  await db(tx).user.update({ where: { id }, data });
}

/**
 * 自助開通作者：角色與筆名一次寫入（FR-023）。
 *
 * 兩者同一筆 UPDATE 是刻意的 —— 分成兩次寫入時，中間失敗會留下
 * 「已經是作者但沒有筆名」的帳號，而作品的公開顯示名就會退回暱稱。
 */
export async function updateRoleAndPenName(
  id: string,
  role: Role,
  penName: string,
  tx?: TxClient
): Promise<void> {
  await db(tx).user.update({ where: { id }, data: { role, penName } });
}

// ─────────────────────────────────────────────
// 導覽列未讀數（FEAT-4 4-D，T123，research R-6）
// ─────────────────────────────────────────────

/** `findByIdWithUnread` 的回傳：版面所需的六格 ＋ 未讀數，於**同一次查詢**取回 */
export interface UserWithUnread {
  id: string;
  name: string;
  email: string;
  avatarColor: string;
  role: string;
  createdAt: Date;
  unreadCount: number;
}

/**
 * 版面用的使用者查詢，**未讀數以過濾式關聯計數併入同一次往返**（FR-053a、SC-020）。
 *
 * `SiteHeader` 出現在全部頁面。未讀數若另外 `count()` 一次，等於在**每一頁**上
 * 為一個多數時候是 0 的數字多付一次往返；Prisma 的 `_count` 帶 `where` 會被編成
 * 同一句 SQL 的關聯子查詢，故成本是「同一次查詢多一個欄位」而非多一次查詢。
 *
 * **MUST NOT 改回 `findById` + 另外計數**：兩者的總操作次數只差 1，看起來像可接受的
 * 誤差，但差的那一次乘上頁數與使用者數才是真正的量體（`tests/integration/
 * guest-query-budget.test.ts` 因而同時斷言「User 恰 1 次」與「Notification 恰 0 次」）。
 *
 * **只取版面需要的六格**：這一列會被序列化進每一頁的 flight payload，
 * 而完整的 `User` 有 `passwordHash`。
 */
export async function findByIdWithUnread(id: string): Promise<UserWithUnread | null> {
  const row = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      avatarColor: true,
      role: true,
      createdAt: true,
      _count: { select: { notifications: { where: { readAt: null } } } },
    },
  });
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    avatarColor: row.avatarColor,
    role: row.role,
    createdAt: row.createdAt,
    unreadCount: row._count.notifications,
  };
}
