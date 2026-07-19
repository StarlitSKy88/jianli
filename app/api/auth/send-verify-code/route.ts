/**
 * POST /api/auth/send-verify-code
 *
 * Body: { email }
 *
 * 行为：
 * - 同邮箱 60 秒内只发一次（防刷）
 * - 已注册邮箱拒绝（防枚举）
 * - 验证码 6 位数字，10 分钟有效
 *
 * MVP 阶段邮件通过 console.log 输出（生产替换为 Tencent SES）
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { errorResponse, successResponse, validationErrorResponse } from '@/lib/auth/middleware';
import { sendVerifyCode } from '@/lib/auth/verify-code';
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

  // 1) 蜜罐：命中则假装成功（不告诉机器人）
  if (isHoneypotTriggered(json ?? {})) {
    track(null, 'verify_code_honeypot', { ip });
    return successResponse({ sent: true, cooldownSec: 60 }, 200, req);
  }

  // 2) IP 限流：同 IP 60 秒内只发 1 次
  if (
    !(await checkRateLimitAsync(
      `send-verify-code:${ip}`,
      RATE_LIMITS.sendVerifyCode.maxHits,
      RATE_LIMITS.sendVerifyCode.windowMs
    ))
  ) {
    return errorResponse('TOO_FREQUENT', '请求过于频繁，请稍后再试', 429, req);
  }

  // 3) Turnstile：dev 环境无 secret 时跳过
  const ts = await verifyTurnstile(parsed.data.turnstileToken ?? '', ip);
  if (!ts.ok) {
    return errorResponse(
      'TURNSTILE_FAILED',
      `人机验证失败: ${ts.errorCodes?.join(',') ?? 'unknown'}（token ${parsed.data.turnstileToken ? parsed.data.turnstileToken.slice(0, 8) + '...' : 'EMPTY'}）`,
      400,
      req
    );
  }

  // 顶层 try/catch — 把真凶 message 暴露到 response body（debug 用）
  // Phase 13.9.1: production 反复 500 无 body，加这一层捕获以定位根因
  let result: Awaited<ReturnType<typeof sendVerifyCode>>;
  try {
    result = await sendVerifyCode(parsed.data.email);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // eslint-disable-next-line no-console
    console.error(`[send-verify-code] throw for ${parsed.data.email}: ${msg}`);
    return errorResponse(
      'SEND_FAILED',
      `验证码发送失败: ${msg.slice(0, 200)} | 检查: ① TiDB 连通 ② Prisma schema 同步 ③ EMAIL_SENDER_MODE 与 SMTP_* 注入`,
      500,
      req
    );
  }

  // 追踪埋点（用于分析转化漏斗）
  track(null, 'verify_code_request', {
    email: parsed.data.email.replace(/(.{2}).*(@.*)/, '$1***$2'), // 脱敏
    result: result.ok ? 'sent' : result.reason,
  });

  if (result.ok) {
    return successResponse(
      {
        sent: true,
        cooldownSec: result.cooldownSec,
        // MVP 提示：告诉用户去哪里看验证码
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
    case 'USER_EXISTS':
      // 不暴露具体原因，统一返回 '已注册'（安全）
      return errorResponse('EMAIL_TAKEN', '该邮箱已注册，请直接登录', 409, req);
    case 'COOLDOWN':
      return errorResponse('TOO_FREQUENT', `请 ${result.cooldownSec ?? 60} 秒后再试`, 429, req);
    case 'INVALID_EMAIL':
      return errorResponse('INVALID_EMAIL', '邮箱格式无效', 400, req);
    default:
      return errorResponse('SEND_FAILED', '验证码发送失败，请稍后重试', 500, req);
  }
}
