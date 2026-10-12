/**
 * US3（2-C）擁有權的型別層強制（FR-019、SC-007）—— **編譯期斷言，非執行期測試**。
 *
 * 本檔沒有 runtime 案例，驗證手段是 `npx tsc --noEmit`：
 *  - 每一個 `@ts-expect-error` 都宣告「下一行 MUST 是型別錯誤」。
 *    若哪天 `authorId` 變成選填、或 barrel 匯出了無擁有者條件的作者查詢，
 *    該行就不再是錯誤，`@ts-expect-error` 自身即成為 `tsc` 錯誤 —— 綠燈閘門會擋下。
 *  - 因此「省略 authorId 即編譯失敗」這件事本身就被綠燈閘門持續稽核，SC-007 = 100%。
 *
 * 本檔 MUST NOT 被 vitest 收集（見 vitest.integration.config.mts 的 include 限定為 *.test.ts）。
 */
import {
  getAuthorWorks,
  getAuthorChapterForEdit,
  getAuthorNovelManage,
  getAuthorSummary,
} from '@/lib/repositories';
import type {
  AuthorWorkSummary,
  AuthorChapterSummary,
  AuthorNovelManage,
  AuthorSummary,
} from '@/lib/types';

const AUTHOR_ID = 'content-author-id';
const CHAPTER_ID = 'draft-1';
const NOVEL_ID = 'featured-1';

/** 僅供型別比對；不會被執行 */
function expectType<T>(value: T): T {
  return value;
}

// ─────────────────────────────────────────────
// 正例：帶 authorId 呼叫，且回傳為改名後的領域型別
// ─────────────────────────────────────────────
export async function ownershipAwareCalls(): Promise<void> {
  expectType<AuthorWorkSummary[]>(await getAuthorWorks(AUTHOR_ID));
  expectType<AuthorChapterSummary | null>(await getAuthorChapterForEdit(AUTHOR_ID, CHAPTER_ID));
  expectType<AuthorNovelManage | null>(await getAuthorNovelManage(AUTHOR_ID, NOVEL_ID));
  expectType<AuthorSummary>(await getAuthorSummary(AUTHOR_ID));
}

// ─────────────────────────────────────────────
// 反例：省略 authorId MUST 編譯失敗（每一行都被 @ts-expect-error 鎖住）
// ─────────────────────────────────────────────
export function ownershipOmissionsMustNotCompile(): void {
  // @ts-expect-error getAuthorWorks 的 authorId 為必填，省略 MUST 編譯失敗（FR-019）
  void getAuthorWorks();

  // @ts-expect-error getAuthorChapterForEdit 的 authorId 為必填，只給 chapterId MUST 編譯失敗
  void getAuthorChapterForEdit(CHAPTER_ID);

  // @ts-expect-error getAuthorNovelManage 的 authorId 為必填，只給 novelId MUST 編譯失敗
  void getAuthorNovelManage(NOVEL_ID);

  // @ts-expect-error getAuthorSummary 的 authorId 為必填，省略 MUST 編譯失敗（FR-019）
  void getAuthorSummary();

  // @ts-expect-error authorId MUST 為 string，傳 undefined 規避擁有者條件 MUST 編譯失敗
  void getAuthorWorks(undefined);
}
