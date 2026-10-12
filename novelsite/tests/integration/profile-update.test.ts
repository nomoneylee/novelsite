import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { testFetch, loginAs } from '../helpers/client';
import { callAction, hasErrorCode } from '../helpers/serverAction';
import {
  createAuthor,
  createSearchNovel,
  distinctCategoryIds,
  cleanupAuthoring,
  type TestAuthor,
} from '../helpers/authoring';

/**
 * US3 AC1／AC7 前半、AC8、FR-006a、FR-021：個資更新後真的落地。
 *
 * 「重新請求仍在」是這一組的判準，不是「Action 回了 success」——
 * FEAT-1 的個人設定頁正是一個**回了成功但什麼都沒寫**的表單（FR-016 要處理的就是它），
 * 只斷言回傳值等於把同一個錯誤再驗證一次。
 *
 * **搜尋預算不在本檔斷言**（見 `profile-search-sync.test.ts`）：那一條的重點是交易邊界，
 * 與「欄位有沒有存進去」是兩件不同的事，混在一起的話紅燈時分不出是哪一邊壞了。
 */

const IP = '10.70.1.1';
const ROUTE = '/profile/settings';

let author: TestAuthor;
let cookie: string;
let novelId: string;

async function userRow() {
  return prisma.user.findUniqueOrThrow({
    where: { id: author.id },
    select: { name: true, penName: true, bio: true, avatarColor: true },
  });
}

/** 自公開頁面讀回作者的顯示名，證明改動走到了讀者看得到的地方 */
async function novelDetailHtml(): Promise<string> {
  const res = await testFetch(`/novels/${novelId}`, { method: 'GET', ip: IP });
  expect(res.status).toBe(200);
  return res.text();
}

beforeAll(async () => {
  await cleanupAuthoring();
  author = await createAuthor('profile');
  const [categoryId] = await distinctCategoryIds(1);
  novelId = await createSearchNovel({
    authorId: author.id,
    categoryId,
    title: 'zprofile 作者顯示名測試作品',
    status: 'published',
  });
  cookie = await loginAs(author.email, author.password, IP);
});

afterAll(async () => {
  await cleanupAuthoring();
});

describe('四個欄位更新後重新請求仍在（US3 AC1、FR-021）', () => {
  it('暱稱／筆名／簡介／頭像色一次更新後全部落地', async () => {
    const avatarColor = 'linear-gradient(135deg, #0f766e 0%, #134e4a 100%)';
    const res = await callAction(
      'updateProfileAction',
      [{ name: '新暱稱', penName: '新筆名', bio: '這是新的作者簡介。', avatarColor }],
      { ip: IP, cookie, route: ROUTE }
    );

    expect(res.status).toBe(200);
    expect(await userRow()).toEqual({
      name: '新暱稱',
      penName: '新筆名',
      bio: '這是新的作者簡介。',
      avatarColor,
    });
  });

  it('重新載入設定頁後，畫面上帶的是新值（不是送出當下的樂觀狀態）', async () => {
    const res = await testFetch(ROUTE, { method: 'GET', ip: IP, cookie });
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain('新筆名');
    expect(html).toContain('這是新的作者簡介。');
  });
});

describe('簡介留空時其餘欄位仍可儲存（FR-006a：空字串是合法的「不寫」）', () => {
  it('bio 傳空字串成功，且其餘欄位照存', async () => {
    const res = await callAction('updateProfileAction', [{ name: '暱稱二版', bio: '' }], {
      ip: IP,
      cookie,
      route: ROUTE,
    });

    expect(res.status).toBe(200);
    const row = await userRow();
    expect(row.bio).toBe('');
    expect(row.name).toBe('暱稱二版');
  });

  /**
   * 資料庫的 `avatarColor` 預設值（緊湊寫法）**不在 `AVATAR_COLORS` 白名單內**，
   * 兩者畫出來一樣、字串不同。表單若以現值當初始值原樣送出，
   * 每一個新註冊的使用者連改暱稱都會被 `avatarColor` 擋下（T093 交接事項 H）。
   * 故「不帶這個欄位」MUST 是合法的，且 MUST 保留原值。
   */
  it('不帶 avatarColor 時可成功儲存，且原本的頭像色不變', async () => {
    const fresh = await createAuthor('avatar-default');
    const freshCookie = await loginAs(fresh.email, fresh.password, '10.70.1.3');
    const before = await prisma.user.findUniqueOrThrow({
      where: { id: fresh.id },
      select: { avatarColor: true },
    });

    const res = await callAction('updateProfileAction', [{ name: '沒動頭像色' }], {
      ip: '10.70.1.3',
      cookie: freshCookie,
      route: ROUTE,
    });

    expect(res.status).toBe(200);
    const after = await prisma.user.findUniqueOrThrow({
      where: { id: fresh.id },
      select: { name: true, avatarColor: true },
    });
    expect(after.name).toBe('沒動頭像色');
    expect(after.avatarColor).toBe(before.avatarColor);
  });

  it('暱稱留空則整筆拒絕（暱稱是公開顯示名的最後遞補值）', async () => {
    const before = await userRow();
    const res = await callAction('updateProfileAction', [{ name: '   ' }], {
      ip: IP,
      cookie,
      route: ROUTE,
    });

    expect(hasErrorCode(res, 'VALIDATION_ERROR')).toBe(true);
    expect(await userRow()).toEqual(before);
  });
});

describe('筆名清空後公開顯示名遞補為暱稱（FR-006a、US3 AC7 前半）', () => {
  it('清空前：作品詳情頁顯示筆名', async () => {
    await callAction('updateProfileAction', [{ penName: '顯示用筆名' }], {
      ip: IP,
      cookie,
      route: ROUTE,
    });

    const html = await novelDetailHtml();
    expect(html).toContain('顯示用筆名');
  });

  it('清空後：`penName` 落庫為 null（非空字串），公開顯示名改用暱稱', async () => {
    await callAction('updateProfileAction', [{ name: '遞補用暱稱', penName: '' }], {
      ip: IP,
      cookie,
      route: ROUTE,
    });

    // 空字串若原樣落庫，`penName ?? name` 的遞補永遠不會發生，顯示名會變成空白
    expect((await userRow()).penName).toBeNull();

    const html = await novelDetailHtml();
    expect(html).toContain('遞補用暱稱');
    expect(html).not.toContain('顯示用筆名');
  });

  it('改筆名後既有作品的公開顯示名反映新值（US3 AC7 前半）', async () => {
    await callAction('updateProfileAction', [{ penName: '再改一次的筆名' }], {
      ip: IP,
      cookie,
      route: ROUTE,
    });

    const html = await novelDetailHtml();
    expect(html).toContain('再改一次的筆名');
  });
});

describe('作者簡介的單一真相來源為 User.bio（US3 AC8、FR-025、T090）', () => {
  it('作者改簡介後，公開作品詳情頁的作者簡介區塊隨之更新', async () => {
    await callAction('updateProfileAction', [{ bio: '我在作品詳情頁看得到的簡介。' }], {
      ip: IP,
      cookie,
      route: ROUTE,
    });

    expect(await novelDetailHtml()).toContain('我在作品詳情頁看得到的簡介。');

    await callAction('updateProfileAction', [{ bio: '換過一次的簡介。' }], {
      ip: IP,
      cookie,
      route: ROUTE,
    });

    const html = await novelDetailHtml();
    expect(html).toContain('換過一次的簡介。');
    expect(html).not.toContain('我在作品詳情頁看得到的簡介。');
  });
});

/**
 * FR-007：拒絕 MUST 發生在 **Action 自己**，不是靠 `proxy.ts` 的 matcher。
 *
 * **不帶 Cookie 證明不了這件事**：`/profile/*` 在 matcher 內，proxy 會先回 302，
 * Action 根本不會被呼叫，而 302 裡沒有任何錯誤碼可驗（同 T018a 的結論）。
 * 故製造「proxy 放行、Action 必須自己擋」的狀態：proxy 只驗 JWT 簽章，
 * Action 覆核 `Session` 資料列 —— 撤銷資料列後兩者的判斷就分岔了。
 */
describe('未登入不得更新個資（FR-007，拒絕發生於 Action 而非攔截層）', () => {
  it('工作階段已撤銷（JWT 仍有效）→ UNAUTHENTICATED 且非 302，資料未變更', async () => {
    const scopedCookie = await loginAs(author.email, author.password, '10.70.1.2');
    await prisma.session.updateMany({
      where: { userId: author.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    const before = await userRow();
    const res = await callAction('updateProfileAction', [{ name: '不該被寫入' }], {
      ip: '10.70.1.2',
      cookie: scopedCookie,
      route: ROUTE,
    });

    expect(res.status, '收到 302 代表擋下它的是 proxy，這一則就沒驗到 Action').not.toBe(302);
    expect(hasErrorCode(res, 'UNAUTHENTICATED'), res.text.slice(0, 300)).toBe(true);
    expect(await userRow()).toEqual(before);

    // 後續案例若還要用，得重新登入 —— 本檔的斷言到此為止，故不補
  });
});
