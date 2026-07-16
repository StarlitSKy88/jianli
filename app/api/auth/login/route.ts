/**
 * POST /api/auth/login
 * Body: { email, password, turnstileToken? }
 * Returns: 200 + Set-Cookie: token=<jwt>
 *
 * 防刷：IP 限流（5 分钟内 10 次）+ Turnstile（防高级机器人）
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/client';
import { verifyPassword } from '@/lib/auth/password';
import { signSession } from '@/lib/auth/session';
import { successResponse, errorResponse, validationErrorResponse } from '@/lib/auth/middleware';
import { setAuthCookie } from '@/lib/auth/cookie';
import { checkRateLimit, getClientIp, verifyTurnstile, RATE_LIMITS } from '@/lib/auth/anti-abuse';

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  turnstileToken: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) return validationErrorResponse(parsed.error, req);

  // 1) IP 限流：5 分钟内最多 10 次登录（防撞库）
  if (!checkRateLimit(`login:${ip}`, RATE_LIMITS.login.maxHits, RATE_LIMITS.login.windowMs)) {
    return errorResponse('TOO_FREQUENT', '登录尝试过于频繁，请稍后再试', 429, req);
  }

  // 2) Turnstile：dev 环境无 secret 时跳过
  const ts = await verifyTurnstile(parsed.data.turnstileToken ?? '', ip);
  if (!ts.ok) {
    return errorResponse(
      'TURNSTILE_FAILED',
      `人机验证失败: ${ts.errorCodes?.join(',') ?? 'unknown'}（token ${parsed.data.turnstileToken ? parsed.data.turnstileToken.slice(0, 8) + '...' : 'EMPTY'}）`,
      400,
      req
    );
  }

  const { email, password } = parsed.data;

  // 3. 查用户
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return errorResponse('INVALID_CREDENTIALS', '邮箱或密码错误', 401, req);

  // 4. 验密码
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return errorResponse('INVALID_CREDENTIALS', '邮箱或密码错误', 401, req);

  // 5. 签 JWT
  const token = await signSession({ userId: user.id, email: user.email });

  // 6. 更新最后登录时间
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  // 7. Set-Cookie（强制 httpOnly + sameSite=lax，生产 secure）
  const res = successResponse({ userId: user.id, email: user.email }, 200, req);
  setAuthCookie(res, token);
  return res;
}
