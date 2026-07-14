/**
 * GET /api/resume — 当前用户简历列表
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/client';
import { getSession, successResponse, errorResponse } from '@/lib/auth/middleware';

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return errorResponse('UNAUTHENTICATED', '未登录', 401);

  const list = await prisma.resume.findMany({
    where: { userId: session.userId },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true,
      name: true,
      yearsOfExperience: true,
      createdAt: true,
    },
  });
  return successResponse({ resumes: list });
}
