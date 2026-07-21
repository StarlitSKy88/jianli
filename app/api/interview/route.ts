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
import { loadPrompt, PromptLoadError } from '@/lib/agents/interviewer/prompt-loader';

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

  // Bug-029-B 修复：实体化 interviewerPrompt — 从 .knowledge/agents/{company}/system-prompt.md 读取真实 prompt
  // 之前是字面占位符 `system prompt for ${company} ${role} ${level}`，导致不同公司面试风格趋同
  // 失败 fallback：依然写占位符（不阻塞创建），但通过 console.error 暴露真凶
  let interviewerPrompt: string;
  try {
    const loaded = loadPrompt(parsed.data.company);
    interviewerPrompt = `${loaded.body}\n\n---\n\n## 当前任务上下文\n- 候选人岗位：${parsed.data.role}\n- 职级：${parsed.data.level}\n- 面试公司：${parsed.data.company.toUpperCase()}`;
  } catch (e) {
    if (e instanceof PromptLoadError) {
      console.error('[interview-create] interviewerPrompt 加载失败', {
        company: parsed.data.company,
        role: parsed.data.role,
        level: parsed.data.level,
        errorMessage: e.message,
      });
    }
    interviewerPrompt = `system prompt for ${parsed.data.company} ${parsed.data.role} ${parsed.data.level}`;
  }

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
      interviewerPrompt,
      scoringWeights: weights,
      difficultyPrompt: '',
    },
    update: {
      // 已存在的 scenario 也更新 interviewerPrompt（防止占位符旧数据滞留）
      interviewerPrompt,
    },
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
