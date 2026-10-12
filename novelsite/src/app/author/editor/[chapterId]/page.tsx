import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ChapterEditor } from '@/components/author/ChapterEditor';
import { getAuthorChapterForEdit } from '@/lib/repositories';
import { requireAuthor } from '@/lib/auth/guard';

/** generateMetadata + requireAuthor()：見 author/dashboard/page.tsx 同名註解，FR-011 */
export async function generateMetadata(): Promise<Metadata> {
  await requireAuthor();
  return {
    title: '章節編輯器',
    description: '撰寫與編輯章節內容，支援 Markdown 語法與即時預覽。',
  };
}

/**
 * `requireAuthor()` MUST 為第一個 await（見 author/dashboard/page.tsx 同名註解）。
 *
 * **FEAT-3 的兩處變更**：
 * 1. 擁有者由**登入的工作階段**決定，不再是 `DEMO_AUTHOR_ID` —— 那個常數存在的唯一理由
 *    是「session→作者綁定屬 FEAT-3」，而 FEAT-3 就是現在。
 * 2. 改用 `getAuthorChapterForEdit`（不限狀態）：FR-013 要求已發佈章節也能回編輯器修改，
 *    只查草稿的 `getAuthorDraftChapter` 會讓作者一發佈就再也編不到自己的稿。
 *
 * 原本的 `generateStaticParams` 一併移除 —— 它以固定作者預先產生章節路徑，
 * 對一個受保護且逐使用者不同的頁面而言，預先產生的那份清單本身就是別人的資料。
 */
export default async function ChapterEditorPage({
  params,
}: {
  params: Promise<{ chapterId: string }>;
}) {
  const session = await requireAuthor();
  const { chapterId } = await params;

  // 擁有者條件由 repository 的 where 強制；非本作者的章節一律查不到 → 404（不是 403）
  const draft = await getAuthorChapterForEdit(session.uid, chapterId);
  if (!draft) notFound();

  return <ChapterEditor draft={draft} />;
}
