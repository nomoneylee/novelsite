/**
 * 分類資料存取（Categories Repository）
 */
import 'server-only';
import { prisma } from '@/lib/db';
import type { Category } from '@/lib/types';
import { toCategory } from './mappers';

/** 取得所有分類（依 sortOrder） */
export async function getCategories(): Promise<Category[]> {
  const rows = await prisma.category.findMany({ orderBy: { sortOrder: 'asc' } });
  return rows.map(toCategory);
}

/** 依 id 取得單一分類 */
export async function getCategoryById(id: string): Promise<Category | null> {
  const row = await prisma.category.findUnique({ where: { id } });
  return row ? toCategory(row) : null;
}
