import 'server-only';
import { adminRepo } from '@/lib/repositories';

/**
 * 營運數據與全站統計服務（FEAT-9 / 009-admin-dashboard）
 * ========================================================
 * 提供儀表板核心指標、趨勢時間序列以及分類生態分佈查詢。
 */

export async function getSiteOverview() {
  return adminRepo.getSiteStats();
}

export async function getDailyTrends(days: 7 | 30 = 7) {
  return adminRepo.getDailyTrends(days);
}

export async function getCategoryDistribution() {
  return adminRepo.getCategoryDistribution();
}
