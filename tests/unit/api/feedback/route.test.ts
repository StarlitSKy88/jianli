/**
 * POST /api/feedback 单测
 *
 * 业务契约：
 * - 合法 body → 200 + 写入 feedbacks 表 + 邮件 send（被 mock）
 * - content 太短 → 400 VALIDATION_ERROR
 * - category 不在白名单 → 400 VALIDATION_ERROR
 * - 蜜罐命中 → 假装成功但不写库（防机器人探测）
 * - IP 限流 → 429 TOO_FREQUENT
 * - 邮件发送失败 → 仍返回 200（不阻断主流程）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ===== Mocks =====

// 用 .mock 引用 → 在 factory 内通过 vi.hoisted 提到顶部
const { mockFeedbackCreate, mockSendFeedback } = vi.hoisted(() => ({
  mockFeedbackCreate: vi.fn(),
  mockSendFeedback: vi.fn(async () => ({ ok: true, messageId: 'mock' })),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    feedback: { create: mockFeedbackCreate },
  },
}));

vi.mock('@/lib/auth/anti-abuse', () => ({
  isHoneypotTriggered: vi.fn(() => false),
  checkRateLimit: vi.fn(() => true),
  checkRateLimitAsync: vi.fn(async () => true),
  getClientIp: vi.fn(() => '203.0.113.7'),
  verifyTurnstile: vi.fn(async () => ({ ok: true })),
  RATE_LIMITS: { feedback: { maxHits: 5, windowMs: 3600_000 } },
}));

vi.mock('@/lib/email/feedback-notification', () => ({
  sendFeedbackNotification: mockSendFeedback,
}));

vi.mock('@/lib/analytics/track', () => ({
  track: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return {
    ...actual,
    getSession: vi.fn(async () => null),
  };
});

// ===== Implementation =====
import { POST } from '@/app/api/feedback/route';

function makeReq(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/feedback', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFeedbackCreate.mockResolvedValue({ id: 'fb-1' });
});

describe('POST /api/feedback', () => {
  it('happy path: anonymous user submits valid feedback', async () => {
    const req = makeReq({
      category: 'BUG',
      content: '登录后页面空白，刷新也没用',
      contactEmail: 'test@example.com',
    });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.data.id).toBe('fb-1');
    expect(mockFeedbackCreate).toHaveBeenCalledTimes(1);
    expect(mockFeedbackCreate.mock.calls[0][0].data.userId).toBeNull();
    expect(mockFeedbackCreate.mock.calls[0][0].data.ipAddress).toBe('203.0.113.7');
    expect(mockSendFeedback).toHaveBeenCalledTimes(1);
  });

  it('rejects content shorter than 5 chars', async () => {
    const req = makeReq({ category: 'BUG', content: 'a' });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mockFeedbackCreate).not.toHaveBeenCalled();
  });

  it('rejects unknown category', async () => {
    const req = makeReq({ category: 'INVALID', content: '啊'.repeat(10) });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mockFeedbackCreate).not.toHaveBeenCalled();
  });

  it('rejects invalid email format', async () => {
    const req = makeReq({
      category: 'BUG',
      content: '啊'.repeat(10),
      contactEmail: 'not-an-email',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('still succeeds when email send fails (主流程不阻断)', async () => {
    mockSendFeedback.mockResolvedValueOnce({ ok: false, error: 'smtp-down' } as any);

    const req = makeReq({
      category: 'UX',
      content: '希望增加导出报告 PDF',
      contactEmail: null,
    });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true); // 已写库
    expect(mockFeedbackCreate).toHaveBeenCalledTimes(1);
  });

  it('allows anonymous contactEmail=null', async () => {
    const req = makeReq({
      category: 'FEATURE',
      content: '希望加暗色模式',
      contactEmail: null,
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(mockFeedbackCreate.mock.calls[0][0].data.contactEmail).toBeNull();
  });

  it('accepts all 5 valid categories', async () => {
    for (const cat of ['BUG', 'UX', 'FEATURE', 'ACCOUNT', 'OTHER']) {
      mockFeedbackCreate.mockClear();
      const req = makeReq({ category: cat, content: '啊'.repeat(10) });
      const res = await POST(req);
      expect(res.status).toBe(200);
    }
  });
});
