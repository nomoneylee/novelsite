import { describe, it, expect } from 'vitest';
import {
  updateProfileSchema,
  changePasswordSchema,
  becomeAuthorSchema,
  AVATAR_COLORS,
} from '@/lib/validation/profile';
import { MAX_LENGTH } from '@/lib/validation/common';

/**
 * 個人設定的欄位規則（FR-006a、FR-021、FR-023、data-model.md §5、§7）。
 *
 * 這一組的重點在**三個欄位的「空」各代表不同的意思**：
 *   - 暱稱：空 = 非法（公開顯示名的最後遞補值，不能沒有）
 *   - 筆名：空 = 合法，且語意是「清空，改用暱稱」
 *   - 簡介：空 = 合法，語意是「不寫」
 * 三者若共用同一條規則，其中一個必然被寫錯，而錯的那一個會以
 * 「使用者清不掉自己的筆名」或「不填簡介就存不了檔」的形式出現。
 *
 * 上限一律以 `MAX_LENGTH` 表達，測試內不寫字面量 —— 寫死 50 而實作改成 60 時，
 * 測試會繼續通過並掩蓋漂移。
 */

const overBy = (limit: number) => '字'.repeat(limit + 1);
const exactly = (limit: number) => '字'.repeat(limit);

describe('updateProfileSchema：暱稱（非空、≤50）', () => {
  it('正常暱稱通過', () => {
    expect(updateProfileSchema.safeParse({ name: '讀墨旅人' }).success).toBe(true);
  });

  it('恰好等於上限通過、超過一個字失敗', () => {
    expect(updateProfileSchema.safeParse({ name: exactly(MAX_LENGTH.userName) }).success).toBe(
      true
    );
    expect(updateProfileSchema.safeParse({ name: overBy(MAX_LENGTH.userName) }).success).toBe(
      false
    );
  });

  it('空字串與純空白皆失敗（暱稱是公開顯示名的最後遞補值）', () => {
    expect(updateProfileSchema.safeParse({ name: '' }).success).toBe(false);
    expect(updateProfileSchema.safeParse({ name: '   ' }).success).toBe(false);
  });

  it('長度以 trim 後計算（前後空白不佔額度）', () => {
    const padded = `  ${exactly(MAX_LENGTH.userName)}  `;
    expect(updateProfileSchema.safeParse({ name: padded }).success).toBe(true);
  });

  it('未帶 name 亦合法（各欄位皆選填，只改其中一項是常態）', () => {
    expect(updateProfileSchema.safeParse({}).success).toBe(true);
  });
});

describe('updateProfileSchema：筆名（≤50、更新個資時選填且可清空）', () => {
  it('正常筆名通過', () => {
    expect(updateProfileSchema.safeParse({ penName: '墨衍' }).success).toBe(true);
  });

  it('**空字串合法** —— 清空筆名後公開顯示名遞補為暱稱（FR-006a）', () => {
    const parsed = updateProfileSchema.safeParse({ penName: '' });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.penName).toBe('');
  });

  it('恰好等於上限通過、超過一個字失敗', () => {
    expect(updateProfileSchema.safeParse({ penName: exactly(MAX_LENGTH.penName) }).success).toBe(
      true
    );
    expect(updateProfileSchema.safeParse({ penName: overBy(MAX_LENGTH.penName) }).success).toBe(
      false
    );
  });
});

describe('updateProfileSchema：使用者簡介（≤500、選填、空字串合法）', () => {
  it('**空字串合法**：只想清掉簡介、其餘欄位照存（US3 AC1）', () => {
    expect(updateProfileSchema.safeParse({ name: '讀墨旅人', bio: '' }).success).toBe(true);
  });

  it('恰好等於上限通過、超過一個字失敗', () => {
    expect(updateProfileSchema.safeParse({ bio: exactly(MAX_LENGTH.userBio) }).success).toBe(true);
    expect(updateProfileSchema.safeParse({ bio: overBy(MAX_LENGTH.userBio) }).success).toBe(false);
  });
});

describe('updateProfileSchema：頭像色只接受既有色票（避免 style 屬性的注入點）', () => {
  it('色票組內的值通過', () => {
    expect(updateProfileSchema.safeParse({ avatarColor: AVATAR_COLORS[0] }).success).toBe(true);
  });

  it('任意字串失敗 —— 該值會被原樣塞進 style 屬性', () => {
    expect(
      updateProfileSchema.safeParse({ avatarColor: 'red; background-image: url(//evil)' }).success
    ).toBe(false);
    expect(updateProfileSchema.safeParse({ avatarColor: '#ff0000' }).success).toBe(false);
  });
});

describe('becomeAuthorSchema：開通作者時筆名必填且非空（FR-023）', () => {
  it('正常筆名通過', () => {
    expect(becomeAuthorSchema.safeParse({ penName: '墨衍' }).success).toBe(true);
  });

  it('空字串、純空白、缺席皆失敗 —— 與「更新個資時可清空」刻意不同', () => {
    expect(becomeAuthorSchema.safeParse({ penName: '' }).success).toBe(false);
    expect(becomeAuthorSchema.safeParse({ penName: '   ' }).success).toBe(false);
    expect(becomeAuthorSchema.safeParse({}).success).toBe(false);
  });

  it('同樣受 50 字上限約束', () => {
    expect(becomeAuthorSchema.safeParse({ penName: exactly(MAX_LENGTH.penName) }).success).toBe(
      true
    );
    expect(becomeAuthorSchema.safeParse({ penName: overBy(MAX_LENGTH.penName) }).success).toBe(
      false
    );
  });
});

describe('changePasswordSchema：新密碼沿用註冊時的強度規則', () => {
  it('合法輸入通過', () => {
    expect(
      changePasswordSchema.safeParse({ currentPassword: 'OldPass123', newPassword: 'NewPass456' })
        .success
    ).toBe(true);
  });

  it('目前密碼不得為空（但不驗強度 —— 舊密碼的規則是當年訂的）', () => {
    expect(
      changePasswordSchema.safeParse({ currentPassword: '', newPassword: 'NewPass456' }).success
    ).toBe(false);
    expect(
      changePasswordSchema.safeParse({ currentPassword: 'x', newPassword: 'NewPass456' }).success
    ).toBe(true);
  });

  it('新密碼過短或缺數字／字母皆失敗', () => {
    for (const newPassword of ['Ab1', 'abcdefgh', '12345678']) {
      expect(
        changePasswordSchema.safeParse({ currentPassword: 'OldPass123', newPassword }).success
      ).toBe(false);
    }
  });
});
