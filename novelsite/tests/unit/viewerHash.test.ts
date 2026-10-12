import { describe, expect, it, afterEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { env } from '@/lib/env';
import { viewerHashForUser, viewerHashForAnonymous } from '@/lib/stats/viewerHash';

/**
 * T085：閱讀者識別雜湊（FR-034、SC-006a、contracts/internal-modules.md §3）
 * ==========================================================================
 * `viewerHash` 同時扛兩件事：去重的鍵，以及成效總覽「不重複讀者數」的分母。
 * 它必須**恆定**（同一位讀者跨日、跨重啟皆為同值，否則分母從「人」變成「人次」），
 * 又必須**不可還原**（它是把來源位址與瀏覽器識別字串留在資料庫裡的唯一形式）。
 *
 * 兩者的張力正是本檔要釘住的：一個隨日期輪替的鹽值會讓第二點成立而第一點失效，
 * 而那種錯誤在單日的測試裡完全看不出來 —— 上線一週後才以「不重複讀者數逐日暴增」現形。
 *
 * **本檔自行以 `node:crypto` 算出期望值**：只比對「兩次呼叫相等」擋不住
 * 「每個行程一把隨機鹽值」的實作（同一行程內確實恆相等）。
 * 以固定的 `VIEW_HASH_SECRET` 獨立算一次，才把演算法與鹽值來源一起釘死 ——
 * 那也是「應用重啟後不變」在單一行程內唯一能被證明的方式。
 */

const IP = '203.0.113.45';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) TestAgent/1.0';
const USER_ID = 'user-viewerhash-001';

/** 契約規定的算式：`HMAC-SHA256(VIEW_HASH_SECRET, prefix + payload)`，前綴 `u:` / `a:` */
function expectedHash(payload: string): string {
  return createHmac('sha256', env.VIEW_HASH_SECRET).update(payload).digest('hex');
}

afterEach(() => {
  vi.useRealTimers();
});

describe('viewerHashForUser', () => {
  it('等於 HMAC-SHA256(VIEW_HASH_SECRET, "u:" + userId)', () => {
    expect(viewerHashForUser(USER_ID)).toBe(expectedHash(`u:${USER_ID}`));
  });

  it('不同使用者為不同值', () => {
    expect(viewerHashForUser('user-a')).not.toBe(viewerHashForUser('user-b'));
  });
});

describe('viewerHashForAnonymous', () => {
  it('等於 HMAC-SHA256(VIEW_HASH_SECRET, "a:" + ip + "|" + userAgent)', () => {
    expect(viewerHashForAnonymous(IP, UA)).toBe(expectedHash(`a:${IP}|${UA}`));
  });

  it('換位址或換瀏覽器識別字串即為不同值', () => {
    const base = viewerHashForAnonymous(IP, UA);
    expect(viewerHashForAnonymous('198.51.100.7', UA)).not.toBe(base);
    expect(viewerHashForAnonymous(IP, `${UA} Extra`)).not.toBe(base);
  });

  it('瀏覽器識別字串為空字串時仍產生合法雜湊，MUST NOT 擲出（缺 User-Agent 的請求是常態）', () => {
    const hash = viewerHashForAnonymous(IP, '');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(expectedHash(`a:${IP}|`));
  });
});

describe('恆定性：跨日與跨重啟（SC-006a）', () => {
  it('同一位登入讀者於不同日期呼叫恆為同值（鹽值 MUST NOT 隨日期輪替）', () => {
    vi.useFakeTimers();

    vi.setSystemTime(new Date('2026-08-01T03:00:00.000Z'));
    const day1 = viewerHashForUser(USER_ID);

    vi.setSystemTime(new Date('2026-08-08T21:30:00.000Z')); // 跨過七個日界線
    const day8 = viewerHashForUser(USER_ID);

    vi.setSystemTime(new Date('2027-01-01T00:00:00.000Z')); // 跨年
    const nextYear = viewerHashForUser(USER_ID);

    expect(day8).toBe(day1);
    expect(nextYear).toBe(day1);
  });

  it('同一位匿名讀者於不同日期呼叫恆為同值（近 7 日不重複讀者數才會是 1 而非 7）', () => {
    vi.useFakeTimers();

    vi.setSystemTime(new Date('2026-08-01T16:00:00.000Z'));
    const first = viewerHashForAnonymous(IP, UA);

    vi.setSystemTime(new Date('2026-08-05T16:00:00.000Z'));
    const later = viewerHashForAnonymous(IP, UA);

    expect(later).toBe(first);
  });

  it('模組重新載入後仍為同值（等同應用重啟：鹽值取自設定，MUST NOT 在模組初始化時隨機產生）', async () => {
    const before = viewerHashForUser(USER_ID);

    vi.resetModules();
    const reloaded = await import('@/lib/stats/viewerHash');

    expect(reloaded.viewerHashForUser(USER_ID)).toBe(before);
    // 與獨立算出的期望值一併比對 —— 只比「重載後相等」擋不住兩次都讀到同一個模組快取的情形
    expect(reloaded.viewerHashForUser(USER_ID)).toBe(expectedHash(`u:${USER_ID}`));
  });
});

describe('兩個命名空間不碰撞', () => {
  /**
   * 這一案是「前綴被省略」的專屬探針。少了 `u:` / `a:`，
   * 一位識別碼恰為 `<ip>|<ua>` 的使用者，會與那個位址上的匿名讀者算出同一個雜湊，
   * 兩者的閱讀因而被去重掉一半 —— 而那是可以被刻意構造出來的。
   */
  it('登入者識別碼恰為「位址|瀏覽器字串」時，仍與該匿名讀者為不同值', () => {
    const crafted = `${IP}|${UA}`;
    expect(viewerHashForUser(crafted)).not.toBe(viewerHashForAnonymous(IP, UA));
  });

  it('登入者識別碼帶 "a:" 前綴時也不與匿名雜湊碰撞', () => {
    const crafted = `a:${IP}|${UA}`;
    expect(viewerHashForUser(crafted)).not.toBe(viewerHashForAnonymous(IP, UA));
  });
});

describe('不可還原：MUST NOT 保存原始位址或瀏覽器識別字串原文（FR-034）', () => {
  it('輸出為 64 個小寫十六進位字元的 SHA-256 摘要', () => {
    expect(viewerHashForAnonymous(IP, UA)).toMatch(/^[0-9a-f]{64}$/);
    expect(viewerHashForUser(USER_ID)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('輸出不含位址、瀏覽器字串或使用者識別碼的任何片段', () => {
    const anon = viewerHashForAnonymous(IP, UA);
    expect(anon).not.toContain(IP);
    expect(anon).not.toContain('203.0.113');
    expect(anon).not.toContain('Mozilla');
    expect(anon).not.toContain('TestAgent');
    // base64 藏原文也算保存原文
    expect(anon).not.toContain(Buffer.from(IP).toString('base64'));

    expect(viewerHashForUser(USER_ID)).not.toContain(USER_ID);
  });

  it('輸出不含鹽值本身', () => {
    expect(viewerHashForAnonymous(IP, UA)).not.toContain(env.VIEW_HASH_SECRET);
  });
});
