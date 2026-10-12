import 'server-only';
import { findReaderPreference, upsertReaderPreference } from '@/lib/repositories';
import type { ReaderPreference } from '@/lib/types';
import { parseOrThrow } from './errors';
import { readerPreferenceSchema } from '@/lib/validation/reader';

/**
 * 閱讀偏好服務（FEAT-4 4-A / T026）
 * ===================================
 * 同步範圍**只有** `fontSize` 與 `theme`（FR-014）：無 `lineHeight`（全站無控制項）、
 * 無「無干擾模式」（現行明訂不跨章節記憶，同步它會讓下一章莫名其妙地藏起工具列）。
 *
 * 這兩項分屬**兩個不同的客戶端 Hook**（`useReaderPrefs` 管字級、`useTheme` 管主題），
 * 但在伺服器端是同一列，故只有一個端點。
 */

export async function get(userId: string): Promise<ReaderPreference | null> {
  const row = await findReaderPreference(userId);
  return row ? (row as ReaderPreference) : null;
}

/** 局部更新：只給 `theme` 時 `fontSize` 保持原值（PUT 的兩項皆為可選） */
export async function put(userId: string, input: unknown): Promise<ReaderPreference> {
  const patch = parseOrThrow(readerPreferenceSchema, input);
  const row = await upsertReaderPreference(userId, patch);
  return row as ReaderPreference;
}
