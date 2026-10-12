/**
 * 書架的客戶端存取（FEAT-4 4-A / T034）
 * =======================================
 * `useBookshelf` 與 `useBookshelfIds` 共用同一份呼叫，避免兩支 Hook 各自拼一次
 * 端點路徑與錯誤處理 —— 那正是兩者對「在不在書架」給出不同答案的起點。
 */

// 前綴在常數這一層補上（FR-074）——理由同 `preferenceApi.ts`：
// 端點是常數而非 fetch 內的字面量，稽核的 `fetch('/api/…')` 樣式掃不到它。
// 漏掉的症狀：子路徑部署下加入書架永遠回 false，而畫面只是「按了沒反應」
import { apiUrl } from '@/lib/apiUrl';

const ENDPOINT = apiUrl('/api/bookshelf');

/** 收藏的全部作品識別碼。失敗回空陣列：書架讀不到不該讓整頁壞掉 */
export async function fetchBookshelfIds(): Promise<string[]> {
  try {
    const res = await fetch(`${ENDPOINT}?view=ids`);
    if (!res.ok) return [];
    const json = (await res.json()) as { ids?: string[] };
    return json.ids ?? [];
  } catch {
    return [];
  }
}

/** 加入／移出。回傳是否成功，供呼叫端決定要不要回滾樂觀更新 */
export async function toggleBookshelfRemote(novelId: string, add: boolean): Promise<boolean> {
  try {
    const res = await fetch(`${ENDPOINT}/${encodeURIComponent(novelId)}`, {
      method: add ? 'POST' : 'DELETE',
    });
    // 409（已在書架）與 404（不在書架）代表伺服器端已是目標狀態，視同成功
    return res.ok || res.status === 409 || res.status === 404;
  } catch {
    return false;
  }
}
