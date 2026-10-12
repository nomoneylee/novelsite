import { ImageResponse } from 'next/og';

// 全站預設 Open Graph 分享圖（建置時靜態產生並快取）
export const alt = 'NovelSite — 繁體中文原創文學平台';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #3D2B1F 0%, #92400E 55%, #D97706 100%)',
        color: '#FDFAF5',
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ fontSize: 120, fontWeight: 700, letterSpacing: '0.04em' }}>NovelSite</div>
      <div style={{ marginTop: 24, fontSize: 40, opacity: 0.92 }}>繁體中文原創文學平台</div>
      <div style={{ marginTop: 48, fontSize: 26, opacity: 0.8 }}>
        沉浸式閱讀 · 內容優先 · 極簡現代
      </div>
    </div>,
    { ...size }
  );
}
