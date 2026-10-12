import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { loginAs } from '../helpers/client';
import { callAction, hasErrorCode } from '../helpers/serverAction';
import {
  createAuthor,
  anyCategoryId,
  cleanupAuthoring,
  type TestAuthor,
} from '../helpers/authoring';

/**
 * FR-008／US1 AC11：Server Action 的跨站請求由框架比對 `Origin`／`Host` 擋下。
 *
 * **斷言的形狀來自 T005 的文件查證**：Next 16 的文件只寫「the request will be aborted」，
 * **未載明狀態碼**。故本檔 MUST 斷言「非 2xx + 資料未變更」，
 * MUST NOT 寫死 403 —— 寫死一個文件沒保證的數字，等於把測試綁在某一版的實作細節上。
 *
 * 同源對照組是本檔的關鍵：只驗「跨站請求非 2xx」會被任何錯誤矇混過去
 * （例如請求根本沒送到 Action）。同源的同一組引數必須真的走到 Action、
 * 真的把作品建出來，才能證明造成差異的變數確實是 `Origin`。
 *
 * 受測對象為 `createNovelAction` —— CSRF 的判定發生在框架派送 Action 之前，
 * 與是哪一個 Action 無關；而目前只有它被 client 元件引用、因而有端點可打
 * （見 author-role-guard.test.ts 的說明）。
 */

const IP = '10.63.1.1';
const EVIL_ORIGIN = 'https://evil.example.com';

let author: TestAuthor;
let cookie: string;
let categoryId: string;

async function novelCount(): Promise<number> {
  return prisma.novel.count({ where: { authorId: author.id } });
}

beforeAll(async () => {
  await cleanupAuthoring();
  author = await createAuthor('origin');
  cookie = await loginAs(author.email, author.password, IP);
  categoryId = await anyCategoryId();
});

afterAll(async () => {
  await cleanupAuthoring();
});

function createArgs(title: string) {
  return [{ title, categoryId, excerpt: '跨站測試用的簡介。' }];
}

describe('Server Action 的跨站 Origin（FR-008、US1 AC11）', () => {
  it('跨站 Origin：有效的寫入請求非 2xx，且作品未被建立', async () => {
    const before = await novelCount();

    const res = await callAction('createNovelAction', createArgs('跨站建立的作品'), {
      ip: IP,
      cookie,
      origin: EVIL_ORIGIN,
    });

    const is2xx = res.status >= 200 && res.status < 300;
    expect(is2xx, `跨站請求竟得到 2xx（${res.status}）：${res.text.slice(0, 300)}`).toBe(false);
    expect(await novelCount()).toBe(before);
  });

  it('同源對照組：同一組引數確實走到 Action 並成功寫入（證明差異來自 Origin）', async () => {
    const before = await novelCount();

    const res = await callAction('createNovelAction', createArgs('同源建立的作品'), {
      ip: IP,
      cookie,
    });

    // 成功時 Action 以 redirect() 收尾，回應形式與錯誤不同，故此處以 DB 為準
    expect(hasErrorCode(res, 'UNAUTHENTICATED')).toBe(false);
    expect(hasErrorCode(res, 'FORBIDDEN')).toBe(false);
    expect(await novelCount()).toBe(before + 1);
  });

  it('缺少 Origin 標頭的跨站請求同樣非 2xx，且未寫入', async () => {
    const before = await novelCount();

    const res = await callAction('createNovelAction', createArgs('無 Origin 的作品'), {
      ip: IP,
      cookie,
      origin: 'http://localhost:1',
    });

    const is2xx = res.status >= 200 && res.status < 300;
    expect(is2xx).toBe(false);
    expect(await novelCount()).toBe(before);
  });
});
