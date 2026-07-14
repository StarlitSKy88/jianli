/**
 * POST /api/auth/login
 * Body: { email, password }
 * Returns: 200 + Set-Cookie: token=<jwt>
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/client';
import { verifyPassword } from '@/lib/auth/password';
import { signSession } from '@/lib/auth/session';
import { successResponse, errorResponse, validationErrorResponse } from '@/lib/auth/middleware';

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) return validationErrorResponse(parsed.error);

  const { email, password } = parsed.data;

  // 1. 查用户
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return errorResponse('INVALID_CREDENTIALS', '邮箱或密码错误', 401);

  // 2. 验密码
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return errorResponse('INVALID_CREDENTIALS', '邮箱或密码错误', 401);

  // 3. 签 JWT
  const token = await signSession({ userId: user.id, email: user.email });

  // 4. 更新最后登录时间
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  // 5. Set-Cookie
  const res = successResponse({ userId: user.id, email: user.email });
  res.cookies.set('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  });
  return res;
}
