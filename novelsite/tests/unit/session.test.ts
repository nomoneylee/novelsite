import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockCreate, mockFindByTokenHash, mockTouch, mockRevoke, mockRevokeAllForUser } = vi.hoisted(
  () => ({
    mockCreate: vi.fn(),
    mockFindByTokenHash: vi.fn(),
    mockTouch: vi.fn(),
    mockRevoke: vi.fn(),
    mockRevokeAllForUser: vi.fn(),
  })
);

vi.mock('@/lib/repositories', () => ({
  sessionsRepo: {
    create: mockCreate,
    findByTokenHash: mockFindByTokenHash,
    touch: mockTouch,
    revoke: mockRevoke,
    revokeAllForUser: mockRevokeAllForUser,
  },
}));

import {
  signSessionToken,
  verifyClaimsOnly,
  SESSION_COOKIE,
  type Role,
} from '@/lib/auth/sessionToken';
import {
  issueSession,
  readSession,
  revokeSession,
  revokeAllSessionsForUser,
} from '@/lib/auth/session';
import { env } from '@/lib/env';

const DAY_MS = 86_400_000;

function fakeSessionRow(overrides: Partial<Record<string, unknown>> = {}) {
  const now = Date.now();
  return {
    id: 'sid-1',
    userId: 'uid-1',
    tokenHash: 'irrelevant-for-mock',
    expiresAt: new Date(now + 10 * DAY_MS),
    revokedAt: null as Date | null,
    userAgent: '',
    ip: '',
    createdAt: new Date(now - DAY_MS),
    lastUsedAt: new Date(now),
    ...overrides,
  };
}

describe('sessionToken（純憑證層，零 I/O）', () => {
  it('簽發 → 驗證往返成功', async () => {
    const token = await signSessionToken({ sid: 's1', uid: 'u1', role: 'reader' });
    const claims = await verifyClaimsOnly(token);
    expect(claims).toEqual({ sid: 's1', uid: 'u1', role: 'reader' });
  });

  it('竄改 payload（含竄改 role）一律拒絕', async () => {
    const token = await signSessionToken({ sid: 's1', uid: 'u1', role: 'reader' });
    const parts = token.split('.');
    // 竄改 payload 段落
    const tamperedPayload = Buffer.from(
      JSON.stringify({ sid: 's1', uid: 'u1', role: 'admin' })
    ).toString('base64url');
    const tampered = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

    await expect(verifyClaimsOnly(tampered)).resolves.toBeNull();
  });

  it('未帶 token 時回傳 null', async () => {
    await expect(verifyClaimsOnly(undefined)).resolves.toBeNull();
  });

  it('SESSION_COOKIE.maxAge 等於 SESSION_ABSOLUTE_TTL_DAYS × 86400（不得為閒置期限）', () => {
    expect(SESSION_COOKIE.maxAge).toBe(env.SESSION_ABSOLUTE_TTL_DAYS * 86400);
    expect(SESSION_COOKIE.maxAge).not.toBe(env.SESSION_TTL_DAYS * 86400);
  });
});

describe('session（工作階段層，經 repository，MUST NOT 連真實資料庫）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockCreate.mockReset();
    mockFindByTokenHash.mockReset();
    mockTouch.mockReset();
    mockRevoke.mockReset();
    mockRevokeAllForUser.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('issueSession 寫入 Session 並回傳可驗證的 token', async () => {
    mockCreate.mockResolvedValue(undefined);
    const role: Role = 'author';
    const token = await issueSession({ id: 'uid-1', role }, { userAgent: 'ua', ip: '1.2.3.4' });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const createArg = mockCreate.mock.calls[0][0];
    expect(createArg.userId).toBe('uid-1');
    expect(createArg.userAgent).toBe('ua');
    expect(createArg.ip).toBe('1.2.3.4');

    const claims = await verifyClaimsOnly(token);
    expect(claims?.uid).toBe('uid-1');
    expect(claims?.role).toBe('author');
    expect(claims?.sid).toBe(createArg.id);
  });

  it('閒置逾期（expiresAt 已過）拒絕', async () => {
    const token = await signSessionToken({ sid: 'sid-1', uid: 'uid-1', role: 'reader' });
    mockFindByTokenHash.mockResolvedValue(
      fakeSessionRow({ expiresAt: new Date(Date.now() - 1000) })
    );

    await expect(readSession(token)).resolves.toBeNull();
  });

  it('撤銷後失效（revokedAt 已設定）', async () => {
    const token = await signSessionToken({ sid: 'sid-1', uid: 'uid-1', role: 'reader' });
    mockFindByTokenHash.mockResolvedValue(fakeSessionRow({ revokedAt: new Date() }));

    await expect(readSession(token)).resolves.toBeNull();
  });

  it('已停權使用者判定無效 Session（isSuspended: true）', async () => {
    const token = await signSessionToken({ sid: 'sid-1', uid: 'uid-1', role: 'reader' });
    mockFindByTokenHash.mockResolvedValue(
      fakeSessionRow({
        user: { isSuspended: true, role: 'reader' },
      })
    );

    await expect(readSession(token)).resolves.toBeNull();
  });

  it('節流門檻內不寫入，門檻過後才延展', async () => {
    const token = await signSessionToken({ sid: 'sid-1', uid: 'uid-1', role: 'reader' });
    const now = Date.now();
    mockFindByTokenHash.mockResolvedValue(
      fakeSessionRow({
        createdAt: new Date(now - DAY_MS),
        lastUsedAt: new Date(now), // 剛使用過
        expiresAt: new Date(now + 10 * DAY_MS),
      })
    );

    const result1 = await readSession(token);
    expect(result1).not.toBeNull();
    expect(mockTouch).not.toHaveBeenCalled();

    // 推進超過節流門檻（預設 24 小時）
    vi.setSystemTime(now + (env.SESSION_SLIDING_THROTTLE_HOURS + 1) * 3_600_000);
    const result2 = await readSession(token);
    expect(result2).not.toBeNull();
    expect(mockTouch).toHaveBeenCalledTimes(1);
    expect(mockTouch).toHaveBeenCalledWith('sid-1', expect.any(Date));
  });

  it('滑動延展 MUST NOT 突破絕對上限', async () => {
    const token = await signSessionToken({ sid: 'sid-1', uid: 'uid-1', role: 'reader' });
    const now = Date.now();
    const absoluteDeadline = now + DAY_MS; // 距絕對上限只剩 1 天
    mockFindByTokenHash.mockResolvedValue(
      fakeSessionRow({
        createdAt: new Date(absoluteDeadline - env.SESSION_ABSOLUTE_TTL_DAYS * DAY_MS),
        lastUsedAt: new Date(now - (env.SESSION_SLIDING_THROTTLE_HOURS + 1) * 3_600_000), // 已超過節流門檻
        expiresAt: new Date(now + 100), // 尚未過期，很快就要靠延展續命
      })
    );

    await readSession(token);
    expect(mockTouch).toHaveBeenCalledTimes(1);
    const newExpiresAt = mockTouch.mock.calls[0][1] as Date;
    // 新的 expiresAt 不得超過絕對上限（容許極小誤差）
    expect(newExpiresAt.getTime()).toBeLessThanOrEqual(absoluteDeadline + 5);
    expect(newExpiresAt.getTime()).toBeGreaterThan(now);
  });

  it('revokeSession 委派給 repository', async () => {
    await revokeSession('sid-xyz');
    expect(mockRevoke).toHaveBeenCalledWith('sid-xyz');
  });

  it('revokeAllSessionsForUser（改密碼後全數失效）委派給 repository', async () => {
    await revokeAllSessionsForUser('uid-xyz');
    expect(mockRevokeAllForUser).toHaveBeenCalledWith('uid-xyz');
  });
});
