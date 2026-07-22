/**
 * POST /api/auth/register
 * Body: { email, password, verifyCode, turnstileToken? }
 * Returns: 201 { ok: true, data: { userId } } | 4xx 错误
 *
 * 流程：
 *   1) 防刷号三件套（蜜罐 + IP 限流 + Turnstile）
 *   2) 校验 verifyCode（10 分钟内有效，一次性消费）
 *   3) 已注册检查
 *   4) bcrypt hash 密码
 *   5) 写库
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/client';
import { hashPassword } from '@/lib/auth/password';
import { successResponse, errorResponse, validationErrorResponse } from '@/lib/auth/middleware';
import { consumeVerifyCode } from '@/lib/auth/verify-code';
import { track } from '@/lib/analytics/track';
import { signSession } from '@/lib/auth/session';
import { setAuthCookie } from '@/lib/auth/cookie';
import {
  isHoneypotTriggered,
  checkRateLimitAsync,
  getClientIp,
  verifyTurnstile,
  RATE_LIMITS,
} from '@/lib/auth/anti-abuse';

const Body = z.object({
  email: z.string().email('邮箱格式无效'),
  password: z.string().min(8, '密码至少 8 位').max(64),
  verifyCode: z.string().length(6, '验证码 6 位'),
  turnstileToken: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) return validationErrorResponse(parsed.error, req);

  // 1) 防刷号三件套
  // 蜜罐：命中则假装成功（不告诉机器人）
  if (isHoneypotTriggered(json ?? {})) {
    track(null, 'register_honeypot', { ip });
    return successResponse({ userId: 'pending', email: parsed.data.email }, 201, req);
  }
  // IP 限流：5 分钟内最多 3 次注册
  if (
    !(await checkRateLimitAsync(
      `register:${ip}`,
      RATE_LIMITS.register.maxHits,
      RATE_LIMITS.register.windowMs
    ))
  ) {
    return errorResponse('TOO_FREQUENT', '注册请求过于频繁，请稍后再试', 429, req);
  }
  // Turnstile：dev 环境无 secret 时跳过
  const ts = await verifyTurnstile(parsed.data.turnstileToken ?? '', ip);
  if (!ts.ok) {
    // 暴露真凶 errorCodes 到响应，辅助调试 Cloudflare token 拒绝原因
    // (生产环境保留，但只在错误时显示，不泄露给前端正常使用)
    return errorResponse(
      'TURNSTILE_FAILED',
      `人机验证失败: ${ts.errorCodes?.join(',') ?? 'unknown'}（token ${parsed.data.turnstileToken ? parsed.data.turnstileToken.slice(0, 8) + '...' : 'EMPTY'}）`,
      400,
      req
    );
  }

  const { email, password, verifyCode } = parsed.data;

  // 2) 校验验证码（真实流程，不再有 dev bypass）
  const verification = await consumeVerifyCode(email, verifyCode);
  if (!verification.ok) {
    track(null, 'register_fail', { reason: `verify_${verification.reason.toLowerCase()}` });
    switch (verification.reason) {
      case 'NOT_FOUND':
        return errorResponse('VERIFY_CODE_INVALID', '请先获取验证码', 400, req);
      case 'EXPIRED':
        return errorResponse('VERIFY_CODE_EXPIRED', '验证码已过期，请重新获取', 400, req);
      case 'MISMATCH':
        return errorResponse('VERIFY_CODE_INVALID', '验证码错误', 400, req);
    }
  }

  // 3) 已注册检查（防并发：pending user 也会匹配 email，所以要看 passwordHash 是否非空）
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, emailVerified: true, passwordHash: true },
  });
  if (existing && existing.passwordHash && existing.passwordHash.length > 0) {
    return errorResponse('EMAIL_TAKEN', '该邮箱已注册', 409, req);
  }
  // pending user 复用：直接覆盖 passwordHash（update 而不是 create）

  // 4) hash + 创建/更新用户
  const passwordHash = await hashPassword(password);
  const user = existing
    ? await prisma.user.update({
        where: { id: existing.id },
        data: {
          passwordHash,
          emailVerified: true,
          verifyCode: null,
          verifyExpiry: null,
        },
        select: { id: true, email: true },
      })
    : await prisma.user.create({
        data: {
          email,
          passwordHash,
          emailVerified: true,
        },
        select: { id: true, email: true },
      });

  track(user.id, 'signup_complete', { email: email.replace(/(.{2}).*(@.*)/, '$1***$2') });

  // 自动登录：注册成功后立即签发 JWT 并设 cookie，避免前端需要再调一次 login
  // （这是 prod 流程，注册后应该直接跳到 /interview/new）
  const token = await signSession({ userId: user.id, email: user.email });
  const res = successResponse({ userId: user.id, email: user.email }, 201, req);
  setAuthCookie(res, token);
  return res;
}
