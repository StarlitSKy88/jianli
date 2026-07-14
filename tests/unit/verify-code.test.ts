/**
 * 验证码服务单元测试
 *
 * 用 mock Prisma 隔离数据库，验证：
 * - 邮箱格式校验
 * - 60s 冷却逻辑
 * - 6 位数字生成
 * - 一次性消费（清空 verifyCode）
 * - 过期判断
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock 会被 hoist 到文件顶部，所以 mock factory 引用的变量也必须 hoist
const { mockUserFindUnique, mockUserUpsert, mockUserUpdate } = vi.hoisted(() => ({
  mockUserFindUnique: vi.fn(),
  mockUserUpsert: vi.fn(),
  mockUserUpdate: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    user: {
      findUnique: mockUserFindUnique,
      upsert: mockUserUpsert,
      update: mockUserUpdate,
    },
  },
}));

vi.mock('@/lib/email', () => ({
  getEmailSender: () => ({
    send: vi.fn().mockResolvedValue({ ok: true, messageId: 'mock-1' }),
  }),
}));

import { sendVerifyCode, consumeVerifyCode } from '@/lib/auth/verify-code';

describe('verify-code: sendVerifyCode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects invalid email', async () => {
    const r = await sendVerifyCode('not-an-email');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('INVALID_EMAIL');
  });

  it('returns USER_EXISTS for already-registered email', async () => {
    mockUserFindUnique.mockResolvedValueOnce({
      id: 'u1',
      verifyExpiry: null,
      emailVerified: true,
      passwordHash: '$2b$10$abcdefghijklmnopqrstuv', // bcrypt hash
    });
    const r = await sendVerifyCode('exists@jianli.app');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('USER_EXISTS');
  });

  it('allows resend for pending user (not yet registered)', async () => {
    // pending user: passwordHash='' 视为未注册
    mockUserFindUnique.mockResolvedValueOnce({
      id: 'u-pending',
      verifyExpiry: null,
      emailVerified: false,
      passwordHash: '',
    });
    mockUserUpsert.mockResolvedValueOnce({
      id: 'u-pending',
      verifyExpiry: null,
    });
    mockUserUpdate.mockResolvedValueOnce({});

    const r = await sendVerifyCode('pending@jianli.app');
    expect(r.ok).toBe(true);
  });

  it('creates a pending user + 6-digit code for new email', async () => {
    mockUserFindUnique.mockResolvedValueOnce(null);
    mockUserUpsert.mockResolvedValueOnce({ id: 'u-new', verifyExpiry: null });
    mockUserUpdate.mockResolvedValueOnce({});

    const r = await sendVerifyCode('new@jianli.app');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.cooldownSec).toBe(60);

    // 验证生成的 code 是 6 位数字
    const updateCall = mockUserUpdate.mock.calls[0][0];
    expect(updateCall.data.verifyCode).toMatch(/^\d{6}$/);
    expect(updateCall.data.verifyExpiry).toBeInstanceOf(Date);
    // 10 分钟 = 600000ms
    const ttlMs = updateCall.data.verifyExpiry.getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(590_000);
    expect(ttlMs).toBeLessThan(610_000);
  });

  it('enforces 60s cooldown when previous code is still fresh', async () => {
    mockUserFindUnique.mockResolvedValueOnce(null);
    // 上一次发送在 30 秒前（剩余 9 分 30 秒，elapsed = 30s < 60s cooldown）
    mockUserUpsert.mockResolvedValueOnce({
      id: 'u-cool',
      verifyExpiry: new Date(Date.now() + (10 * 60 - 30) * 1000),
    });

    const r = await sendVerifyCode('cooldown@jianli.app');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('COOLDOWN');
  });

  it('allows resend when previous code is older than cooldown', async () => {
    mockUserFindUnique.mockResolvedValueOnce(null);
    // 上一次发送在 70 秒前（剩余约 8 分 50 秒，elapsed = 70s > 60s cooldown）
    mockUserUpsert.mockResolvedValueOnce({
      id: 'u-old',
      verifyExpiry: new Date(Date.now() + (10 * 60 - 70) * 1000),
    });
    mockUserUpdate.mockResolvedValueOnce({});

    const r = await sendVerifyCode('old@jianli.app');
    expect(r.ok).toBe(true);
  });
});

describe('verify-code: consumeVerifyCode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns NOT_FOUND when user does not exist', async () => {
    mockUserFindUnique.mockResolvedValueOnce(null);
    const r = await consumeVerifyCode('ghost@jianli.app', '123456');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('NOT_FOUND');
  });

  it('returns NOT_FOUND when user has no pending code', async () => {
    mockUserFindUnique.mockResolvedValueOnce({
      id: 'u1',
      verifyCode: null,
      verifyExpiry: null,
    });
    const r = await consumeVerifyCode('new@jianli.app', '123456');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('NOT_FOUND');
  });

  it('returns EXPIRED when expiry passed', async () => {
    mockUserFindUnique.mockResolvedValueOnce({
      id: 'u1',
      verifyCode: '123456',
      verifyExpiry: new Date(Date.now() - 1000),
    });
    const r = await consumeVerifyCode('exp@jianli.app', '123456');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('EXPIRED');
  });

  it('returns MISMATCH when code differs', async () => {
    mockUserFindUnique.mockResolvedValueOnce({
      id: 'u1',
      verifyCode: '654321',
      verifyExpiry: new Date(Date.now() + 60_000),
    });
    const r = await consumeVerifyCode('mm@jianli.app', '123456');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('MISMATCH');
  });

  it('succeeds + clears verifyCode on correct match (one-time use)', async () => {
    mockUserFindUnique.mockResolvedValueOnce({
      id: 'u1',
      verifyCode: '888888',
      verifyExpiry: new Date(Date.now() + 60_000),
    });
    mockUserUpdate.mockResolvedValueOnce({});

    const r = await consumeVerifyCode('ok@jianli.app', '888888');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.userId).toBe('u1');

    // 关键：清空 verifyCode + 标记 emailVerified
    const updateCall = mockUserUpdate.mock.calls[0][0];
    expect(updateCall.data.verifyCode).toBeNull();
    expect(updateCall.data.verifyExpiry).toBeNull();
    expect(updateCall.data.emailVerified).toBe(true);
  });
});
