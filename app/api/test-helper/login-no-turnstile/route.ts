/**
 * POST /api/test-helper/login-no-turnstile
 *
 * Phase 14.33 — 临时 debug 端点
 *
 * 用途：当 prod Turnstile widget 渲染失败时，让运营/开发能直接验证账号状态
 * - 跳过 Turnstile（production 严格验证的临时绕开）
 * - 跳过 IP 限流（避免连续测试触发 429）
 * - 仍校验密码 hash（如果账号存在 + 密码对 → 返回 Set-Cookie）
 *
 * 安全：
 * - 仅 ENABLE_TEST_HELPERS=1 + NODE_ENV != 'production' 才生效
 * - prod 默认返回 404（与现有 test-helper 模式一致）
 * - 永远不返回 passwordHash 字段本身
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/client';
import { verifyPassword } from '@/lib/auth/password';
import { signSession } from '@/lib/auth/session';
import { isTestHelpersEnabled, testHelperDisabledResponse } from '@/lib/test-helpers';
import { successResponse, errorResponse, validationErrorResponse } from '@/lib/auth/middleware';
import { setAuthCookie } from '@/lib/auth/cookie';

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  if (!isTestHelpersEnabled()) return testHelperDisabledResponse();

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) return validationErrorResponse(parsed.error, req);

  const { email, password } = parsed.data;

  // 查用户 + 返回**只脱敏**的字段（永远不暴露 passwordHash 本身）
  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      passwordHash: true,
      emailVerified: true,
      createdAt: true,
      lastLoginAt: true,
    },
  });

  if (!user) {
    return errorResponse('USER_NOT_FOUND', '账号不存在（DB 里查不到该 email）', 404, req);
  }

  // 不论密码对错，都返回 hash 长度 + 前 8 位（让用户能 debug "密码格式不对"）
  const hashLen = user.passwordHash?.length ?? 0;
  const hashPrefix = user.passwordHash?.slice(0, 7) ?? '<empty>';

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    return errorResponse(
      'INVALID_CREDENTIALS',
      `密码错误（passwordHash 长度=${hashLen}, 前缀=${hashPrefix}，bcrypt $2 开头说明是有效 hash）`,
      401,
      req
    );
  }

  // 密码正确 — 签 JWT + Set-Cookie（让用户能进 /interview/new 验证全链路）
  const token = await signSession({ userId: user.id, email: user.email });
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  const res = successResponse(
    {
      ok: true,
      userId: user.id,
      email: user.email,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
      // 不返回 passwordHash
    },
    200,
    req
  );
  setAuthCookie(res, token);
  return res;
}
