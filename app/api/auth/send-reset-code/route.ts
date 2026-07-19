/**
 * POST /api/auth/send-reset-code
 *
 * Body: { email, turnstileToken? }
 *
 * 行为：
 * - 邮箱**未注册** → 拒绝（USER_NOT_FOUND，统一返回"发送成功"防枚举）
 * - 同邮箱 60 秒内只发一次（防刷）
 * - 验证码 6 位数字，10 分钟有效
 *
 * Phase 14.32: 配合 reset-password 流程
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { errorResponse, successResponse, validationErrorResponse } from '@/lib/auth/middleware';
import { sendPasswordResetCode } from '@/lib/auth/verify-code';
import { track } from '@/lib/analytics/track';
import {
  isHoneypotTriggered,
  checkRateLimitAsync,
  getClientIp,
  verifyTurnstile,
  RATE_LIMITS,
} from '@/lib/auth/anti-abuse';

const Body = z.object({
  email: z.string().email('邮箱格式无效'),
  turnstileToken: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) return validationErrorResponse(parsed.error, req);

  // 1) 蜜罐：命中则假装成功
  if (isHoneypotTriggered(json ?? {})) {
    track(null, 'reset_code_honeypot', { ip });
    return successResponse({ sent: true, cooldownSec: 60 }, 200, req);
  }

  // 2) IP 限流
  if (
    !(await checkRateLimitAsync(
      `send-reset-code:${ip}`,
      RATE_LIMITS.sendVerifyCode.maxHits,
      RATE_LIMITS.sendVerifyCode.windowMs
    ))
  ) {
    return errorResponse('TOO_FREQUENT', '请求过于频繁，请稍后再试', 429, req);
  }

  // 3) Turnstile
  const ts = await verifyTurnstile(parsed.data.turnstileToken ?? '', ip);
  if (!ts.ok) {
    return errorResponse(
      'TURNSTILE_FAILED',
      `人机验证失败: ${ts.errorCodes?.join(',') ?? 'unknown'}（token ${parsed.data.turnstileToken ? parsed.data.turnstileToken.slice(0, 8) + '...' : 'EMPTY'}）`,
      400,
      req
    );
  }

  // 顶层 try/catch — 暴露真凶 message
  let result: Awaited<ReturnType<typeof sendPasswordResetCode>>;
  try {
    result = await sendPasswordResetCode(parsed.data.email);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // eslint-disable-next-line no-console
    console.error(`[send-reset-code] throw for ${parsed.data.email}: ${msg}`);
    return errorResponse(
      'SEND_FAILED',
      `重置码发送失败: ${msg.slice(0, 200)} | 检查: ① TiDB 连通 ② Prisma schema 同步 ③ EMAIL_SENDER_MODE 与 SMTP_* 注入`,
      500,
      req
    );
  }

  // 埋点
  track(null, 'reset_code_request', {
    email: parsed.data.email.replace(/(.{2}).*(@.*)/, '$1***$2'),
    result: result.ok ? 'sent' : result.reason,
  });

  if (result.ok) {
    return successResponse(
      {
        sent: true,
        cooldownSec: result.cooldownSec,
        devHint:
          process.env.NODE_ENV !== 'production'
            ? '开发模式：验证码在控制台日志 / TiDB User.verifyCode 列'
            : undefined,
      },
      200,
      req
    );
  }

  switch (result.reason) {
    case 'USER_NOT_FOUND':
      // 安全：不暴露"邮箱不存在"，统一返回"发送成功"（防枚举）
      // 前端会显示"已发送"，但用户实际收不到（真实用户会收到）
      // 这是行业标准做法
      return successResponse({ sent: true, cooldownSec: 60 }, 200, req);
    case 'COOLDOWN':
      return errorResponse('TOO_FREQUENT', `请 ${result.cooldownSec ?? 60} 秒后再试`, 429, req);
    case 'INVALID_EMAIL':
      return errorResponse('INVALID_EMAIL', '邮箱格式无效', 400, req);
    default:
      return errorResponse('SEND_FAILED', '验证码发送失败，请稍后重试', 500, req);
  }
}
