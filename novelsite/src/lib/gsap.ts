/**
 * NovelSite GSAP 初始化與工具函式
 * ====================================
 * 全域動畫設定、ScrollTrigger 註冊、matchMedia 減少動態
 */

'use client';

import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

// ─────────────────────────────────────────────
// 插件註冊
// ─────────────────────────────────────────────
if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger);
}

// ─────────────────────────────────────────────
// 全域預設值
// ─────────────────────────────────────────────
gsap.defaults({
  ease: 'power1.out',
  duration: 0.35,
});

// ─────────────────────────────────────────────
// matchMedia — 偵測 prefers-reduced-motion
// ─────────────────────────────────────────────
export const mm = gsap.matchMedia();

/**
 * 建立支援 prefers-reduced-motion 的動畫
 *
 * 使用方式：
 * ```ts
 * withReducedMotion((isReduced) => {
 *   gsap.from('.card', { opacity: 0, y: isReduced ? 0 : 12, duration: isReduced ? 0 : 0.35 });
 * });
 * ```
 */
export function withReducedMotion(
  callback: (conditions: { isReduced: boolean; prefersMotion: boolean }) => void
) {
  mm.add(
    {
      prefersMotion: '(prefers-reduced-motion: no-preference)',
      isReduced: '(prefers-reduced-motion: reduce)',
    },
    (context) => {
      const { prefersMotion, isReduced } = context.conditions as {
        prefersMotion: boolean;
        isReduced: boolean;
      };
      callback({ isReduced, prefersMotion });
    }
  );
}

// ─────────────────────────────────────────────
// 預設動畫 Preset（依 plan.md 動態規範）
// ─────────────────────────────────────────────

/**
 * 卡片入場動畫（Stagger）
 * 時長：350ms | 緩動：power1.out
 */
export function animateCardsIn(
  targets: gsap.TweenTarget,
  options?: { stagger?: number; delay?: number }
) {
  return withReducedMotion(({ isReduced }) => {
    gsap.from(targets, {
      opacity: 0,
      y: isReduced ? 0 : 12,
      duration: isReduced ? 0 : 0.35,
      stagger: isReduced ? 0 : (options?.stagger ?? 0.05),
      delay: options?.delay ?? 0,
      ease: 'power1.out',
      clearProps: 'opacity,transform',
    });
  });
}

/**
 * Hero 標題入場動畫
 * 時長：700ms | 緩動：expo.out
 */
export function animateHeroIn(targets: gsap.TweenTarget) {
  return withReducedMotion(({ isReduced }) => {
    gsap.from(targets, {
      opacity: 0,
      y: isReduced ? 0 : 24,
      duration: isReduced ? 0 : 0.7,
      ease: 'expo.out',
      clearProps: 'opacity,transform',
    });
  });
}

/**
 * ScrollTrigger 揭示動畫
 * 時長：350ms | 緩動：power1.out
 */
export function animateOnScroll(
  targets: string,
  options?: { stagger?: number; threshold?: string }
) {
  return withReducedMotion(({ isReduced }) => {
    gsap.from(targets, {
      opacity: 0,
      y: isReduced ? 0 : 12,
      duration: isReduced ? 0 : 0.35,
      stagger: isReduced ? 0 : (options?.stagger ?? 0),
      ease: 'power1.out',
      scrollTrigger: {
        trigger: targets,
        start: options?.threshold ?? 'top 85%',
        once: true,
      },
      clearProps: 'opacity,transform',
    });
  });
}

/**
 * 工具欄顯示/隱藏
 * 時長：200ms | 緩動：power2.out
 */
export function toggleToolbar(element: gsap.TweenTarget, visible: boolean) {
  return withReducedMotion(({ isReduced }) => {
    gsap.to(element, {
      autoAlpha: visible ? 1 : 0,
      y: visible ? 0 : isReduced ? 0 : 8,
      duration: isReduced ? 0 : 0.2,
      ease: 'power2.out',
    });
  });
}

/**
 * 頁面淡入淡出切換
 * 時長：300ms | 緩動：power2.inOut
 */
export function pageTransition(element: gsap.TweenTarget, entering: boolean) {
  return withReducedMotion(({ isReduced }) => {
    gsap.fromTo(
      element,
      { opacity: entering ? 0 : 1 },
      {
        opacity: entering ? 1 : 0,
        duration: isReduced ? 0 : 0.3,
        ease: 'power2.inOut',
      }
    );
  });
}

// 重新導出 gsap 與 ScrollTrigger，方便其他模組使用
export { gsap, ScrollTrigger };
export default gsap;
