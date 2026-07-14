/**
 * POST /api/auth/register
 * Body: { email, password, verifyCode }
 * Returns: 201 { ok: true, data: { userId } } | 4xx 错误
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/client';
import { hashPassword } from '@/lib/auth/password';
import { successResponse, errorResponse, validationErrorResponse } from '@/lib/auth/middleware';

const Body = z.object({
  email: z.string().email('邮箱格式无效'),
  password: z.string().min(8, '密码至少 8 位').max(64),
  verifyCode: z.string().length(6, '验证码 6 位'),
});

export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) return validationErrorResponse(parsed.error);

  const { email, password, verifyCode } = parsed.data;

  // 1. 校验验证码（v0 用 dev bypass）
  const isDevBypass = process.env.NODE_ENV !== 'production' && verifyCode === '000000';
  if (!isDevBypass) {
    // TODO: 接入真实邮件验证码（.knowledge/ 待补 entry）
    return errorResponse('VERIFY_CODE_INVALID', '验证码无效或已过期', 400);
  }

  // 2. 已注册检查
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return errorResponse('EMAIL_TAKEN', '该邮箱已注册', 409);

  // 3. hash + 创建
  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      emailVerified: isDevBypass, // dev 模式自动验证
    },
    select: { id: true, email: true },
  });

  return successResponse({ userId: user.id, email: user.email }, 201);
}
