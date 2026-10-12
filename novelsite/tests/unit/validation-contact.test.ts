/**
 * 聯絡表單的欄位規則與 honeypot（FEAT-5 T044，contracts/contact-api.md §1.2／§1.4）
 * ==============================================================================
 * 這支表單是站上**唯一未登入即可觸發對外寄送**的入口，故它的驗證同時是濫用防護的第一道。
 * 三個欄位的邊界值 ＋ honeypot 非空即失敗。
 *
 * **上限一律以 `MAX_LENGTH` 表達，測試內不寫字面量**（沿用 `validation-profile.test.ts`
 * 與 `validation/common.ts` 檔頭的既有規定）：寫死 50 而實作改成 60 時，
 * 測試會繼續通過並掩蓋漂移。故 `contact.ts` 的兩個上限 MUST 落在 `MAX_LENGTH`
 * （`contactName`／`contactMessage`），MUST NOT 於 schema 內重複字面量。
 *
 * 訊息**下限**刻意留為字面量並連同錯誤訊息一起斷言：那個數字本身就寫在給使用者看的
 * 訊息裡（「至少需要 10 個字」），兩者一起改才不會出現「擋在 10 字、卻寫著 20 字」。
 */
import { describe, it, expect } from 'vitest';
import { contactSchema } from '@/lib/validation/contact';
import { MAX_LENGTH } from '@/lib/validation/common';

const exactly = (limit: number) => '字'.repeat(limit);
const overBy = (limit: number) => '字'.repeat(limit + 1);

/** 一組全合法的輸入，供「只改一個欄位」使用 */
function validInput(overrides: Record<string, unknown> = {}) {
  return {
    name: '王小明',
    email: 'someone@example.com',
    message: '我想詢問關於平台合作的細節，方便的話請回覆我。',
    website: '',
    ...overrides,
  };
}

describe('contactSchema：合法輸入', () => {
  it('三個欄位齊備且 honeypot 為空字串時通過', () => {
    expect(contactSchema.safeParse(validInput()).success).toBe(true);
  });

  it('honeypot 欄位缺席亦合法（表單未渲染該欄位的舊快取仍應能送出）', () => {
    const { name, email, message } = validInput();
    expect(contactSchema.safeParse({ name, email, message }).success).toBe(true);
  });
});

describe('contactSchema：稱呼（非空、≤ MAX_LENGTH.contactName）', () => {
  it('空字串與純空白皆失敗，訊息為「請輸入稱呼」', () => {
    for (const name of ['', '   ']) {
      const parsed = contactSchema.safeParse(validInput({ name }));
      expect(parsed.success).toBe(false);
      expect(parsed.success === false && parsed.error.issues[0].message).toBe('請輸入稱呼');
    }
  });

  it('恰好等於上限通過、超過一個字失敗', () => {
    expect(
      contactSchema.safeParse(validInput({ name: exactly(MAX_LENGTH.contactName) })).success
    ).toBe(true);
    expect(
      contactSchema.safeParse(validInput({ name: overBy(MAX_LENGTH.contactName) })).success
    ).toBe(false);
  });

  it('長度以 trim 後計算（前後空白不佔額度）', () => {
    const padded = `  ${exactly(MAX_LENGTH.contactName)}  `;
    expect(contactSchema.safeParse(validInput({ name: padded })).success).toBe(true);
  });
});

describe('contactSchema：Email（回覆位址，非空且須為 Email 形式）', () => {
  it('空字串失敗，訊息為「請輸入 Email」', () => {
    const parsed = contactSchema.safeParse(validInput({ email: '' }));
    expect(parsed.success).toBe(false);
    expect(parsed.success === false && parsed.error.issues[0].message).toBe('請輸入 Email');
  });

  /**
   * 這個欄位只作 `replyTo`（FR-019），**不是身分依據**，
   * 但格式仍 MUST 驗：一個填不回去的位址等於營運者讀了訊息卻回不了信。
   */
  it('非 Email 形式失敗，訊息為「Email 格式不正確」', () => {
    const parsed = contactSchema.safeParse(validInput({ email: 'not-an-email' }));
    expect(parsed.success).toBe(false);
    expect(parsed.success === false && parsed.error.issues[0].message).toBe('Email 格式不正確');
  });
});

describe('contactSchema：訊息內容（10 ～ MAX_LENGTH.contactMessage）', () => {
  it('恰好 10 個字通過、9 個字失敗且訊息指名下限', () => {
    expect(contactSchema.safeParse(validInput({ message: exactly(10) })).success).toBe(true);

    const parsed = contactSchema.safeParse(validInput({ message: exactly(9) }));
    expect(parsed.success).toBe(false);
    expect(parsed.success === false && parsed.error.issues[0].message).toBe(
      '訊息內容至少需要 10 個字'
    );
  });

  it('恰好等於上限通過、超過一個字失敗且訊息指名上限', () => {
    expect(
      contactSchema.safeParse(validInput({ message: exactly(MAX_LENGTH.contactMessage) })).success
    ).toBe(true);

    const parsed = contactSchema.safeParse(
      validInput({ message: overBy(MAX_LENGTH.contactMessage) })
    );
    expect(parsed.success).toBe(false);
    expect(parsed.success === false && parsed.error.issues[0].message).toBe(
      `訊息內容不可超過 ${MAX_LENGTH.contactMessage} 字`
    );
  });

  it('純空白視同未填（長度以 trim 後計算）', () => {
    expect(contactSchema.safeParse(validInput({ message: '            ' })).success).toBe(false);
  });
});

/**
 * honeypot（contracts §1.4）
 * =========================
 * 該欄位對人不可見、不會被鍵盤走訪、不會被自動填入 —— **只有機器人會填它**。
 * 命中時 MUST 失敗（Route Handler 據此回 400），
 * **MUST NOT 回假成功的 200**：那是站上明文禁止的假成功（FR-020、`feat4-scan` 甲-3），
 * 且會留下一個「回報成功但什麼也沒做」的分支，往後每個讀到它的人都得重新判斷那是不是 bug。
 */
describe('contactSchema：honeypot 欄位 website', () => {
  it('非空即失敗', () => {
    for (const website of ['http://spam.example', 'x', ' ']) {
      expect(
        contactSchema.safeParse(validInput({ website })).success,
        `website="${website}" 通過了驗證 —— honeypot 等於不存在`
      ).toBe(false);
    }
  });
});
