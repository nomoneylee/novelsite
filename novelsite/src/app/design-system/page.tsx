'use client';

import React, { useState } from 'react';
import { useThemeContext } from '@/components/ThemeProvider';
import {
  Button,
  Badge,
  Card,
  Avatar,
  Input,
  Textarea,
  Modal,
  Drawer,
  Tabs,
  TabList,
  Tab,
  TabPanel,
  Progress,
} from '@/components/ui';
import type { Theme } from '@/components/ThemeProvider';
import styles from './page.module.css';

// ── 假資料 ──────────────────────────────────
const MOCK_BOOKS = [
  {
    id: '1',
    title: '九天玄帝訣',
    author: '蒼穹一劍',
    category: '玄幻',
    wordCount: 3200000,
    chapterCount: 1240,
    rating: 4.8,
    excerpt: '少年蕭塵，踏入修煉之路，以無上天賦逆天改命，最終登臨九天彼端，俯瞰萬古蒼生。',
  },
  {
    id: '2',
    title: '都市之巔',
    author: '墨色長河',
    category: '都市',
    wordCount: 1800000,
    chapterCount: 680,
    rating: 4.5,
    excerpt: '林峰歸來，懷揣神秘功法，從一介平民到商界傳奇，書寫屬於自己的都市傳說。',
  },
  {
    id: '3',
    title: '傾城之戀',
    author: '落葉如秋',
    category: '言情',
    wordCount: 950000,
    chapterCount: 360,
    rating: 4.6,
    excerpt: '她是冷漠的CEO助理，他是叱吒商場的集團繼承人，一次誤會讓兩個人的命運交織在一起。',
  },
];

const THEME_LABELS: Record<Theme, string> = {
  light: '☀️ 白紙模式',
  dark: '🌙 夜間模式',
  eyecare: '🍃 護眼模式',
};

// ── 色板元件 ──────────────────────────────────
function ColorSwatch({ label, color, cssVar }: { label: string; color: string; cssVar: string }) {
  return (
    <div className={styles.swatch}>
      <div className={styles.swatch__color} style={{ background: `var(${cssVar}, ${color})` }} />
      <div className={styles.swatch__info}>
        <span className={styles.swatch__label}>{label}</span>
        <code className={styles.swatch__var}>{cssVar}</code>
        <span className={styles.swatch__hex}>{color}</span>
      </div>
    </div>
  );
}

// ── Section 元件 ──────────────────────────────
function Section({
  title,
  children,
  id,
}: {
  title: string;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className={styles.section}>
      <h2 className={styles.section__title}>{title}</h2>
      <div className={styles.section__content}>{children}</div>
    </section>
  );
}

// ── 主頁面 ──────────────────────────────────
export default function DesignSystemPage() {
  const { theme, setTheme } = useThemeContext();
  const [activeTab, setActiveTab] = useState('buttons');
  const [modalOpen, setModalOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerSide, setDrawerSide] = useState<'left' | 'right' | 'bottom'>('right');
  const [progress, setProgress] = useState(42);

  return (
    <div className={styles.page}>
      {/* ── Header ── */}
      <header className={styles.header}>
        <div className={styles.header__inner}>
          <div>
            <h1 className={styles.header__title}>NovelSite Design System</h1>
            <p className={styles.header__subtitle}>Phase 1 元件庫 · 三段主題 · GSAP 動畫基礎</p>
          </div>
          <div className={styles.header__actions}>
            {(Object.keys(THEME_LABELS) as Theme[]).map((t) => (
              <button
                key={t}
                id={`theme-btn-${t}`}
                className={`${styles.theme__btn} ${theme === t ? styles['theme__btn--active'] : ''}`}
                onClick={() => setTheme(t)}
              >
                {THEME_LABELS[t]}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className={styles.main}>
        {/* ── 色彩系統 ── */}
        <Section title="🎨 色彩系統" id="colors">
          <div className={styles.swatches}>
            <ColorSwatch label="Primary" color="#3D2B1F" cssVar="--color-primary" />
            <ColorSwatch label="Secondary" color="#92400E" cssVar="--color-secondary" />
            <ColorSwatch label="Accent / CTA" color="#D97706" cssVar="--color-accent" />
            <ColorSwatch label="Background" color="#FDFAF5" cssVar="--color-bg" />
            <ColorSwatch label="Foreground" color="#1A1A1A" cssVar="--color-fg" />
            <ColorSwatch label="Surface" color="#FFFFFF" cssVar="--color-surface" />
            <ColorSwatch label="Muted" color="#F5F0E8" cssVar="--color-muted" />
            <ColorSwatch label="Border" color="#E8E0D4" cssVar="--color-border" />
            <ColorSwatch label="Subtle" color="#78716C" cssVar="--color-subtle" />
          </div>
        </Section>

        {/* ── 字體系統 ── */}
        <Section title="🔤 字體系統" id="typography">
          <div className={styles.type__scale}>
            {[
              { token: '--text-4xl', size: '64px', label: 'Hero 超大展示標題', family: 'heading' },
              { token: '--text-3xl', size: '48px', label: 'Hero 大標', family: 'heading' },
              { token: '--text-2xl', size: '32px', label: '頁面主標題', family: 'heading' },
              { token: '--text-xl', size: '24px', label: '頁面副標題', family: 'heading' },
              { token: '--text-lg', size: '20px', label: '章節標題', family: 'heading' },
              { token: '--text-md', size: '18px', label: '卡片標題', family: 'body' },
              { token: '--text-base', size: '16px', label: '閱讀正文', family: 'body' },
              { token: '--text-sm', size: '14px', label: '副標 / Metadata', family: 'ui' },
              { token: '--text-xs', size: '12px', label: '標籤 / 時間戳', family: 'ui' },
            ].map(({ token, size, label, family }) => (
              <div key={token} className={styles.type__row}>
                <code className={styles.type__token}>{token}</code>
                <span className={styles.type__size}>{size}</span>
                <span
                  className={styles.type__sample}
                  style={{
                    fontSize: `var(${token})`,
                    fontFamily:
                      family === 'heading'
                        ? 'var(--font-heading)'
                        : family === 'ui'
                          ? 'var(--font-ui)'
                          : 'var(--font-body)',
                  }}
                >
                  {label} — NovelSite 繁體中文文學平台
                </span>
              </div>
            ))}
          </div>
        </Section>

        {/* ── Tabs 導覽：其他元件 ── */}
        <Section title="🧩 元件庫" id="components">
          <Tabs value={activeTab} onChange={setActiveTab} variant="underline">
            <TabList>
              <Tab value="buttons">按鈕</Tab>
              <Tab value="badges">標籤</Tab>
              <Tab value="cards">書籍卡片</Tab>
              <Tab value="avatars">頭像</Tab>
              <Tab value="inputs">輸入框</Tab>
              <Tab value="overlays">浮層</Tab>
              <Tab value="progress">進度條</Tab>
            </TabList>

            {/* ── Buttons ── */}
            <TabPanel value="buttons">
              <div className={styles.demo}>
                <div className={styles.demo__row}>
                  <h3 className={styles.demo__subtitle}>四種變體</h3>
                  <div className={styles.demo__items}>
                    <Button id="btn-primary" variant="primary">
                      立即閱讀
                    </Button>
                    <Button id="btn-secondary" variant="secondary">
                      加入書架
                    </Button>
                    <Button id="btn-ghost" variant="ghost">
                      查看更多
                    </Button>
                    <Button id="btn-danger" variant="danger">
                      刪除章節
                    </Button>
                  </div>
                </div>
                <div className={styles.demo__row}>
                  <h3 className={styles.demo__subtitle}>三種尺寸</h3>
                  <div className={styles.demo__items}>
                    <Button id="btn-sm" variant="primary" size="sm">
                      小按鈕
                    </Button>
                    <Button id="btn-md" variant="primary" size="md">
                      標準按鈕
                    </Button>
                    <Button id="btn-lg" variant="primary" size="lg">
                      大按鈕
                    </Button>
                  </div>
                </div>
                <div className={styles.demo__row}>
                  <h3 className={styles.demo__subtitle}>狀態</h3>
                  <div className={styles.demo__items}>
                    <Button id="btn-loading" variant="primary" loading>
                      載入中
                    </Button>
                    <Button id="btn-disabled" variant="primary" disabled>
                      已禁用
                    </Button>
                    <Button id="btn-full" variant="secondary" fullWidth>
                      全寬按鈕（點選觸發 Modal）
                    </Button>
                  </div>
                </div>
              </div>
            </TabPanel>

            {/* ── Badges ── */}
            <TabPanel value="badges">
              <div className={styles.demo}>
                <div className={styles.demo__row}>
                  <h3 className={styles.demo__subtitle}>小說分類</h3>
                  <div className={styles.demo__items}>
                    <Badge variant="fantasy">玄幻</Badge>
                    <Badge variant="urban">都市</Badge>
                    <Badge variant="romance">言情</Badge>
                    <Badge variant="scifi">科幻</Badge>
                    <Badge variant="history">歷史</Badge>
                    <Badge variant="mystery">懸疑</Badge>
                    <Badge variant="default">其他</Badge>
                  </div>
                </div>
                <div className={styles.demo__row}>
                  <h3 className={styles.demo__subtitle}>功能狀態</h3>
                  <div className={styles.demo__items}>
                    <Badge variant="success" dot>
                      連載中
                    </Badge>
                    <Badge variant="warning" dot>
                      即將完結
                    </Badge>
                    <Badge variant="error" dot>
                      已停更
                    </Badge>
                    <Badge variant="info" dot>
                      新書推薦
                    </Badge>
                  </div>
                </div>
              </div>
            </TabPanel>

            {/* ── Cards ── */}
            <TabPanel value="cards">
              <div className={styles.cards__grid}>
                {MOCK_BOOKS.map((book) => (
                  <Card key={book.id} {...book} onClick={() => alert(`點擊：《${book.title}》`)} />
                ))}
              </div>
            </TabPanel>

            {/* ── Avatars ── */}
            <TabPanel value="avatars">
              <div className={styles.demo}>
                <div className={styles.demo__row}>
                  <h3 className={styles.demo__subtitle}>五種尺寸（縮寫佔位符）</h3>
                  <div className={styles.demo__items} style={{ alignItems: 'center' }}>
                    <Avatar name="蒼穹一劍" size="xs" />
                    <Avatar name="蒼穹一劍" size="sm" />
                    <Avatar name="蒼穹一劍" size="md" />
                    <Avatar name="蒼穹一劍" size="lg" />
                    <Avatar name="蒼穹一劍" size="xl" />
                  </div>
                </div>
              </div>
            </TabPanel>

            {/* ── Inputs ── */}
            <TabPanel value="inputs">
              <div className={styles.demo}>
                <div className={styles.demo__col}>
                  <Input
                    id="input-search"
                    label="搜尋作品"
                    placeholder="輸入書名或作者名..."
                    type="search"
                    fullWidth
                  />
                  <Input
                    id="input-email"
                    label="電子郵件"
                    placeholder="your@email.com"
                    type="email"
                    hint="我們不會分享您的電子郵件"
                    fullWidth
                  />
                  <Input
                    id="input-error"
                    label="密碼"
                    type="password"
                    error="密碼長度至少需要 8 個字元"
                    fullWidth
                  />
                  <Textarea
                    id="textarea-intro"
                    label="作品簡介"
                    placeholder="介紹你的故事..."
                    rows={4}
                    hint="建議 100-300 字"
                    fullWidth
                  />
                </div>
              </div>
            </TabPanel>

            {/* ── Overlays ── */}
            <TabPanel value="overlays">
              <div className={styles.demo}>
                <div className={styles.demo__row}>
                  <h3 className={styles.demo__subtitle}>Modal 對話框</h3>
                  <div className={styles.demo__items}>
                    <Button
                      id="open-modal-btn"
                      variant="primary"
                      onClick={() => setModalOpen(true)}
                    >
                      開啟 Modal
                    </Button>
                  </div>
                </div>
                <div className={styles.demo__row}>
                  <h3 className={styles.demo__subtitle}>Drawer 側邊欄</h3>
                  <div className={styles.demo__items}>
                    <Button
                      id="open-drawer-right-btn"
                      variant="secondary"
                      onClick={() => {
                        setDrawerSide('right');
                        setDrawerOpen(true);
                      }}
                    >
                      右側 Drawer
                    </Button>
                    <Button
                      id="open-drawer-left-btn"
                      variant="secondary"
                      onClick={() => {
                        setDrawerSide('left');
                        setDrawerOpen(true);
                      }}
                    >
                      左側 Drawer
                    </Button>
                    <Button
                      id="open-drawer-bottom-btn"
                      variant="secondary"
                      onClick={() => {
                        setDrawerSide('bottom');
                        setDrawerOpen(true);
                      }}
                    >
                      底部 Drawer
                    </Button>
                  </div>
                </div>
              </div>
            </TabPanel>

            {/* ── Progress ── */}
            <TabPanel value="progress">
              <div className={styles.demo}>
                <div className={styles.demo__col}>
                  <div>
                    <h3 className={styles.demo__subtitle}>閱讀進度條</h3>
                    <Progress
                      value={progress}
                      variant="reading"
                      size="sm"
                      showLabel
                      label={`閱讀進度`}
                      aria-label="閱讀進度"
                    />
                    <div className={styles.demo__items} style={{ marginTop: '16px' }}>
                      <Button
                        id="progress-dec-btn"
                        variant="ghost"
                        size="sm"
                        onClick={() => setProgress((p) => Math.max(0, p - 10))}
                      >
                        − 10%
                      </Button>
                      <Button
                        id="progress-inc-btn"
                        variant="ghost"
                        size="sm"
                        onClick={() => setProgress((p) => Math.min(100, p + 10))}
                      >
                        + 10%
                      </Button>
                    </div>
                  </div>
                  <div>
                    <h3 className={styles.demo__subtitle}>各種尺寸</h3>
                    <div className={styles.demo__col} style={{ gap: '12px' }}>
                      <Progress value={75} size="xs" variant="default" aria-label="xs 進度" />
                      <Progress value={60} size="sm" variant="reading" aria-label="sm 進度" />
                      <Progress value={45} size="md" variant="success" aria-label="md 進度" />
                      <Progress value={30} size="lg" variant="warning" aria-label="lg 進度" />
                    </div>
                  </div>
                </div>
              </div>
            </TabPanel>
          </Tabs>
        </Section>
      </main>

      {/* ── Modal ── */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title="加入書架確認"
        description="將《九天玄帝訣》加入您的個人書架"
        footer={
          <>
            <Button id="modal-cancel-btn" variant="ghost" onClick={() => setModalOpen(false)}>
              取消
            </Button>
            <Button id="modal-confirm-btn" variant="primary" onClick={() => setModalOpen(false)}>
              確認加入
            </Button>
          </>
        }
      >
        <p style={{ color: 'var(--color-fg-secondary)', lineHeight: 1.8 }}>
          加入書架後，您可以在「我的書架」中隨時找到這本書，並追蹤最新章節更新通知。
        </p>
      </Modal>

      {/* ── Drawer ── */}
      <Drawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        side={drawerSide}
        title="📖 章節目錄"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              style={{
                padding: '12px 16px',
                borderRadius: 'var(--radius-md)',
                background: i === 2 ? 'var(--color-accent-light)' : 'transparent',
                color: i === 2 ? 'var(--color-accent)' : 'var(--color-fg-secondary)',
                fontSize: 'var(--text-sm)',
                cursor: 'pointer',
                transition: 'background 0.15s',
              }}
            >
              第 {i + 1} 章：
              {
                [
                  '命運的開始',
                  '逆天改命',
                  '初入修煉界',
                  '第一次突破',
                  '與天地共舞',
                  '血戰洪荒',
                  '九天之境',
                  '超越極限',
                  '萬古一帝',
                  '彼端的守望',
                  '最終決戰',
                  '永恆的傳說',
                ][i]
              }
            </div>
          ))}
        </div>
      </Drawer>
    </div>
  );
}
