/**
 * 重設憑證的失效規則（FEAT-5 T020，SC-003／SC-005／FR-008～FR-011a）
 * ================================================================
 * 四件事：
 *   1. 用過一次的憑證再用一次 → `INVALID_TOKEN`（FR-009）
 *   2. 逾期的憑證 → `EXPIRED_TOKEN`（FR-008）
 *   3. 連續申請兩次後**第一封失效**（FR-010／SC-005：一個帳號同時只有一把有效鑰匙）
 *   4. **FR-011a**：已使用（或已逾期）的憑證於該使用者**下一次申請時被順帶刪除** ——
 *      申請後該使用者的憑證列數為 **1**，舊的是**被刪掉**而不是留著標記為已作廢
 *
 * **兩個錯誤碼而非一個**（FR-015）：`INVALID_TOKEN` 與 `EXPIRED_TOKEN` 在畫面上是
 * 不同的說明訊息。合成一個碼，使用者只會拿到一句含糊的話。
 *
 * **第 3 與第 4 條刻意用不同帳號**：第 3 條的第一把憑證在第二次申請時**仍然有效**
 * （尚未使用、尚未逾期），依 contracts §1.3 的順序它是在交易內被**作廢**、不是被刪除，
 * 該使用者此時有 2 列。第 4 條要驗的是「已失效的那一列會被清掉」，
 * 前提是申請之前就已經有一列處於已使用／已逾期狀態。
 *
 * 本檔專屬位址前綴：`10.113.*`
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '@/lib/db';
import { testFetch } from '../helpers/client';
import { createUser } from '../helpers/fixtures';
import { resetAuthTables } from '../helpers/resetAuthTables';
import { clearOutbox, waitForMail, extractResetToken } from '../helpers/outbox';

const REUSED = 'feat5-rules-reused@example.com';
const EXPIRED = 'feat5-rules-expired@example.com';
const TWICE = 'feat5-rules-twice@example.com';
const PASSWORD = 'RulesPass123';

const userIds: Record<string, string> = {};

function requestReset(email: string, ip: string) {
  return testFetch('/api/auth/password-reset/request', {
    method: 'POST',
    ip,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
}

function confirmReset(token: string, password: string, ip: string) {
  return testFetch('/api/auth/password-reset/confirm', {
    method: 'POST',
    ip,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password }),
  });
}

/** 申請一次並取回該封信中的憑證明碼 */
async function requestAndGetToken(email: string, ip: string, previous?: string): Promise<string> {
  const res = await requestReset(email, ip);
  expect(res.status).toBe(200);
  const mail = await waitForMail(
    (entry) =>
      entry.to.toLowerCase() === email &&
      (previous === undefined || extractResetToken(entry.text) !== previous)
  );
  return extractResetToken(mail.text);
}

beforeAll(async () => {
  await resetAuthTables();
  await clearOutbox();
  for (const email of [REUSED, EXPIRED, TWICE]) {
    const user = await createUser({ email, role: 'reader', password: PASSWORD });
    userIds[email] = user.id;
  }
});

/** 第 1 節用掉的那把憑證；第 4 節要靠它辨認「新的那一封」才不會在寄達之前就斷言列數 */
let reusedToken: string;

describe('1. 單次可用（FR-009／SC-003）', () => {
  it('同一把憑證第二次使用回 400 INVALID_TOKEN', async () => {
    const token = await requestAndGetToken(REUSED, '10.113.1.1');
    reusedToken = token;

    const first = await confirmReset(token, 'RulesNew456', '10.113.1.2');
    expect(first.status).toBe(200);

    const second = await confirmReset(token, 'RulesNew789', '10.113.1.3');
    expect(second.status).toBe(400);
    expect((await second.json()).error.code).toBe('INVALID_TOKEN');
  });
});

describe('2. 逾期即不可用（FR-008）', () => {
  it('逾期的憑證回 400 EXPIRED_TOKEN（與已使用是不同的碼，FR-015）', async () => {
    const token = await requestAndGetToken(EXPIRED, '10.113.2.1');

    // 直接把該列的 expiresAt 推到過去 —— 有效期預設 30 分鐘，等真的過期不會是一個被執行的測試
    await prisma.passwordResetToken.updateMany({
      where: { userId: userIds[EXPIRED] },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await confirmReset(token, 'RulesNew456', '10.113.2.2');
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('EXPIRED_TOKEN');
  });
});

describe('3. 一個帳號同時只有一把有效鑰匙（FR-010／SC-005）', () => {
  it('連續申請兩次後，第一封的連結已失效、第二封可用', async () => {
    const first = await requestAndGetToken(TWICE, '10.113.3.1');
    const second = await requestAndGetToken(TWICE, '10.113.3.2', first);
    expect(second).not.toBe(first);

    const staleRes = await confirmReset(first, 'RulesNew456', '10.113.3.3');
    expect(staleRes.status).toBe(400);
    expect((await staleRes.json()).error.code).toBe('INVALID_TOKEN');

    const freshRes = await confirmReset(second, 'RulesNew789', '10.113.3.4');
    expect(freshRes.status).toBe(200);
  });
});

describe('4. 已失效的憑證於下次申請時順帶刪除（FR-011a）', () => {
  it('已使用過憑證的使用者再申請一次後，其憑證列數為 1', async () => {
    // REUSED 這個帳號在第 1 節已用掉一把憑證（該列 consumedAt 非空）。
    // 再申請一次之後，若舊列只是「留著標記為已作廢」，列數會是 2。
    const before = await prisma.passwordResetToken.count({ where: { userId: userIds[REUSED] } });
    expect(before).toBe(1);

    // MUST 傳入舊憑證：`waitForMail` 只認第一封符合條件的信，不排除舊的那一封時
    // 它會立刻命中而讓下方的列數斷言跑在 `after()` 之前（回應早於寄送，FR-006a）
    await requestAndGetToken(REUSED, '10.113.4.1', reusedToken);

    expect(await prisma.passwordResetToken.count({ where: { userId: userIds[REUSED] } })).toBe(1);
    expect(
      await prisma.passwordResetToken.count({
        where: { userId: userIds[REUSED], consumedAt: null },
      })
    ).toBe(1);
  });
});
