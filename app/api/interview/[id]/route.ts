/**
 * GET /api/interview/[id] — 查询面试详情
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/client';
import { getSession, successResponse, errorResponse } from '@/lib/auth/middleware';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  if (!session) return errorResponse('UNAUTHENTICATED', '未登录', 401);

  const iv = await prisma.interview.findUnique({
    where: { id: params.id },
    include: {
      scenario: true,
      messages: { orderBy: { createdAt: 'asc' }, take: 200 },
    },
  });
  if (!iv) return errorResponse('INTERVIEW_NOT_FOUND', '面试不存在', 404);
  if (iv.userId !== session.userId) return errorResponse('FORBIDDEN', '无权访问他人面试', 403);

  return successResponse({ interview: iv });
}
