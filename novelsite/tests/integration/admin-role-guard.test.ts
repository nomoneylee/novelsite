import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { testFetch, loginAs } from '../helpers/client';
import { createUser } from '../helpers/fixtures';
import { resetAuthTables } from '../helpers/resetAuthTables';
import { prisma } from '@/lib/db';

/**
 * FEAT-9 / 009-admin-dashboard US1: 管理者存取控制與權限驗證整合測試（T020）
 * ==============================================================================
 * (A) 靜態稽核：
 *     1. 掃描所有 src/app/admin/** /actions.ts 必須首行呼叫 requireAdminForAction()
 *     2. 掃描所有 src/app/admin/** /page.tsx 必須首行呼叫 requireAdmin()
 *     3. 嚴禁在 actions.ts 中直接 import @/lib/db 或 @/lib/repositories（憲章第 III 條）
 *
 * (B) 執行期測試：
 *     1. 未登入存取 /admin 轉向 /auth/login?next=/admin
 *     2. reader 與 author 存取 /admin 均被拒絕並轉向 /
 *     3. 停權帳號登入被阻斷且錯誤碼為 SUSPENDED
 *     4. 管理員帳號正常存取 /admin (200)
 *     5. requireAdminForAction() 執行期權限覆核阻斷（reader, author, suspended 皆拋出 FORBIDDEN）
 */

const REPO_SRC = path.resolve(__dirname, '../../src');
const ADMIN_DIR = path.resolve(REPO_SRC, 'app/admin');

function findFilesRecursive(dir: string, pattern: RegExp): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFilesRecursive(fullPath, pattern));
    } else if (pattern.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

describe('(A) 靜態稽核：管理後台端點授權前置', () => {
  const pageFiles = findFilesRecursive(ADMIN_DIR, /^page\.tsx$/);
  const actionFiles = findFilesRecursive(ADMIN_DIR, /^actions\.ts$/);

  it('至少存在管理後台入口 page.tsx', () => {
    expect(pageFiles.length).toBeGreaterThan(0);
  });

  for (const pageFile of pageFiles) {
    const relPath = path.relative(REPO_SRC, pageFile);
    it(`頁面 ${relPath} 必須首行呼叫 requireAdmin()`, () => {
      const content = fs.readFileSync(pageFile, 'utf8');
      expect(content).toContain('requireAdmin');
      // 確保不是純文字，而是實際呼叫
      expect(content).toMatch(/await\s+requireAdmin\s*\(/);
    });
  }

  for (const actionFile of actionFiles) {
    const relPath = path.relative(REPO_SRC, actionFile);
    it(`Action 模組 ${relPath} 嚴禁直接 import db 或 repositories（憲章第 III 條）`, () => {
      const content = fs.readFileSync(actionFile, 'utf8');
      expect(content).not.toContain("from '@/lib/db'");
      expect(content).not.toContain("from '@/lib/repositories'");
    });

    it(`Action 模組 ${relPath} 內的每個 Action 必須呼叫 requireAdminForAction()`, () => {
      const content = fs.readFileSync(actionFile, 'utf8');
      const actionMatches = [...content.matchAll(/export async function (\w+Action)\(/g)];
      for (const match of actionMatches) {
        const actionName = match[1];
        const actionIndex = content.indexOf(`export async function ${actionName}(`);
        const nextExport = content.indexOf('\nexport ', actionIndex + 1);
        const actionBody =
          nextExport === -1 ? content.slice(actionIndex) : content.slice(actionIndex, nextExport);
        const firstAwait = actionBody.indexOf('await ');
        expect(firstAwait, `${actionName} 內沒有 await`).toBeGreaterThan(-1);
        expect(
          actionBody.slice(firstAwait, firstAwait + 60),
          `${actionName} 的第一個 await 不是 requireAdminForAction()`
        ).toContain('requireAdminForAction()');
      }
    });
  }
});

describe('(B) 執行期測試：角色與權限守衛（US1）', () => {
  beforeAll(async () => {
    await resetAuthTables();
  });

  it('未登入存取 /admin：proxy 攔截轉向 /auth/login?next=/admin', async () => {
    const res = await testFetch('/admin', { ip: '10.90.1.1' });
    expect(res.status).toBe(302);
    const location = res.headers.get('location');
    expect(location).toContain('/auth/login');
    expect(location).toContain('next=%2Fadmin');
  });

  it('讀者（reader）存取 /admin：被拒絕並轉向首頁 /', async () => {
    const email = 'guard-reader@example.com';
    await createUser({ email, role: 'reader', password: 'Password123' });
    const cookie = await loginAs(email, 'Password123', '10.90.1.2');

    const res = await testFetch('/admin', { ip: '10.90.1.3', cookie });
    expect(res.status).toBe(302);
    const location = res.headers.get('location');
    expect(location).toMatch(/\/$|localhost(:\d+)?\/$/);
  });

  it('作者（author）存取 /admin：被拒絕並轉向首頁 /', async () => {
    const email = 'guard-author@example.com';
    await createUser({ email, role: 'author', password: 'Password123' });
    const cookie = await loginAs(email, 'Password123', '10.90.1.4');

    const res = await testFetch('/admin', { ip: '10.90.1.5', cookie });
    expect(res.status).toBe(302);
    const location = res.headers.get('location');
    expect(location).toMatch(/\/$|localhost(:\d+)?\/$/);
  });

  it('已停權使用者登入被阻斷：回傳 SUSPENDED 錯誤碼', async () => {
    const email = 'suspended-user@example.com';
    const user = await createUser({ email, role: 'reader', password: 'Password123' });
    await prisma.user.update({
      where: { id: user.id },
      data: { isSuspended: true, suspendedAt: new Date() },
    });

    const res = await testFetch('/api/auth/login', {
      method: 'POST',
      ip: '10.90.1.6',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Password123' }),
    });

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error?.code).toBe('SUSPENDED');
  });

  it('正常管理員（admin）存取 /admin：放行成功 (200)', async () => {
    const email = 'guard-admin@example.com';
    await createUser({ email, role: 'admin', password: 'Password123' });
    const cookie = await loginAs(email, 'Password123', '10.90.1.7');

    const res = await testFetch('/admin', { ip: '10.90.1.8', cookie });
    expect(res.status).toBe(200);
  });

  it('已停權之管理員存取 /admin：Session 判定無效並轉向登入頁', async () => {
    const email = 'suspended-admin@example.com';
    const admin = await createUser({ email, role: 'admin', password: 'Password123' });
    const cookie = await loginAs(email, 'Password123', '10.90.1.9');

    // 停權管理員
    await prisma.user.update({
      where: { id: admin.id },
      data: { isSuspended: true, suspendedAt: new Date() },
    });

    const res = await testFetch('/admin', { ip: '10.90.1.10', cookie });
    expect([302, 307]).toContain(res.status);
    const location = res.headers.get('location');
    expect(location).toContain('/auth/login');
    expect(location).toMatch(/next=(%2Fadmin|\/admin)/);
  });
});
