import { describe, expect, it } from 'vitest';
import { buildCspPolicy } from '@/lib/security/csp';

function scriptSrcOf(policy: string): string {
  const match = policy.match(/script-src ([^;]+)/);
  if (!match) throw new Error('policy 缺少 script-src');
  return match[1];
}

function styleSrcOf(policy: string): string {
  const match = policy.match(/style-src ([^;]+)/);
  if (!match) throw new Error('policy 缺少 style-src');
  return match[1];
}

function fontSrcOf(policy: string): string {
  const match = policy.match(/font-src ([^;]+)/);
  if (!match) throw new Error('policy 缺少 font-src');
  return match[1];
}

function connectSrcOf(policy: string): string {
  const match = policy.match(/connect-src ([^;]+)/);
  if (!match) throw new Error('policy 缺少 connect-src');
  return match[1];
}

function imgSrcOf(policy: string): string {
  const match = policy.match(/img-src ([^;]+)/);
  if (!match) throw new Error('policy 缺少 img-src');
  return match[1];
}

describe('buildCspPolicy', () => {
  it('正式模式（isDev: false）不含 unsafe-inline / unsafe-eval，且 script-src 含 strict-dynamic 與 nonce', () => {
    const policy = buildCspPolicy('abc123', { isDev: false });
    const scriptSrc = scriptSrcOf(policy);
    expect(scriptSrc).not.toContain('unsafe-inline');
    expect(scriptSrc).not.toContain('unsafe-eval');
    expect(scriptSrc).toContain(`'strict-dynamic'`);
    expect(scriptSrc).toContain(`'nonce-abc123'`);
  });

  it('開發模式（isDev: true）僅 script-src 多出 unsafe-eval', () => {
    const prod = buildCspPolicy('same-nonce', { isDev: false });
    const dev = buildCspPolicy('same-nonce', { isDev: true });
    expect(scriptSrcOf(dev)).toContain('unsafe-eval');
    expect(scriptSrcOf(prod)).not.toContain('unsafe-eval');

    // 移除 unsafe-eval 差異後，其餘部分應完全相同
    const devWithoutEval = dev.replace(` 'unsafe-eval'`, '');
    expect(devWithoutEval).toBe(prod);
  });

  it('style-src 兩種模式皆含 unsafe-inline（唯一既有例外）', () => {
    expect(styleSrcOf(buildCspPolicy('n', { isDev: false }))).toContain('unsafe-inline');
    expect(styleSrcOf(buildCspPolicy('n', { isDev: true }))).toContain('unsafe-inline');
  });

  it('style-src／font-src 含 Google Fonts 白名單，讓 design-tokens.css 的 @import 不被強制 CSP 擋下', () => {
    const policy = buildCspPolicy('n', { isDev: false });
    expect(styleSrcOf(policy)).toContain('https://fonts.googleapis.com');
    expect(fontSrcOf(policy)).toContain('https://fonts.gstatic.com');
  });

  it('connect-src 含 https://www.google.com，讓 GA4 gtag.js 的 /g/collect 回傳事件不被擋下', () => {
    expect(connectSrcOf(buildCspPolicy('n', { isDev: false }))).toContain('https://www.google.com');
  });

  it('img-src 含 https://www.googletagmanager.com，讓 GTM 的追蹤像素不被擋下', () => {
    expect(imgSrcOf(buildCspPolicy('n', { isDev: false }))).toContain(
      'https://www.googletagmanager.com'
    );
  });
});
