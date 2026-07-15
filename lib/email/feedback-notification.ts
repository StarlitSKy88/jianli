/**
 * Feedback 邮件通知 — 客服通道落点（Phase 13.5）
 *
 * 行为：
 * - 把用户反馈转发到 `FEEDBACK_NOTIFY_EMAIL`（默认 support@taomyst.top）
 * - 复用现有 `getEmailSender()`（生产 = Tencent SES / MVP = console）
 * - 发送失败 → 返回 { ok: false }，不抛异常
 *   （主流程 GET /api/feedback 已经写 DB，邮件是次级通知）
 *
 * 安全：
 * - HTML escape 用户 content（防止 XSS 通过邮件）
 * - 截断超长 content（防止滥用邮件大小）
 */

import { getEmailSender } from './index';
import type { EmailSendResult } from './types';

export interface FeedbackNotificationPayload {
  category: string;
  content: string;
  contactEmail: string | null;
  userId: string | null;
  ip?: string | null;
  feedbackId?: string;
}

const MAX_CONTENT_CHARS = 2000;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + '...(内容过长已截断)';
}

function getSupportEmail(): string {
  return process.env.FEEDBACK_NOTIFY_EMAIL || 'support@taomyst.top';
}

export async function sendFeedbackNotification(
  payload: FeedbackNotificationPayload
): Promise<EmailSendResult> {
  const supportEmail = getSupportEmail();
  const subject = `【反馈】${payload.category} - 用户新反馈`;

  const truncatedContent = truncate(payload.content, MAX_CONTENT_CHARS);
  const escapedContent = escapeHtml(truncatedContent);
  const escapedContact = payload.contactEmail ? escapeHtml(payload.contactEmail) : null;
  const userLine = payload.userId ? `用户 ID：${escapeHtml(payload.userId)}` : '匿名用户';

  const text = [
    '收到一条用户反馈：',
    '',
    `分类：${payload.category}`,
    `用户：${userLine}`,
    payload.ip ? `IP：${payload.ip}` : '',
    escapedContact ? `联系方式：${escapedContact}` : '',
    payload.feedbackId ? `反馈 ID：${payload.feedbackId}` : '',
    '',
    '内容：',
    truncatedContent,
  ]
    .filter(Boolean)
    .join('\n');

  const html = `
<div style="font-family:-apple-system,sans-serif;max-width:600px;margin:auto;padding:24px">
  <h2 style="color:#37352f;margin:0 0 16px">新用户反馈</h2>
  <table style="border-collapse:collapse;width:100%">
    <tr><td style="padding:6px 12px;color:#787774;font-size:13px;width:80px">分类</td><td style="padding:6px 12px"><b>${escapeHtml(payload.category)}</b></td></tr>
    <tr style="background:#f7f7f5"><td style="padding:6px 12px;color:#787774;font-size:13px">用户</td><td style="padding:6px 12px">${userLine}</td></tr>
    ${payload.ip ? `<tr><td style="padding:6px 12px;color:#787774;font-size:13px">IP</td><td style="padding:6px 12px;font-family:monospace;font-size:12px">${escapeHtml(payload.ip)}</td></tr>` : ''}
    ${escapedContact ? `<tr style="background:#f7f7f5"><td style="padding:6px 12px;color:#787774;font-size:13px">联系方式</td><td style="padding:6px 12px">${escapedContact}</td></tr>` : payload.ip ? '<tr><td></td><td></td></tr>' : ''}
    ${payload.feedbackId ? `<tr><td style="padding:6px 12px;color:#787774;font-size:13px">ID</td><td style="padding:6px 12px;font-family:monospace;font-size:12px">${escapeHtml(payload.feedbackId)}</td></tr>` : ''}
  </table>
  <h3 style="margin:24px 0 8px;color:#37352f">内容</h3>
  <div style="padding:16px;background:#f7f7f5;border-radius:8px;white-space:pre-wrap;word-break:break-word;font-family:inherit">${escapedContent}</div>
  <hr style="border:none;border-top:1px solid #e9e9e7;margin:24px 0"/>
  <p style="color:#9b9a97;font-size:12px;margin:0">此邮件由 Interview Buddy 客服系统自动发出，请尽快在控制台回复用户。</p>
</div>`.trim();

  try {
    const sender = getEmailSender();
    const result = await sender.send({
      to: supportEmail,
      subject,
      text,
      html,
    });
    if (!result.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[feedback-notification] send failed: ${result.error}`);
    }
    return result;
  } catch (e) {
    // 主流程 try/catch 兜底，不能让反馈因为邮件发送失败而崩
    // eslint-disable-next-line no-console
    console.warn(`[feedback-notification] exception: ${(e as Error).message}`);
    return { ok: false, error: (e as Error).message };
  }
}
