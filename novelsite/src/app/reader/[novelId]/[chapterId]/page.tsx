import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getChapterContext } from '@/lib/repositories';
import { ReaderView } from '@/components/reader/ReaderView';
import { getSession } from '@/lib/auth/guard';
import { getProgress } from '@/lib/services/readingService';
import { env } from '@/lib/env';

interface Props {
  params: Promise<{ novelId: string; chapterId: string }>;
  searchParams: Promise<{ resume?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { novelId, chapterId } = await params;
  const context = await getChapterContext(novelId, chapterId);

  if (!context) {
    return {
      title: '找不到章節',
      description: '該章節不存在或已下架。',
    };
  }

  return {
    title: `${context.chapter.title} — ${context.novel.title}`,
    description: `${context.novel.title}（作者：${context.novel.author}）第 ${context.chapter.number} 章：${context.chapter.title}`,
  };
}

export default async function ReaderPage({ params, searchParams }: Props) {
  const { novelId, chapterId } = await params;
  const context = await getChapterContext(novelId, chapterId);

  if (!context) notFound();

  /**
   * 續讀位置只在**自續讀入口進入時**（`?resume=1`）還原（FR-011）。
   * 從目錄直接點某一章不該被拉到別的位置——那是使用者剛剛做出的選擇。
   * 記錄的章節與當前章節不符時亦不還原：百分比是相對於「那一章」的長度。
   */
  const { resume } = await searchParams;
  let resumePercent: number | null = null;
  if (resume === '1') {
    const session = await getSession();
    const point = session ? await getProgress(session.uid, novelId) : null;
    if (point && point.chapterId === chapterId) resumePercent = point.percent;
  }

  return (
    <ReaderView
      context={context}
      resumePercent={resumePercent}
      reportIntervalSeconds={env.PROGRESS_REPORT_INTERVAL_SECONDS}
    />
  );
}
