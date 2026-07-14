/**
 * GET /api/auth/me — 返回当前用户信息
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/client';
import { getSession, successResponse, errorResponse } from '@/lib/auth/middleware';

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return errorResponse('UNAUTHENTICATED', '未登录', 401);

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      email: true,
      nickname: true,
      avatarUrl: true,
      emailVerified: true,
      freeQuotaUsed: true,
      paidQuota: true,
      createdAt: true,
    },
  });

  if (!user) return errorResponse('USER_NOT_FOUND', '用户不存在', 404);
  return successResponse(user);
}
