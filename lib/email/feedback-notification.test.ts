/**
 * Feedback 邮件通知单元测试
 *
 * 验证 sendFeedbackNotification():
 * - 成功路径：sender.send ok → 返回 { ok: true }
 * - 失败路径：sender.send fail → 返回 { ok: false }（不抛异常，主流程不受影响）
 * - 邮件格式：subject + html 包含 category/content/contactEmail
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock sender 必须在 lib/email/feedback-notification.ts import 之前注入
const mockSend = vi.fn();
vi.mock('./index', () => ({
  getEmailSender: () => ({ send: mockSend }),
}));

import { sendFeedbackNotification } from './feedback-notification';

describe('sendFeedbackNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FEEDBACK_NOTIFY_EMAIL = 'support@taomyst.top';
  });

  it('routes to configured support email', async () => {
    mockSend.mockResolvedValueOnce({ ok: true, messageId: 'mock-1' });

    const result = await sendFeedbackNotification({
      category: 'BUG',
      content: '登录后页面空白',
      contactEmail: 'user@example.com',
      userId: 'user-123',
    });

    expect(result.ok).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);
    const [arg] = mockSend.mock.calls[0];
    expect(arg.to).toBe('support@taomyst.top');
    expect(arg.subject).toContain('BUG');
    expect(arg.html).toContain('登录后页面空白');
    expect(arg.html).toContain('user@example.com');
    expect(arg.html).toContain('user-123');
  });

  it('handles anonymous user (no userId)', async () => {
    mockSend.mockResolvedValueOnce({ ok: true, messageId: 'mock-2' });

    const result = await sendFeedbackNotification({
      category: 'FEATURE',
      content: '希望增加导出报告 PDF',
      contactEmail: null,
      userId: null,
    });

    expect(result.ok).toBe(true);
    const [arg] = mockSend.mock.calls[0];
    expect(arg.html).toContain('匿名');
    expect(arg.html).not.toContain('联系方式：'); // 没留邮箱
  });

  it('swallows send failure (does not throw)', async () => {
    mockSend.mockResolvedValueOnce({ ok: false, error: 'smtp-down' });

    // 关键：主流程 try/catch 兜底，不能让反馈提交因为邮件发送失败而崩
    const result = await sendFeedbackNotification({
      category: 'UX',
      content: '登录按钮位置怪',
      contactEmail: 'u@x.com',
      userId: null,
    });

    expect(result.ok).toBe(false);
  });

  it('escapes HTML in content (XSS 防护)', async () => {
    mockSend.mockResolvedValueOnce({ ok: true, messageId: 'mock-3' });

    await sendFeedbackNotification({
      category: 'OTHER',
      content: '<script>alert("xss")</script>',
      contactEmail: 'hacker@evil.com',
      userId: null,
    });

    const [arg] = mockSend.mock.calls[0];
    // 关键：< > 应被 HTML escape
    expect(arg.html).not.toContain('<script>');
    expect(arg.html).toContain('&lt;script&gt;');
  });

  it('falls back to default support email when env missing', async () => {
    delete process.env.FEEDBACK_NOTIFY_EMAIL;
    mockSend.mockResolvedValueOnce({ ok: true, messageId: 'mock-4' });

    await sendFeedbackNotification({
      category: 'BUG',
      content: 't',
      contactEmail: null,
      userId: null,
    });

    const [arg] = mockSend.mock.calls[0];
    expect(arg.to).toBe('support@taomyst.top');
  });

  it('truncates long content (avoid huge emails)', async () => {
    mockSend.mockResolvedValueOnce({ ok: true, messageId: 'mock-5' });

    const longContent = '啊'.repeat(5000);
    await sendFeedbackNotification({
      category: 'BUG',
      content: longContent,
      contactEmail: null,
      userId: null,
    });

    const [arg] = mockSend.mock.calls[0];
    // 截断到 2000 字符以内
    expect(arg.text!.length).toBeLessThan(longContent.length);
    expect(arg.text).toContain('...(内容过长已截断)');
  });
});
