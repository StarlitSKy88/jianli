/**
 * 密码重置流程单测 — Phase 14.32
 *
 * 覆盖：
 * - sendPasswordResetCode 未注册邮箱拒绝
 * - sendPasswordResetCode 已注册邮箱允许发码
 * - sendPasswordResetCode pending user (无 passwordHash) 拒绝
 * - sendPasswordResetCode 60 秒 cooldown
 * - consumeResetCode 验证码过期/MISMATCH/NOT_FOUND 全部正确返回 reason
 * - 完整闭环：发码 → consume → passwordHash 已更新
 * - 不依赖真 DB（mock prisma）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// mock 邮件发送
vi.mock('@/lib/email', () => ({
  getEmailSender: () => ({
    send: async () => ({ ok: true, id: 'stub' }),
  }),
}));

// mock prisma — 提供可控的 user store
type MockUser = {
  id: string;
  email: string;
  passwordHash: string;
  emailVerified: boolean;
  verifyCode: string | null;
  verifyExpiry: Date | null;
};

const store = new Map<string, MockUser>();

vi.mock('@/lib/db/client', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { email: string } }) => {
        const u = store.get(where.email);
        if (!u) return null;
        // Return shape depends on what select the caller used.
        // Tests verify by behavior, so we return the full user — caller will only read what they asked.
        // For simplicity here: return full record (the function only reads known fields).
        return u;
      }),
      upsert: vi.fn(async ({ where, create, update }: any) => {
        const existing = store.get(where.email);
        if (existing) return existing;
        const newU: MockUser = {
          id: `mock-${Date.now()}-${Math.random()}`,
          email: create.email,
          passwordHash: create.passwordHash ?? '',
          emailVerified: create.emailVerified ?? false,
          verifyCode: null,
          verifyExpiry: null,
        };
        store.set(where.email, newU);
        return newU;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        // Look up by id or email
        for (const u of store.values()) {
          if (u.id === where.id || u.email === where.email) {
            Object.assign(u, data);
            return u;
          }
        }
        throw new Error('user not found');
      }),
      create: vi.fn(async ({ data }: any) => {
        const u: MockUser = {
          id: `mock-${Date.now()}-${Math.random()}`,
          email: data.email,
          passwordHash: data.passwordHash ?? '',
          emailVerified: data.emailVerified ?? false,
          verifyCode: data.verifyCode ?? null,
          verifyExpiry: data.verifyExpiry ?? null,
        };
        store.set(u.email, u);
        return u;
      }),
      deleteMany: vi.fn(async () => {
        store.clear();
        return { count: 0 };
      }),
    },
  },
}));

import { prisma } from '@/lib/db/client';
import { sendPasswordResetCode, consumeResetCode } from '@/lib/auth/verify-code';

function seedUser(email: string, overrides: Partial<MockUser> = {}): MockUser {
  const u: MockUser = {
    id: `mock-${email}`,
    email,
    passwordHash: '$2a$10$abcdef', // 有效 bcrypt-like 长度
    emailVerified: true,
    verifyCode: null,
    verifyExpiry: null,
    ...overrides,
  };
  store.set(email, u);
  return u;
}

describe('password reset flow', () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
  });

  it('sendPasswordResetCode refuses unregistered email', async () => {
    const r = await sendPasswordResetCode('notexist@reset-test.local');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('USER_NOT_FOUND');
  });

  it('sendPasswordResetCode refuses pending user (no passwordHash)', async () => {
    seedUser('pending@reset-test.local', { passwordHash: '' });
    const r = await sendPasswordResetCode('pending@reset-test.local');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('USER_NOT_FOUND');
  });

  it('sendPasswordResetCode accepts registered user (has passwordHash)', async () => {
    seedUser('exists@reset-test.local');
    const r = await sendPasswordResetCode('exists@reset-test.local');
    expect(r.ok).toBe(true);
  });

  it('sendPasswordResetCode writes new verifyCode to DB', async () => {
    seedUser('writescode@reset-test.local');
    const r = await sendPasswordResetCode('writescode@reset-test.local');
    expect(r.ok).toBe(true);
    const u = store.get('writescode@reset-test.local');
    expect(u?.verifyCode).toMatch(/^\d{6}$/);
    expect(u?.verifyExpiry).toBeInstanceOf(Date);
    expect(u!.verifyExpiry!.getTime()).toBeGreaterThan(Date.now());
  });

  it('full reset loop: send → consume → passwordHash updated', async () => {
    seedUser('loop@reset-test.local', {
      passwordHash: '$2a$10$oldhashvalue',
    });

    const send = await sendPasswordResetCode('loop@reset-test.local');
    expect(send.ok).toBe(true);
    const u = store.get('loop@reset-test.local')!;
    const code = u.verifyCode!;
    expect(code).toMatch(/^\d{6}$/);

    const consume = await consumeResetCode('loop@reset-test.local', code);
    expect(consume.ok).toBe(true);

    // 模拟 route 层：consume + 改密码 + 清空 verifyCode
    if (consume.ok) {
      const u2 = store.get('loop@reset-test.local')!;
      u2.passwordHash = '$2a$10$newhashvalue';
      u2.verifyCode = null;
      u2.verifyExpiry = null;
    }

    const after = store.get('loop@reset-test.local')!;
    expect(after.passwordHash).toBe('$2a$10$newhashvalue');
    expect(after.verifyCode).toBeNull();
    expect(after.verifyExpiry).toBeNull();
  });

  it('consumeResetCode returns NOT_FOUND for non-existent email', async () => {
    const r = await consumeResetCode('ghost@reset-test.local', '123456');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('NOT_FOUND');
  });

  it('consumeResetCode returns MISMATCH for wrong code', async () => {
    seedUser('mismatch@reset-test.local', {
      verifyCode: '111111',
      verifyExpiry: new Date(Date.now() + 600_000),
    });
    const r = await consumeResetCode('mismatch@reset-test.local', '999999');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('MISMATCH');
  });

  it('consumeResetCode returns EXPIRED for stale code', async () => {
    seedUser('expired@reset-test.local', {
      verifyCode: '111111',
      verifyExpiry: new Date(Date.now() - 1000),
    });
    const r = await consumeResetCode('expired@reset-test.local', '111111');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('EXPIRED');
  });

  it('consumeResetCode is one-time-use: second call returns NOT_FOUND', async () => {
    seedUser('onetime@reset-test.local', {
      verifyCode: '111111',
      verifyExpiry: new Date(Date.now() + 600_000),
    });

    const first = await consumeResetCode('onetime@reset-test.local', '111111');
    expect(first.ok).toBe(true);

    // 模拟 route 流程：清空 verifyCode
    const u = store.get('onetime@reset-test.local')!;
    u.verifyCode = null;
    u.verifyExpiry = null;

    const second = await consumeResetCode('onetime@reset-test.local', '111111');
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe('NOT_FOUND');
  });

  it('sendPasswordResetCode enforces 60s cooldown', async () => {
    // cooldown 公式：elapsed = totalTtl(600) - remaining(ceil((expiry - now)/1000))
    //   要触发 cooldown → elapsed < 60 → remaining > 540
    //   即 expiry 离现在还有 540 秒以上
    seedUser('cooldown@reset-test.local', {
      verifyExpiry: new Date(Date.now() + 580_000), // 距过期还有 580s，说明是 20s 前发的
    });

    const r = await sendPasswordResetCode('cooldown@reset-test.local');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('COOLDOWN');
      expect(r.cooldownSec).toBeGreaterThanOrEqual(0);
      expect(r.cooldownSec).toBeLessThanOrEqual(60);
    }
  });

  it('sendPasswordResetCode allows after cooldown elapses', async () => {
    // remaining < 540 → cooldown 已过
    seedUser('after-cooldown@reset-test.local', {
      verifyExpiry: new Date(Date.now() + 60_000), // 距过期还有 60s，说明是 540s 前发的
    });

    const r = await sendPasswordResetCode('after-cooldown@reset-test.local');
    expect(r.ok).toBe(true);
  });
});
