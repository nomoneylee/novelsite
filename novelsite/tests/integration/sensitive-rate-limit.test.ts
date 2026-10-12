import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '@/lib/db';
import { loginAs } from '../helpers/client';
import { callAction, hasErrorCode, type ActionResponse } from '../helpers/serverAction';
import { createUser } from '../helpers/fixtures';
import { resetAuthTables } from '../helpers/resetAuthTables';
import { env } from '@/lib/env';

/**
 * FR-024a：改密碼與開通作者兩個入口以**使用者識別碼**為鍵限流。
 *
 * 「舊密碼的驗證不得成為可無限猜測的密碼預言機」是這條需求的真正理由 ——
 * 持有有效工作階段的人（例如借用了沒鎖螢幕的電腦）本來就通過了身分檢查，
 * 擋住他的只剩下這個計數器。
 *
 * 故本檔的改密碼案例一律以**錯誤的舊密碼**送出：正確密碼會成功並撤銷工作階段，
 * 之後的每一次呼叫都會變成 `UNAUTHENTICATED`，就再也測不到限流了。
 * 這同時證明了**限流早於密碼驗證**（錯誤的舊密碼一樣消耗額度）。
 *
 * 每個案例用**獨立帳號**：限流鍵是使用者識別碼，共用帳號會讓前一個案例的計數
 * 洩漏到下一個，而症狀是「單獨跑會過、一起跑會紅」。
 */

const ROUTE = '/profile/settings';
const PASSWORD = 'Sensitive1234';

interface Actor {
  id: string;
  cookie: string;
  ip: string;
}

let ipSeq = 0;

async function newActor(label: string, role: 'reader' | 'author' = 'reader'): Promise<Actor> {
  ipSeq += 1;
  const ip = `10.73.1.${ipSeq}`;
  const email = `rate-limit-${label}@example.com`;
  const user = await createUser({ email, role, password: PASSWORD });
  return { id: user.id, cookie: await loginAs(email, PASSWORD, ip), ip };
}

function hasRetryAfter(res: ActionResponse): boolean {
  return /"retryAfterSeconds":\s*\d+/.test(res.text);
}

beforeAll(async () => {
  await resetAuthTables();
});

describe('改密碼：超過 PASSWORD_CHANGE_RATE_MAX 後回 RATE_LIMITED（FR-024a）', () => {
  it(`第 ${env.PASSWORD_CHANGE_RATE_MAX} 次以內為認證失敗，第 ${env.PASSWORD_CHANGE_RATE_MAX + 1} 次起為限流`, async () => {
    const actor = await newActor('pwchg');
    const args = [{ currentPassword: 'WrongPass999', newPassword: 'BrandNew1234' }];

    for (let i = 1; i <= env.PASSWORD_CHANGE_RATE_MAX; i++) {
      const res = await callAction('changePasswordAction', args, {
        ip: actor.ip,
        cookie: actor.cookie,
        route: ROUTE,
      });
      expect(hasErrorCode(res, 'RATE_LIMITED'), `第 ${i} 次不該被限流`).toBe(false);
      expect(hasErrorCode(res, 'UNAUTHENTICATED'), `第 ${i} 次應為舊密碼錯誤`).toBe(true);
    }

    const limited = await callAction('changePasswordAction', args, {
      ip: actor.ip,
      cookie: actor.cookie,
      route: ROUTE,
    });
    expect(hasErrorCode(limited, 'RATE_LIMITED')).toBe(true);
    expect(hasRetryAfter(limited)).toBe(true);
  });

  it('限流後即使送出**正確**的舊密碼也不放行（否則計數器等於沒用）', async () => {
    const actor = await newActor('pwchg-correct');

    for (let i = 0; i <= env.PASSWORD_CHANGE_RATE_MAX; i++) {
      await callAction(
        'changePasswordAction',
        [{ currentPassword: 'WrongPass999', newPassword: 'BrandNew1234' }],
        { ip: actor.ip, cookie: actor.cookie, route: ROUTE }
      );
    }

    const res = await callAction(
      'changePasswordAction',
      [{ currentPassword: PASSWORD, newPassword: 'BrandNew1234' }],
      { ip: actor.ip, cookie: actor.cookie, route: ROUTE }
    );

    expect(hasErrorCode(res, 'RATE_LIMITED')).toBe(true);
    // 密碼確實沒被改：工作階段未被撤銷（改密碼成功會撤銷全部）
    expect(await prisma.session.count({ where: { userId: actor.id, revokedAt: null } })).toBe(1);
  });
});

describe('開通作者：超過 AUTHOR_UPGRADE_RATE_MAX 後回 RATE_LIMITED（FR-024a）', () => {
  it(`第 ${env.AUTHOR_UPGRADE_RATE_MAX + 1} 次起為限流，且角色始終未變`, async () => {
    const actor = await newActor('upgrade');
    // 空筆名會被 Zod 擋下；限流早於 Zod，故每一次仍消耗額度
    const args = [{ penName: '   ' }];

    for (let i = 1; i <= env.AUTHOR_UPGRADE_RATE_MAX; i++) {
      const res = await callAction('becomeAuthorAction', args, {
        ip: actor.ip,
        cookie: actor.cookie,
        route: ROUTE,
      });
      expect(hasErrorCode(res, 'RATE_LIMITED'), `第 ${i} 次不該被限流`).toBe(false);
      expect(hasErrorCode(res, 'VALIDATION_ERROR'), `第 ${i} 次應為欄位驗證失敗`).toBe(true);
    }

    const limited = await callAction('becomeAuthorAction', args, {
      ip: actor.ip,
      cookie: actor.cookie,
      route: ROUTE,
    });
    expect(hasErrorCode(limited, 'RATE_LIMITED')).toBe(true);
    expect(hasRetryAfter(limited)).toBe(true);

    const row = await prisma.user.findUniqueOrThrow({
      where: { id: actor.id },
      select: { role: true },
    });
    expect(row.role).toBe('reader');
  });
});

describe('限流鍵為使用者識別碼，帳號之間互不影響（FR-024a）', () => {
  it('一個帳號被限流時，另一個帳號的同一操作照常可用', async () => {
    const blocked = await newActor('isolation-a');
    const other = await newActor('isolation-b');

    for (let i = 0; i <= env.PASSWORD_CHANGE_RATE_MAX; i++) {
      await callAction(
        'changePasswordAction',
        [{ currentPassword: 'WrongPass999', newPassword: 'BrandNew1234' }],
        { ip: blocked.ip, cookie: blocked.cookie, route: ROUTE }
      );
    }
    const blockedRes = await callAction(
      'changePasswordAction',
      [{ currentPassword: 'WrongPass999', newPassword: 'BrandNew1234' }],
      { ip: blocked.ip, cookie: blocked.cookie, route: ROUTE }
    );
    expect(hasErrorCode(blockedRes, 'RATE_LIMITED')).toBe(true);

    const otherRes = await callAction(
      'changePasswordAction',
      [{ currentPassword: 'WrongPass999', newPassword: 'BrandNew1234' }],
      { ip: other.ip, cookie: other.cookie, route: ROUTE }
    );
    expect(hasErrorCode(otherRes, 'RATE_LIMITED')).toBe(false);
    expect(hasErrorCode(otherRes, 'UNAUTHENTICATED')).toBe(true);
  });

  it('改密碼與開通作者是兩個獨立的額度（同一使用者用完其一不影響其二）', async () => {
    const actor = await newActor('separate-buckets');

    for (let i = 0; i <= env.PASSWORD_CHANGE_RATE_MAX; i++) {
      await callAction(
        'changePasswordAction',
        [{ currentPassword: 'WrongPass999', newPassword: 'BrandNew1234' }],
        { ip: actor.ip, cookie: actor.cookie, route: ROUTE }
      );
    }

    const upgrade = await callAction('becomeAuthorAction', [{ penName: '額度互不干擾' }], {
      ip: actor.ip,
      cookie: actor.cookie,
      route: ROUTE,
    });
    expect(hasErrorCode(upgrade, 'RATE_LIMITED')).toBe(false);
  });
});
