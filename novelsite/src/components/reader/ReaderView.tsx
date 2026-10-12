'use client';

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  CaretLeft,
  CaretRight,
  List,
  Moon,
  Sun,
  Eye,
  TextAa,
} from '@phosphor-icons/react';
import { Progress } from '@/components/ui/Progress';
import { Drawer } from '@/components/ui/Drawer';
import { SafeMarkdown } from '@/components/ui/SafeMarkdown';
import { ChapterCommentSection } from './ChapterCommentSection';
import { useThemeContext, type Theme } from '@/components/ThemeProvider';
import { useReaderPrefs, type ReaderFontSize } from '@/hooks/useReaderPrefs';
import { useReadingHistory } from '@/hooks/useReadingHistory';
import { useProgressReporter } from '@/hooks/useProgressReporter';
import { useSessionUser } from '@/components/SessionProvider';
import type { ChapterContext } from '@/lib/types';
import { apiUrl } from '@/lib/apiUrl';
import styles from './ReaderView.module.css';

interface ReaderViewProps {
  context: ChapterContext;
  /**
   * 自續讀入口（`?resume=1`）進入時的記錄位置；否則為 null。
   * 由伺服器端經服務層傳入（contracts/reader-state-api.md §2）。
   */
  resumePercent?: number | null;
  /** `PROGRESS_REPORT_INTERVAL_SECONDS`。設定值住在伺服器端，故由頁面傳下來 */
  reportIntervalSeconds: number;
}

const THEME_ICONS: Record<Theme, React.ReactNode> = {
  light: <Sun size={18} />,
  dark: <Moon size={18} />,
  eyecare: <Eye size={18} />,
};
const FONT_SIZE_LABEL: Record<ReaderFontSize, string> = { sm: 'A-', md: 'A', lg: 'A+' };

export function ReaderView({
  context,
  resumePercent = null,
  reportIntervalSeconds,
}: ReaderViewProps) {
  const { novel, volume, chapter, bodyMarkdown, prevChapterId, nextChapterId, progressInVolume } =
    context;
  const prefsSyncNoteId = useId();
  const router = useRouter();
  const isLoggedIn = useSessionUser() !== null;
  const { theme, cycleTheme, mounted: themeMounted } = useThemeContext();
  const { fontSize, distractionFree, setFontSize, toggleDistractionFree } = useReaderPrefs();
  const { recordVisit } = useReadingHistory();

  const [scrollProgress, setScrollProgress] = useState(0);
  const [toolbarVisible, setToolbarVisible] = useState(true);
  const [tocOpen, setTocOpen] = useState(false);

  const contentRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLElement>(null);
  const lastScrollY = useRef(0);

  // 記錄本次章節造訪，供「閱讀歷史」頁面顯示
  useEffect(() => {
    recordVisit({
      novelId: novel.id,
      novelTitle: novel.title,
      coverColor: novel.coverColor,
      chapterId: chapter.id,
      chapterTitle: chapter.title,
      readAt: new Date().toISOString(),
    });
  }, [novel.id, novel.title, novel.coverColor, chapter.id, chapter.title, recordVisit]);

  /**
   * 續讀位置還原（FR-011 的落點）。
   *
   * `restored` 在還原完成前為 false，`getPercent` 因此回 `null`，
   * 上報器整個跳過 —— **少了這道閘，首次的 0% 會覆寫掉正要還原的那個值，
   * 續讀在第一次使用後就自我銷毀**（contracts/reader-state-api.md §2）。
   * 無續讀點（或 percent 為 0）時維持置頂，並立刻視為已就緒。
   */
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    // 一律走 rAF：正文渲染完成後 DOM 高度才確定，先捲會落在錯的位置。
    // 無續讀點的情況也走同一條路徑，只是不捲動 —— 分成兩條會讓「就緒」有兩個時機
    const raf = requestAnimationFrame(() => {
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (resumePercent && docHeight > 0) {
        window.scrollTo({ top: (docHeight * resumePercent) / 100, behavior: 'auto' });
      }
      setRestored(true);
    });
    return () => cancelAnimationFrame(raf);
  }, [resumePercent, chapter.id]);

  /**
   * 進度上報。`getPercent` 是 ref 的讀取而非 state，故上報器不必隨每次捲動重建。
   * 未登入者不上報：端點需登入，送出只會換來一連串 401。
   */
  const scrollPercentRef = useRef(0);
  const getPercent = useCallback(
    () => (restored ? Math.round(scrollPercentRef.current) : null),
    [restored]
  );

  useProgressReporter({
    enabled: isLoggedIn,
    novelId: novel.id,
    chapterId: chapter.id,
    getPercent,
    intervalSeconds: reportIntervalSeconds,
  });

  /**
   * 首次載入時上報一次。
   *
   * **這同時是 `ReadingHistory` 的唯一寫入觸發**：契約中歷史沒有獨立端點，
   * 由 `PUT /api/reading-progress` 的處理程序一併 upsert（§3）。
   * 少了這一次呼叫，登入者的閱讀歷史頁永遠是空的。
   */
  useEffect(() => {
    if (!isLoggedIn || !restored) return;
    void fetch(apiUrl('/api/reading-progress'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        novelId: novel.id,
        chapterId: chapter.id,
        percent: resumePercent ?? 0,
      }),
    }).catch(() => {
      // 上報失敗 MUST 被吞掉，MUST NOT 影響閱讀（FR-012）
    });
  }, [isLoggedIn, restored, novel.id, chapter.id, resumePercent]);

  /**
   * 閱讀曝光上報（FEAT-4 4-C / T106，FR-033）。
   *
   * **載入完成即上報，MUST NOT 設停留時間或捲動比例門檻**：重複由伺服器端的去重窗口
   * 擋下（30 分鐘內同一讀者同一章節只計一次），引入計時門檻會需要前端計時邏輯
   * 與一個必須真的等下去的測試。
   *
   * **不看登入狀態**：端點對匿名開放 —— 多數讀者未登入，只收登入者會使曝光大幅低估。
   * 失敗一律吞掉且 MUST NOT 阻塞閱讀（FR-012 的同一條規則）。
   */
  useEffect(() => {
    void fetch(apiUrl(`/api/chapters/${chapter.id}/view`), { method: 'POST' }).catch(() => {
      // 上報失敗不影響閱讀，亦不對讀者顯示任何訊息
    });
  }, [chapter.id]);

  // 捲動追蹤：更新進度條 + 工具欄自動隱藏/顯示
  useEffect(() => {
    const handleScroll = () => {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const percentage = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
      const clamped = Math.min(100, Math.max(0, percentage));
      setScrollProgress(clamped);
      // 上報器讀 ref 而非 state：否則每一次捲動都會讓它重建一次計時器，節流就沒了
      scrollPercentRef.current = clamped;

      const goingDown = scrollTop > lastScrollY.current;
      setToolbarVisible(!goingDown || scrollTop < 80);
      lastScrollY.current = scrollTop;
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // 工具欄顯示/隱藏動畫
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { toggleToolbar } = await import('@/lib/gsap');
      if (!cancelled && toolbarRef.current) {
        toggleToolbar(toolbarRef.current, toolbarVisible && !distractionFree);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [toolbarVisible, distractionFree]);

  const goToChapter = useCallback(
    (chapterId: string | null) => {
      if (!chapterId) return;
      router.push(`/reader/${novel.id}/${chapterId}`);
    },
    [router, novel.id]
  );

  // 鍵盤快捷鍵：← 上一章 / → 下一章
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowLeft') goToChapter(prevChapterId);
      else if (e.key === 'ArrowRight') goToChapter(nextChapterId);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goToChapter, prevChapterId, nextChapterId]);

  // 行動裝置手勢：左右滑動切換章節
  const touchStartX = useRef<number | null>(null);
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const deltaX = e.changedTouches[0].clientX - touchStartX.current;
    const SWIPE_THRESHOLD = 60;
    if (deltaX > SWIPE_THRESHOLD) goToChapter(prevChapterId);
    else if (deltaX < -SWIPE_THRESHOLD) goToChapter(nextChapterId);
    touchStartX.current = null;
  };

  // 雙擊：切換無干擾模式
  const handleContentDoubleClick = useCallback(() => {
    toggleDistractionFree();
  }, [toggleDistractionFree]);

  const cycleFontSize = useCallback(() => {
    const sizes: ReaderFontSize[] = ['sm', 'md', 'lg'];
    const idx = sizes.indexOf(fontSize);
    setFontSize(sizes[(idx + 1) % sizes.length]);
  }, [fontSize, setFontSize]);

  return (
    <div
      className={`${styles.reader} ${distractionFree ? styles['reader--distraction-free'] : ''}`}
      data-reader-font={fontSize}
    >
      {/* 頂部進度條。MUST 為 landmark（region）—— 否則落在 header／main／nav 之外
          （axe region 規則） */}
      <div role="region" aria-label="閱讀進度列">
        <Progress
          value={scrollProgress}
          variant="reading"
          size="xs"
          sticky
          animated={false}
          aria-label="閱讀進度"
        />
      </div>

      {/* 頂部導覽列 */}
      {!distractionFree && (
        <header className={styles.reader__topbar}>
          <Link href={`/novels/${novel.id}`} className={styles.reader__back} id="reader-back-btn">
            <ArrowLeft size={18} />
            <span>{novel.title}</span>
          </Link>
          <div className={styles.reader__chapterNav}>
            <button
              type="button"
              className={styles.reader__navBtn}
              onClick={() => goToChapter(prevChapterId)}
              disabled={!prevChapterId}
              aria-label="上一章"
            >
              <CaretLeft size={14} /> 上一章
            </button>
            <span className={styles.reader__chapterTitle}>
              第 {chapter.number} 章：{chapter.title}
            </span>
            <button
              type="button"
              className={styles.reader__navBtn}
              onClick={() => goToChapter(nextChapterId)}
              disabled={!nextChapterId}
              aria-label="下一章"
            >
              下一章 <CaretRight size={14} />
            </button>
          </div>
        </header>
      )}

      {/* 正文區域 */}
      <main
        ref={contentRef}
        className={`reader-content ${styles.reader__content}`}
        onDoubleClick={handleContentDoubleClick}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        id="reader-content"
      >
        <h1 className={styles.reader__title}>
          第 {chapter.number} 章：{chapter.title}
        </h1>
        {/*
          正文改由 `<SafeMarkdown>` 渲染（FR-017／FR-020）。
          **既有排版契約一律不動**：外層的 `data-reader-font`、`.reader-content` 這個
          class 與 `#reader-content` 這個 id 都留在原處 —— 字級、行高、段距、主題與
          無干擾模式全靠它們掛上 CSS（`global.css` 的 `--reader-font-{sm,md,lg}`）。
          把渲染方式換掉卻順手改了容器，讀者會在下一次發佈時發現字級偏好失效，
          而那與「支援 Markdown」這件事完全無關。
        */}
        <SafeMarkdown>{bodyMarkdown}</SafeMarkdown>

        {/* 章末導航 */}
        <div className={styles.reader__endNav}>
          <button
            type="button"
            className={styles.reader__endBtn}
            onClick={() => goToChapter(prevChapterId)}
            disabled={!prevChapterId}
          >
            <CaretLeft size={16} /> 上一章
          </button>
          <button
            type="button"
            className={`${styles.reader__endBtn} ${styles['reader__endBtn--accent']}`}
            onClick={() => goToChapter(nextChapterId)}
            disabled={!nextChapterId}
          >
            下一章 <CaretRight size={16} />
          </button>
        </div>
      </main>

      {/* 章末留言區（T078）。**掛在 `<main>` 之外**：憲章第 I 條要求互動元件
          MUST NOT 侵入閱讀動線 —— 放進正文容器就會跟著 `.reader-content` 的字級、
          行高與無干擾模式一起變化，而讀者調那些是為了讀小說。
          自成一個具名 region，內容才不會落在任何 landmark 之外（axe region 規則）。 */}
      <ChapterCommentSection chapterId={chapter.id} />

      {/* 浮動工具欄。MUST 為 landmark（nav）—— 否則工具列內容（含 T084 的僅存本機加註）
          落在任何 landmark 之外（axe region 規則） */}
      <nav
        ref={toolbarRef}
        className={styles.reader__toolbar}
        id="reader-toolbar"
        aria-label="閱讀工具列"
      >
        <button
          type="button"
          className={styles.reader__toolbarBtn}
          onClick={() => setTocOpen(true)}
          aria-label="章節目錄"
        >
          <List size={20} />
          <span>目錄</span>
        </button>
        <button
          type="button"
          className={styles.reader__toolbarBtn}
          onClick={cycleFontSize}
          aria-label={`字體大小：${FONT_SIZE_LABEL[fontSize]}`}
          aria-describedby={prefsSyncNoteId}
        >
          <TextAa size={20} />
          <span>{FONT_SIZE_LABEL[fontSize]}</span>
        </button>
        {/* FEAT-4 起字級與主題改存伺服器：登入者跨裝置同步（FR-014）。
            無干擾模式不在同步範圍內——它明訂不跨章節記憶。
            原本那句「本機限定」的主張已不成立，MUST NOT 留在註解或畫面上（FR-018 禁的是主張，不是某一個字串） */}
        <span id={prefsSyncNoteId} className="sr-only">
          登入後字體大小與主題會自動同步至你的帳號
        </span>
        <button
          type="button"
          className={styles.reader__toolbarBtn}
          onClick={cycleTheme}
          aria-label="切換主題"
          suppressHydrationWarning
        >
          {themeMounted ? THEME_ICONS[theme] : <Sun size={18} />}
          <span>主題</span>
        </button>
      </nav>

      {/* 章節目錄 Drawer */}
      <Drawer
        isOpen={tocOpen}
        onClose={() => setTocOpen(false)}
        side="right"
        title={`章節目錄・${volume.title}`}
      >
        <div className={styles.toc}>
          {volume.chapters.map((ch) => (
            <button
              key={ch.id}
              type="button"
              className={`${styles.toc__item} ${ch.id === chapter.id ? styles['toc__item--active'] : ''}`}
              onClick={() => {
                setTocOpen(false);
                goToChapter(ch.id);
              }}
            >
              <span className={styles.toc__num}>第 {ch.number} 章</span>
              <span className={styles.toc__title}>{ch.title}</span>
            </button>
          ))}
        </div>
      </Drawer>

      {distractionFree && (
        <button
          type="button"
          className={styles.reader__exitHint}
          onClick={toggleDistractionFree}
          aria-label="退出無干擾模式"
        >
          雙擊畫面以退出無干擾模式・進度 {progressInVolume}%
        </button>
      )}
    </div>
  );
}
