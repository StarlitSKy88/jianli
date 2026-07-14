/**
 * Phase 7 集成测试 — 不依赖 prisma（mock）
 * 真实集成测试在 Phase 8 跑 E2E
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  prisma: {
    rateLimit: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    trackEvent: {
      create: vi.fn().mockResolvedValue({ id: 'evt-1' }),
    },
  },
}));

import { prisma } from '@/lib/db/client';
import { checkLimit } from '../../lib/utils/rate-limit';
import { track } from '../../lib/analytics/track';

const mockPrisma = vi.mocked(prisma);

beforeEach(() => {
  (mockPrisma.rateLimit.findUnique as unknown as { mockReset: () => void }).mockReset();
  (mockPrisma.rateLimit.upsert as unknown as { mockReset: () => void }).mockReset();
  (mockPrisma.user.findUnique as unknown as { mockReset: () => void }).mockReset();
  (mockPrisma.user.updateMany as unknown as { mockReset: () => void }).mockReset();
  (mockPrisma.trackEvent.create as unknown as { mockClear: () => void }).mockClear();
});

/** 辅助：mock 一个免费用户（paidQuota=0） */
function mockFreeUser(paidQuota = 0) {
  (
    mockPrisma.user.findUnique as unknown as { mockResolvedValue: (v: unknown) => void }
  ).mockResolvedValue({ paidQuota });
}

describe('rate-limit — free quota', () => {
  it('allows up to 3 free calls per day', async () => {
    mockFreeUser(0);
    let count = 0;
    (
      mockPrisma.rateLimit.findUnique as unknown as { mockResolvedValue: (v: unknown) => void }
    ).mockResolvedValue(null);
    (
      mockPrisma.rateLimit.upsert as unknown as {
        mockImplementation: (fn: () => Promise<unknown>) => void;
      }
    ).mockImplementation(async () => ({ count: ++count }));

    const r1 = await checkLimit('u1', 'message');
    const r2 = await checkLimit('u1', 'message');
    const r3 = await checkLimit('u1', 'message');
    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    expect(r3.allowed).toBe(true);
    expect(r3.remaining).toBe(0);
  });

  it('blocks 4th free call (拒前先查 count)', async () => {
    mockFreeUser(0);
    // 已用过 3 次
    (
      mockPrisma.rateLimit.findUnique as unknown as { mockResolvedValue: (v: unknown) => void }
    ).mockResolvedValue({ count: 3 });
    const r = await checkLimit('u1', 'message');
    expect(r.allowed).toBe(false);
    expect(r.remaining).toBe(0);
    expect(r.reason).toBe('quota_exhausted');
  });
});

describe('rate-limit — paid quota', () => {
  it('paid user with paidQuota>0 decrements and allows', async () => {
    mockFreeUser(2); // 有 2 次付费
    (
      mockPrisma.user.updateMany as unknown as { mockResolvedValue: (v: unknown) => void }
    ).mockResolvedValue({ count: 1 });

    const r = await checkLimit('u1', 'message');
    expect(r.allowed).toBe(true);
    expect(r.paid).toBe(true);
    expect(r.remaining).toBe(1);
  });

  it('paid user paidQuota=0 falls back to free quota check', async () => {
    mockFreeUser(0); // 没付费
    (
      mockPrisma.rateLimit.findUnique as unknown as { mockResolvedValue: (v: unknown) => void }
    ).mockResolvedValue({ count: 0 });
    (
      mockPrisma.rateLimit.upsert as unknown as { mockResolvedValue: (v: unknown) => void }
    ).mockResolvedValue({ count: 1 });

    const r = await checkLimit('u1', 'message');
    expect(r.paid).toBe(false);
    expect(r.allowed).toBe(true);
  });
});

describe('track', () => {
  it('writes event to DB (fire-and-forget)', async () => {
    track('u1', 'interview_start', { company: 'byte' });
    // 异步写库，等一个微任务
    await new Promise((r) => setTimeout(r, 10));
    expect(mockPrisma.trackEvent.create).toHaveBeenCalledWith({
      data: {
        userId: 'u1',
        eventName: 'interview_start',
        properties: { company: 'byte' },
      },
    });
  });

  it('rejects non-whitelist events', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    track('u1', 'evil_event' as never);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('非白名单'));
    expect(mockPrisma.trackEvent.create).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
