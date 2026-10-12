import { z } from 'zod';
import { MAX_LENGTH } from './common';

/**
 * 作品寫入的驗證規則（FR-006a、FR-012、FR-012c、data-model.md §7）
 * =================================================================
 * client / server 共用同一份定義 —— 前端拿它做即時提示，Action 拿它做真正的把關。
 * 兩邊各寫一份的必然結果是漂移，而漂移出來的那一版永遠是前端那一版比較寬鬆。
 *
 * **Zod 只驗形狀**。`categoryId`／`tagIds` 的「這筆真的存在嗎」是資料庫事實，
 * MUST 由服務層於交易內查證（FR-012c）——下拉選單只約束得了照著用的人。
 */

/**
 * 封面色票組（FR-012）。
 *
 * 建立作品時由系統自本組指派，更新時只接受組內的值 —— 若開放任意字串，
 * 這個值會被原樣塞進 `style` 屬性，等於在作品頁開一個作者可控的 CSS 注入點。
 * 值取自既有示範資料的既定風格，非新設計。
 */
export const COVER_COLORS = [
  'linear-gradient(135deg, #1a0533 0%, #4a1942 40%, #8b2fc9 100%)',
  'linear-gradient(135deg, #0d1b2a 0%, #1b263b 40%, #415a77 100%)',
  'linear-gradient(135deg, #03071e 0%, #06235e 40%, #0466c8 100%)',
  'linear-gradient(160deg, #3d1a00 0%, #7c3a00 60%, #b85c00 100%)',
  'linear-gradient(160deg, #1a1a2e 0%, #16213e 60%, #0f3460 100%)',
  'linear-gradient(160deg, #1a0011 0%, #4a0030 60%, #8b0057 100%)',
  'linear-gradient(160deg, #0a1a00 0%, #1a3d00 60%, #2d6600 100%)',
  'linear-gradient(135deg, #1a1000 0%, #4a3000 50%, #8c6000 100%)',
] as const;

/** 隨機取一個色票（建立作品時由系統指派，作者不可指定） */
export function pickCoverColor(): string {
  return COVER_COLORS[Math.floor(Math.random() * COVER_COLORS.length)];
}

const coverColorSchema = z.string().refine((v) => (COVER_COLORS as readonly string[]).includes(v), {
  message: '請自既有色票組選擇封面色',
});

const novelIdField = z.string().trim().min(1, '缺少作品識別碼');

const titleField = z
  .string()
  .trim()
  .min(1, '請輸入作品標題')
  .max(MAX_LENGTH.novelTitle, `作品標題不得超過 ${MAX_LENGTH.novelTitle} 個字`);

const excerptField = z
  .string()
  .trim()
  .min(1, '請輸入作品簡介')
  .max(MAX_LENGTH.novelExcerpt, `作品簡介不得超過 ${MAX_LENGTH.novelExcerpt} 個字`);

/**
 * 建立作品：只收標題／分類／簡介三項（FR-012）。
 * `coverColor` **刻意不在入參內** —— 由系統指派，Zod 的預設剝除行為會把它濾掉。
 */
export const createNovelSchema = z.object({
  title: titleField,
  categoryId: z.string().trim().min(1, '請選擇分類'),
  excerpt: excerptField,
});

/** 更新作品：各欄位皆選填，帶了就得合規 */
export const updateNovelSchema = z.object({
  novelId: novelIdField,
  title: titleField.optional(),
  categoryId: z.string().trim().min(1, '請選擇分類').optional(),
  excerpt: excerptField.optional(),
  // 長版簡介選填，且**空字串合法**（作者可以清空）
  description: z
    .string()
    .trim()
    .max(MAX_LENGTH.novelExcerpt, `作品描述不得超過 ${MAX_LENGTH.novelExcerpt} 個字`)
    .optional(),
  // 空陣列代表「清除全部標籤」，與「不帶這個欄位」語意不同，故 MUST NOT 用 min(1)
  tagIds: z.array(z.string().trim().min(1, '標籤識別碼不得為空')).optional(),
  coverColor: coverColorSchema.optional(),
  serialStatus: z.enum(['ongoing', 'completed', 'hiatus']).optional(),
});

/** 上架／下架（發佈狀態，與連載狀態互相獨立） */
export const setNovelStatusSchema = z.object({
  novelId: novelIdField,
  status: z.enum(['draft', 'published', 'admin_suspended']),
});

/** 只需作品識別碼的操作（刪除） */
export const novelIdSchema = z.object({ novelId: novelIdField });

export type CreateNovelInput = z.infer<typeof createNovelSchema>;
export type UpdateNovelInput = z.infer<typeof updateNovelSchema>;
export type SetNovelStatusInput = z.infer<typeof setNovelStatusSchema>;
export type NovelIdInput = z.infer<typeof novelIdSchema>;
