/**
 * POST /api/auth/reset-password
 *
 * Body: { email, verifyCode, password, turnstileToken? }
 *
 * 行为：
 * - 校验邮箱 + 验证码（必须匹配）
 * - 验证码用后即焚
 * - 更新 user.passwordHash（bcrypt cost=10）
 * - 返回成功（不自动登录，用户需主动登录）
 *
 * Phase 14.32: 密码重置流程的"执行"端
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/client';
import { hashPassword } from '@/lib/auth/password';
import { errorResponse, successResponse, validationErrorResponse } from '@/lib/auth/middleware';
import { consumeResetCode } from '@/lib/auth/verify-code';
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
  verifyCode: z.string().regex(/^\d{6}$/, '验证码必须是 6 位数字'),
  password: z.string().min(8, '密码至少 8 位').max(64, '密码最多 64 位'),
  turnstileToken: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) return validationErrorResponse(parsed.error, req);

  // 1) 蜜罐
  if (isHoneypotTriggered(json ?? {})) {
    track(null, 'reset_password_honeypot', { ip });
    return successResponse({ ok: true }, 200, req);
  }

  // 2) IP 限流（与 register 共用，防止暴力枚举验证码）
  if (
    !(await checkRateLimitAsync(
      `reset-password:${ip}`,
      RATE_LIMITS.register.maxHits,
      RATE_LIMITS.register.windowMs
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

  const { email, verifyCode, password } = parsed.data;

  // 4) 校验验证码（不消费，留给 update 阶段统一清空）
  const consume = await consumeResetCode(email, verifyCode);
  if (!consume.ok) {
    const reasonMap = {
      NOT_FOUND: '验证码无效或已使用',
      EXPIRED: '验证码已过期，请重新获取',
      MISMATCH: '验证码错误',
    } as const;
    return errorResponse(
      `VERIFY_${consume.reason}`,
      reasonMap[consume.reason],
      consume.reason === 'EXPIRED' ? 410 : 400,
      req
    );
  }

  // 5) 顶层 try/catch — 暴露真凶 message
  try {
    // hash 新密码
    const newHash = await hashPassword(password);

    // 原子操作：更新密码 + 清空 verifyCode（防重放）
    await prisma.user.update({
      where: { id: consume.userId },
      data: {
        passwordHash: newHash,
        verifyCode: null,
        verifyExpiry: null,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // eslint-disable-next-line no-console
    console.error(`[reset-password] throw for ${email}: ${msg}`);
    return errorResponse(
      'RESET_FAILED',
      `密码重置失败: ${msg.slice(0, 200)} | 检查: ① TiDB 连通 ② Prisma schema 同步`,
      500,
      req
    );
  }

  // 6) 埋点
  track(null, 'password_reset_success', {
    email: email.replace(/(.{2}).*(@.*)/, '$1***$2'),
  });

  return successResponse(
    {
      ok: true,
      // 不自动登录 — 让用户走 /login 用新密码登
      // 安全考虑：避免泄露"用户已存在"信号
    },
    200,
    req
  );
}
