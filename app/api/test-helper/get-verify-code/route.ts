/**
 * GET /api/_test/get-verify-code?email=...
 *
 * 测试钩子（仅 dev 启用）— 拿最近一次发送的验证码
 * 用于 Playwright E2E：UI 触发 send-verify-code 后，从 DB 读出 code 用于 register
 *
 * 安全：
 * - 仅 process.env.NODE_ENV !== 'production' 时挂载
 * - 用 ENV_GUARD 拦截（生产 404）
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/client';
import { errorResponse, successResponse } from '@/lib/auth/middleware';

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return errorResponse('NOT_FOUND', 'Endpoint disabled in production', 404);
  }
  const email = req.nextUrl.searchParams.get('email');
  if (!email) return errorResponse('INVALID_EMAIL', '缺少 email 参数', 400);

  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { verifyCode: true, verifyExpiry: true },
  });
  if (!user?.verifyCode) {
    return errorResponse('NO_CODE', '该邮箱没有待验证的验证码', 404);
  }
  if (user.verifyExpiry && user.verifyExpiry.getTime() < Date.now()) {
    return errorResponse('EXPIRED', '验证码已过期', 410);
  }
  return successResponse({ code: user.verifyCode });
}
