# NovelSite Design System — MASTER.md

> **版本**：v1.0.0 | **更新日期**：2026-07-19
> **定位**：繁體中文原創文學平台，以「沉浸式閱讀體驗」為核心的設計系統

---

## 一、設計哲學

| 屬性 | 說明 |
|------|------|
| **核心理念** | 「文字是主角，UI 是配角」|
| **設計風格** | Content-First Minimalism（內容優先極簡主義） |
| **視覺靈感** | 高質感紙質感 × 現代無襯線字型 × 日式設計留白美學 |
| **競品參考** | 起點中文網（功能深度）× Medium（排版美學）× Notion（簡潔哲學） |

---

## 二、色彩系統（Color Tokens）

### 淺色模式 Light Mode — 閱讀白紙主題

| Token | 色碼 | CSS Variable | 說明 |
|-------|------|--------------|------|
| Primary | `#3D2B1F` | `--color-primary` | 深咖啡墨色，主標題 |
| Secondary | `#92400E` | `--color-secondary` | 暖琥珀棕，輔助強調 |
| Accent / CTA | `#D97706` | `--color-accent` | 金黃色，行動呼籲按鈕 |
| Background | `#FDFAF5` | `--color-bg` | 暖白紙色 |
| Foreground | `#1A1A1A` | `--color-fg` | 正文墨色 |
| Surface | `#FFFFFF` | `--color-surface` | 卡片、彈窗背景 |
| Muted | `#F5F0E8` | `--color-muted` | 柔性分區背景 |
| Border | `#E8E0D4` | `--color-border` | 細線、分隔線 |
| Subtle | `#78716C` | `--color-subtle` | 副文字、Metadata |

### 深色模式 Dark Mode — 夜間閱讀主題

| Token | 色碼 | CSS Variable | 說明 |
|-------|------|--------------|------|
| Primary | `#E8DCC8` | `--color-primary` | 暖米白，主標題 |
| Background | `#0F0E0C` | `--color-bg` | 深炭黑，護眼底色 |
| Foreground | `#D4C9B5` | `--color-fg` | 正文暖灰 |
| Surface | `#1C1A17` | `--color-surface` | 卡片背景 |
| Accent | `#F59E0B` | `--color-accent` | 強調金 |
| Border | `#2E2A25` | `--color-border` | 微妙邊框 |
| Subtle | `#6B6560` | `--color-subtle` | 次要文字 |

### 護眼模式 Eye-Care Mode — 閱讀頁專屬

| Token | 色碼 | 說明 |
|-------|------|------|
| 背景 | `#F2EBDD` | 暖黃羊皮紙色 |
| 正文 | `#3A2E22` | 深棕墨色 |
| Surface | `#EDE5D3` | 卡片背景 |
| Accent | `#B45309` | 深金棕強調 |
| Toolbar | `rgba(242,235,221,0.92)` | 半透明毛玻璃 |

---

## 三、字體系統（Typography）

```css
/* 標題字族 */
--font-heading: 'Noto Serif TC', 'Noto Serif', 'Georgia', serif;

/* 正文字族 */
--font-body: 'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', sans-serif;

/* UI 介面字族 */
--font-ui: 'Inter', 'Noto Sans TC', system-ui, sans-serif;

/* 程式碼字族 */
--font-mono: 'JetBrains Mono', 'Fira Code', monospace;
```

### 字體尺寸階層（Type Scale）

| Token | 尺寸 | 用途 |
|-------|------|------|
| `--text-xs` | 12px | 標籤、版權、時間戳 |
| `--text-sm` | 14px | 副標、Metadata、按鈕 |
| `--text-base` | 16px | 閱讀正文（預設） |
| `--text-md` | 18px | 卡片標題 |
| `--text-lg` | 20px | 章節標題 |
| `--text-xl` | 24px | 頁面副標題 |
| `--text-2xl` | 32px | 頁面主標題 |
| `--text-3xl` | 48px | Hero 大標 |
| `--text-4xl` | 64px | 超大展示標題 |

**閱讀頁可調範圍：** 14px / 18px / 22px（三段快速切換）

---

## 四、間距系統（Spacing Scale）

以 **8px 基準格** 建立：

```
--space-1:  4px   最小微間距
--space-2:  8px   元素內部
--space-3:  12px  緊密卡片
--space-4:  16px  標準間距
--space-5:  24px  區塊內部
--space-6:  32px  卡片間距
--space-8:  48px  Section 間距
--space-10: 64px  大區塊間距
--space-12: 96px  Hero 大留白
```

---

## 五、圓角系統（Border Radius）

| Token | 值 | 用途 |
|-------|-----|------|
| `--radius-sm` | 4px | 標籤、Badge |
| `--radius-md` | 8px | 按鈕、輸入框 |
| `--radius-lg` | 12px | 卡片 |
| `--radius-xl` | 16px | 模態窗、大卡 |
| `--radius-full` | 9999px | 圓形頭像、Pill 標籤 |

---

## 六、動態規範（Motion System）

| 場景 | GSAP 方案 | 時長 | 緩動 |
|------|-----------|------|------|
| 頁面載入 - 卡片入場 | `gsap.from('.card', { opacity:0, y:12, stagger:0.05 })` | 350ms | `power1.out` |
| Hero 標題入場 | `gsap.from('.hero-title', { opacity:0, y:24 })` | 700ms | `expo.out` |
| 捲動揭示 | ScrollTrigger + `{ opacity:0, y:12 }` | 350ms | `power1.out` |
| 閱讀進度條 | CSS `scaleX()` + JS 動態更新 | 即時 | `none` |
| 工具欄顯示/隱藏 | `gsap.to('.toolbar', { autoAlpha:1, y:0 })` | 200ms | `power2.out` |
| 頁面切換 | `gsap.fromTo` 淡入淡出 | 300ms | `power2.inOut` |

> ⚠️ **可及性**：所有動畫透過 `gsap.matchMedia()` 偵測 `prefers-reduced-motion`，啟用時 `duration` 一律設為 `0`。

---

## 七、響應式斷點（Breakpoints）

| 名稱 | 寬度 | 用途 |
|------|------|------|
| `sm` | 375px | 手機 |
| `md` | 768px | 平板 |
| `lg` | 1024px | 桌電小 |
| `xl` | 1440px | 桌電大 |

```css
/* 使用方式 */
@media (max-width: 768px) { /* 手機端調整 */ }
@media (min-width: 1024px) { /* 桌電端增強 */ }
```

---

## 八、元件清單（Component Inventory）

### 基礎元件（Phase 1）

| 元件 | 路徑 | 變體 |
|------|------|------|
| Button | `components/ui/Button.tsx` | primary / secondary / ghost / danger |
| Badge | `components/ui/Badge.tsx` | 各分類標籤 |
| Card | `components/ui/Card.tsx` | 書籍卡片（含封面、標題、作者） |
| Avatar | `components/ui/Avatar.tsx` | sm / md / lg |
| Input | `components/ui/Input.tsx` | text / password / search |
| Textarea | `components/ui/Textarea.tsx` | — |
| Modal | `components/ui/Modal.tsx` | 含動畫 |
| Drawer | `components/ui/Drawer.tsx` | left / right / bottom |
| Tabs | `components/ui/Tabs.tsx` | 水平 / 垂直 |
| Progress | `components/ui/Progress.tsx` | 線性進度條 |

---

## 九、主題切換機制

透過 `data-theme` attribute 掛載於 `<html>` 元素：

```html
<html data-theme="light">  <!-- 白紙模式（預設） -->
<html data-theme="dark">   <!-- 夜間模式 -->
<html data-theme="eyecare"> <!-- 護眼模式 -->
```

- 偏好儲存於 `localStorage('novelsite-theme')`
- 系統深色模式自動切換（`prefers-color-scheme: dark`）
- ThemeProvider 包裹整個 App，提供 `useTheme()` hook

---

## 十、閱讀頁 UX 規範

| 原則 | 參數 |
|------|------|
| 最佳行寬 | `max-width: 680px`（約 35 字/行） |
| 舒適行距 | `line-height: 1.9 ~ 2.0` |
| 字間距 | `letter-spacing: 0.04em` |
| 段落間距 | `margin-bottom: 1.5em` |
| 背景色 | `#FDFAF5`（暖白）/ `#F2EBDD`（護眼）/ `#0F0E0C`（夜間） |
| 字色 | `#2D2A27`（深暖棕），WCAG AA 合規 |
