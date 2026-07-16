/**
 * POST /api/test-helper/set-password
 *
 * Phase 14.33.3 — 强制改密码 debug 端点
 *
 * 用途：当用户忘记自己重置时设的密码时，运营可通过此端点直接覆盖
 * - 不需要验证码（debug 场景假设已有 ENABLE_TEST_HELPERS=1 授权）
 * - 不需要 Turnstile
 * - 返回新 hash 长度供校验
 *
 * 安全：
 * - 仅 ENABLE_TEST_HELPERS=1 时生效
 * - 永远不返回 passwordHash 本身
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/client';
import { hashPassword } from '@/lib/auth/password';
import { isTestHelpersEnabled, testHelperDisabledResponse } from '@/lib/test-helpers';
import { successResponse, errorResponse, validationErrorResponse } from '@/lib/auth/middleware';

const Body = z.object({
  email: z.string().email(),
  newPassword: z.string().min(8).max(64),
});

export async function POST(req: NextRequest) {
  if (!isTestHelpersEnabled()) return testHelperDisabledResponse();

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) return validationErrorResponse(parsed.error, req);

  const { email, newPassword } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, passwordHash: true },
  });

  if (!user) {
    return errorResponse('USER_NOT_FOUND', '账号不存在（DB 里查不到该 email）', 404, req);
  }

  const newHash = await hashPassword(newPassword);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: newHash,
      // 同时清空 verifyCode（防止新密码被旧验证码污染）
      verifyCode: null,
      verifyExpiry: null,
    },
  });

  return successResponse(
    {
      ok: true,
      userId: user.id,
      email: user.email,
      newHashLength: newHash.length,
      newHashPrefix: newHash.slice(0, 7),
      // 不返回 passwordHash
    },
    200,
    req
  );
}
