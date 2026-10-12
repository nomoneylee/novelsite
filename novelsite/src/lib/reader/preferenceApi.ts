/**
 * 閱讀偏好的客戶端存取（FEAT-4 4-A / T036）
 * ===========================================
 * 同步範圍只有字級與主題，但這兩項分屬**兩個不同的 Hook**
 * （`useReaderPrefs` 管字級、`useTheme` 管主題）——伺服器端卻是同一列。
 * 兩支 Hook 因此共用本檔的同一個端點呼叫，各自只取自己的那一欄。
 */

// 前綴在常數這一層補上（FR-074）——本檔由 client Hook 呼叫，
// 端點以常數而非 fetch 內的字面量存在，故 T027 稽核的 `fetch('/api/…')` 樣式看不到它。
// 漏掉的症狀：子路徑部署下偏好同步永遠靜默失敗（本檔的兩處 catch 都不出聲）
import { apiUrl } from '@/lib/apiUrl';

const ENDPOINT = apiUrl('/api/reader-preference');

export interface RemotePreference {
  fontSize?: string;
  theme?: string;
}

/** 尚未設定過偏好者回 `null`（沿用本機現值，而非把它蓋成預設值） */
export async function fetchPreference(): Promise<RemotePreference | null> {
  try {
    const res = await fetch(ENDPOINT);
    if (!res.ok) return null;
    const json = (await res.json()) as { preference: RemotePreference | null };
    return json.preference;
  } catch {
    return null;
  }
}

/** 局部更新：只送要改的那一項，另一項在伺服器端保持原值 */
export async function savePreference(patch: RemotePreference): Promise<void> {
  try {
    await fetch(ENDPOINT, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
  } catch {
    // 偏好同步失敗不該打斷閱讀；本機值仍是對的，下次改動會再送一次
  }
}
