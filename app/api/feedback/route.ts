/**
 * POST /api/feedback — 用户反馈提交（Phase 13.5 客服通道）
 *
 * Body:
 *   {
 *     category: 'BUG' | 'UX' | 'FEATURE' | 'ACCOUNT' | 'OTHER',
 *     content: string (5-2000 字符),
 *     contactEmail?: string (可选联系方式)
 *   }
 *
 * 行为：
 * - 匿名可用；已登录用户自动关联 userId
 * - 防刷三件套：蜜罐（命中假装成功）+ IP 限流（5/小时）+ Turnstile（生产）
 * - 写 feedbacks 表 + sendFeedbackNotification 邮件给 support@taomyst.top
 * - 邮件发送失败不影响主流程（已写库）
 *
 * Returns:
 *   200 { ok: true, data: { id } }    — 提交成功
 *   400 { ok: false, error: VALIDATION_ERROR } — body 不合法
 *   429 { ok: false, error: TOO_FREQUENT } — 限流命中
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/client';
import {
  successResponse,
  errorResponse,
  validationErrorResponse,
  getSession,
} from '@/lib/auth/middleware';
import { track } from '@/lib/analytics/track';
import {
  isHoneypotTriggered,
  checkRateLimitAsync,
  getClientIp,
  verifyTurnstile,
  RATE_LIMITS,
} from '@/lib/auth/anti-abuse';
import { sendFeedbackNotification } from '@/lib/email/feedback-notification';

const VALID_CATEGORIES = ['BUG', 'UX', 'FEATURE', 'ACCOUNT', 'OTHER'] as const;

const Body = z.object({
  category: z.enum(VALID_CATEGORIES, {
    errorMap: () => ({ message: 'category 必须是 BUG/UX/FEATURE/ACCOUNT/OTHER' }),
  }),
  content: z.string().min(5, '反馈内容至少 5 字').max(2000, '反馈内容不超过 2000 字'),
  contactEmail: z
    .union([z.string().email('邮箱格式无效'), z.literal(''), z.null()])
    .optional()
    .transform((v) => (v === '' || v == null ? undefined : v)),
  turnstileToken: z.string().optional(),
  // 蜜罐字段（前端 hidden input 必须是空字符串）
  website: z.string().optional(),
  company_name: z.string().optional(),
  phone_number: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) return validationErrorResponse(parsed.error);

  // 1) 蜜罐：命中假装成功（不告诉机器人被识破）
  if (isHoneypotTriggered(parsed.data)) {
    track(null, 'feedback_honeypot', { ip, category: parsed.data.category });
    return successResponse({ id: 'honeypot', accepted: true });
  }

  // 2) IP 限流：1 小时 5 次
  if (
    !(await checkRateLimitAsync(
      `feedback:${ip}`,
      RATE_LIMITS.feedback.maxHits,
      RATE_LIMITS.feedback.windowMs
    ))
  ) {
    return errorResponse('TOO_FREQUENT', '反馈提交过于频繁，请稍后再试', 429);
  }

  // 3) Turnstile（dev 无 secret 跳过，生产必走）
  const ts = await verifyTurnstile(parsed.data.turnstileToken ?? '', ip);
  if (!ts.ok) {
    return errorResponse('TURNSTILE_FAILED', '人机验证失败，请刷新页面重试', 400);
  }

  // 4) 已登录用户关联（可选）
  const session = await getSession(req);
  const userId = session?.userId ?? null;

  // 5) 写库
  const userAgent = req.headers.get('user-agent') ?? null;
  const feedback = await prisma.feedback.create({
    data: {
      userId,
      category: parsed.data.category,
      content: parsed.data.content.trim(),
      contactEmail: parsed.data.contactEmail ?? null,
      userAgent: userAgent ? userAgent.slice(0, 1000) : null, // UA 截断防止滥用
      ipAddress: ip,
    },
    select: { id: true },
  });

  // 6) 邮件通知（失败不影响主流程）
  await sendFeedbackNotification({
    category: parsed.data.category,
    content: parsed.data.content.trim(),
    contactEmail: parsed.data.contactEmail ?? null,
    userId,
    ip,
    feedbackId: feedback.id,
  });

  track(userId, 'feedback_submit', {
    category: parsed.data.category,
    hasContact: !!parsed.data.contactEmail,
    feedbackId: feedback.id,
  });

  return successResponse({ id: feedback.id, accepted: true });
}
