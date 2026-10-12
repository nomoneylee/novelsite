/**
 * 聯絡表單送得出訊息（FEAT-5 T045，SC-006／FR-019）
 * ===============================================
 * 這一檔驗的是「訊息真的到得了營運者」，而其中最容易寫錯、寫錯了畫面上也看不出來的一件事是
 * **收件人**：表單填入的 Email 只是**回覆位址**（`replyTo`），
 * 系統 MUST NOT 主動寄任何郵件給它（FR-019）——
 * 否則任何人都能以本站為跳板，往任意信箱送出一封由本站寄出的信，**站台即成為 spam 放大器**。
 *
 * 寄送是**同步的**（與密碼重設刻意相反，contracts/contact-api §1.3）：
 * 這裡沒有帳號存在性可洩漏，使用者必須知道訊息到底出去了沒有。
 * 故 200 到手時信已寄完 —— `waitForMail` 在此只是為了不與 `MAIL_MEMORY_DELAY_MS` 賽跑。
 *
 * 本檔專屬位址前綴：`10.119.*`
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { env } from '@/lib/env';
import { testFetch } from '../helpers/client';
import { clearOutbox, waitForMail, type OutboxEntry } from '../helpers/outbox';

/** 表單填入的 Email：**只作回覆位址**，MUST NOT 成為收件人 */
const FORM_EMAIL = 'feat5-contact-sender@example.com';
const FORM_NAME = '王小明';
const FORM_MESSAGE = '我想詢問關於平台合作的細節，方便的話請回覆我。';

let response: Response;
let mail: OutboxEntry;

beforeAll(async () => {
  await clearOutbox();

  response = await testFetch('/api/contact', {
    method: 'POST',
    ip: '10.119.1.1',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: FORM_NAME,
      email: FORM_EMAIL,
      message: FORM_MESSAGE,
      website: '',
    }),
  });

  mail = await waitForMail((entry) => entry.replyTo === FORM_EMAIL);
});

describe('POST /api/contact 送出成功（SC-006）', () => {
  it('回 200', () => {
    expect(response.status).toBe(200);
  });

  it('outbox 收到含稱呼／回覆 Email／訊息本文三段的信', () => {
    expect(mail.text).toContain(FORM_NAME);
    expect(mail.text).toContain(FORM_EMAIL);
    expect(mail.text).toContain(FORM_MESSAGE);
  });

  it('主旨指出來自聯絡表單與送出者稱呼（營運者的收件匣裡要一眼分得出來）', () => {
    expect(mail.subject).toContain('聯絡表單');
    expect(mail.subject).toContain(FORM_NAME);
  });

  /**
   * FR-019 的兩半，**這一則是本檔存在的主要理由**：
   * 收件人是營運信箱、表單 Email 只出現在 `replyTo`。
   * 兩者對調的實作在畫面上完全看不出來 —— 送出者照樣看到「已送出」，
   * 而營運者只是「沒收到信」，看起來像寄送壞了。
   */
  it('收件人是 CONTACT_EMAIL，不是表單填入的 Email（站台 MUST NOT 成為 spam 放大器）', () => {
    expect(mail.to).toBe(env.CONTACT_EMAIL);
    expect(mail.to).not.toBe(FORM_EMAIL);
  });

  it('replyTo 是表單填入的 Email（營運者按「回覆」就回得到人）', () => {
    expect(mail.replyTo).toBe(FORM_EMAIL);
  });
});
