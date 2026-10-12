import { z } from 'zod';
import { MAX_LENGTH } from './common';

/**
 * 聯絡表單的欄位規則（FEAT-5 T048，contracts/contact-api.md §1.2／§1.4）
 * ====================================================================
 * client / server 共用同一份定義（比照 `auth.ts`／`profile.ts`）。
 *
 * 這是站上**唯一未登入即可觸發對外寄送**的入口，故本檔同時是濫用防護的第一道：
 * 三個欄位的規則之外還有一個對人不可見的 honeypot。
 */

/** 訊息本文的下限。**寫成具名常數是因為文案裡也有這個數字** —— 兩處一起改才不會出現「擋在 10 字、卻寫著 20 字」 */
const MESSAGE_MIN = 10;

export const contactSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, '請輸入稱呼')
    .max(MAX_LENGTH.contactName, `稱呼不可超過 ${MAX_LENGTH.contactName} 字`),
  /**
   * **只作回覆位址（`replyTo`），MUST NOT 作為身分依據**（FR-019）。
   * 格式仍 MUST 驗：一個填不回去的位址等於營運者讀了訊息卻回不了信。
   */
  email: z.string().trim().min(1, '請輸入 Email').email('Email 格式不正確'),
  message: z
    .string()
    .trim()
    .min(MESSAGE_MIN, `訊息內容至少需要 ${MESSAGE_MIN} 個字`)
    .max(MAX_LENGTH.contactMessage, `訊息內容不可超過 ${MAX_LENGTH.contactMessage} 字`),
  /**
   * honeypot（contracts §1.4）。對人不可見、不會被鍵盤走訪、不會被自動填入 ——
   * **只有機器人會填它**，故非空即失敗，Route Handler 據此回 **400**。
   *
   * **MUST NOT 回假成功的 200**：常見做法是回 200 騙機器人，但那正是站上明文禁止的假成功
   * （FR-020、`feat4-scan` 甲-3），且會留下一個「回報成功但什麼也沒做」的分支，
   * 往後每個讀到它的人都要重新判斷那是不是 bug。
   *
   * `.optional()`：欄位缺席不算命中 —— 命中的定義是「**填了東西**」。
   */
  website: z.literal('').optional(),
});

export type ContactInput = z.infer<typeof contactSchema>;
