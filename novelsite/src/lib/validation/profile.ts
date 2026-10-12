import { z } from 'zod';
import { MAX_LENGTH } from './common';

/**
 * 個人設定的驗證規則（FR-006a、FR-021、FR-023、data-model.md §5、§7）
 * ====================================================================
 * client / server 共用同一份定義。
 *
 * **三個欄位的「空」代表三件不同的事**，故 MUST NOT 共用同一條規則：
 *   - 暱稱：空 = 非法。它是公開顯示名的最後遞補值，沒有它就沒有名字可顯示。
 *   - 筆名：空 = 合法，語意是「清空，改用暱稱」（更新個資時）；
 *           但**開通作者時必填**——那一步的目的就是取一個對外的名字。
 *   - 簡介：空 = 合法，語意是「不寫」。要求非空等於強迫每個人寫自我介紹。
 */

/**
 * 頭像色票組。
 *
 * 與 `validation/novel.ts` 的 `COVER_COLORS` 同一個理由：這個值會被原樣塞進
 * `style` 屬性，開放任意字串等於在每一個顯示頭像的地方開一個使用者可控的 CSS 注入點。
 * 值取自既有示範資料的既定風格，非新設計。
 */
export const AVATAR_COLORS = [
  'linear-gradient(135deg, #d97706 0%, #92400e 100%)',
  'linear-gradient(135deg, #7c3aed 0%, #4c1d95 100%)',
  'linear-gradient(135deg, #0f766e 0%, #134e4a 100%)',
  'linear-gradient(135deg, #be123c 0%, #7f1d1d 100%)',
  'linear-gradient(135deg, #1d4ed8 0%, #1e3a8a 100%)',
  'linear-gradient(135deg, #4d7c0f 0%, #1a2e05 100%)',
  'linear-gradient(135deg, #b45309 0%, #431407 100%)',
  'linear-gradient(135deg, #475569 0%, #0f172a 100%)',
] as const;

const avatarColorField = z
  .string()
  .refine((v) => (AVATAR_COLORS as readonly string[]).includes(v), {
    message: '請自既有色票組選擇頭像色',
  });

const nameField = z
  .string()
  .trim()
  .min(1, '請輸入暱稱')
  .max(MAX_LENGTH.userName, `暱稱不得超過 ${MAX_LENGTH.userName} 個字`);

/** 更新個資用：可為空字串（清空筆名，公開顯示名遞補為暱稱） */
const optionalPenNameField = z
  .string()
  .trim()
  .max(MAX_LENGTH.penName, `筆名不得超過 ${MAX_LENGTH.penName} 個字`);

/** 開通作者用：必填且非空 */
const requiredPenNameField = optionalPenNameField.min(1, '請輸入筆名');

const bioField = z
  .string()
  .trim()
  .max(MAX_LENGTH.userBio, `個人簡介不得超過 ${MAX_LENGTH.userBio} 個字`);

/** 各欄位皆選填 —— 只改其中一項是常態，要求整份送出會讓漏帶的欄位被清空 */
export const updateProfileSchema = z.object({
  name: nameField.optional(),
  penName: optionalPenNameField.optional(),
  bio: bioField.optional(),
  avatarColor: avatarColorField.optional(),
});

/**
 * 改密碼。新密碼的強度規則沿用註冊時那一份（`validation/auth.ts`），
 * 但**舊密碼只驗非空**——它的規則是當年訂的，拿今天的標準去驗只會擋住合法的使用者。
 */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, '請輸入目前密碼'),
  newPassword: z
    .string()
    .min(8, '密碼至少需要 8 個字元')
    .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), {
      message: '密碼須同時包含英文字母與數字',
    }),
});

export const becomeAuthorSchema = z.object({
  penName: requiredPenNameField,
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type BecomeAuthorInput = z.infer<typeof becomeAuthorSchema>;
