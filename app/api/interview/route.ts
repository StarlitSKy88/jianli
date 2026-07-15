/**
 * POST /api/interview — 创建面试
 * GET  /api/interview — 列出当前用户的面试
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/client';
import {
  getSession,
  successResponse,
  errorResponse,
  validationErrorResponse,
} from '@/lib/auth/middleware';
import { track } from '@/lib/analytics/track';
import { DIMENSION_WEIGHTS } from '@/lib/scoring/dimensions';

const CreateSchema = z.object({
  company: z.enum(['byte', 'ali', 'tencent', 'bili']),
  role: z.string().min(1).max(50),
  level: z.string().min(1).max(10),
  resumeId: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return errorResponse('UNAUTHENTICATED', '未登录', 401);

  const parsed = CreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationErrorResponse(parsed.error);

  // 校验简历归属
  const resume = await prisma.resume.findUnique({ where: { id: parsed.data.resumeId } });
  if (!resume) return errorResponse('RESUME_NOT_FOUND', '简历不存在', 404);
  if (resume.userId !== session.userId) return errorResponse('FORBIDDEN', '无权使用他人简历', 403);

  const weights = DIMENSION_WEIGHTS[parsed.data.company] as unknown as object;
  const scenario = await prisma.scenario.upsert({
    where: {
      company_role_level: {
        company: parsed.data.company,
        role: parsed.data.role,
        level: parsed.data.level,
      },
    },
    create: {
      company: parsed.data.company,
      role: parsed.data.role,
      level: parsed.data.level,
      interviewerPrompt: `system prompt for ${parsed.data.company} ${parsed.data.role} ${parsed.data.level}`,
      scoringWeights: weights,
      difficultyPrompt: '',
    },
    update: {},
  });

  const interview = await prisma.interview.create({
    data: {
      userId: session.userId,
      resumeId: parsed.data.resumeId,
      scenarioId: scenario.id,
      status: 'IN_PROGRESS',
      isFreeQuota: true,
    },
    select: { id: true, status: true, startedAt: true },
  });

  track(session.userId, 'interview_started', {
    company: parsed.data.company,
    role: parsed.data.role,
    level: parsed.data.level,
  });

  return successResponse({ id: interview.id, status: interview.status });
}

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return errorResponse('UNAUTHENTICATED', '未登录', 401);

  const list = await prisma.interview.findMany({
    where: { userId: session.userId },
    orderBy: { startedAt: 'desc' },
    take: 50,
    select: {
      id: true,
      status: true,
      startedAt: true,
      totalScore: true,
      scenario: { select: { company: true, role: true, level: true } },
    },
  });
  return successResponse({ interviews: list });
}
