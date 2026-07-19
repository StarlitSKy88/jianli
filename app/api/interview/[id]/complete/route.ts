/**
 * POST /api/interview/[id]/complete
 * 标记面试为已完成 + 触发评分持久化
 *
 * Bug-028 (2026-07-20 E2E)：之前前端 finish() 仅 router.push，message route 的
 * saveReport 路径从未被触发（前端不发 finish:true）。导致 Report 表永远为空，
 * 用户进 report 页看到 "加载失败"。
 *
 * 流程：
 * 1. 鉴权 + 校验 interview 归属当前 user
 * 2. 幂等：已 COMPLETED 直接返回 reportId
 * 3. update status=COMPLETED + endedAt=now + durationSec
 * 4. scoreOne 并发跑所有非零维度 → aggregate → saveReport
 * 5. 返回 reportId，前端跳 report 页能立即拿到数据
 *
 * 注：EdgeOne Pages cloud-functions 默认 30s timeout，mock 8 维度 ~8s 足够；
 * 真实 LLM 需要更长 → 已设 maxDuration=60s。后续 Phase 15+ 可迁移异步队列。
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/client';
import { getSession, successResponse, errorResponse } from '@/lib/auth/middleware';
import { scoreOne } from '@/lib/scoring/scorer';
import { aggregate } from '@/lib/scoring/aggregator';
import { saveReport } from '@/lib/scoring/persist';
import { DIMENSION_WEIGHTS, activeDimensions } from '@/lib/scoring/dimensions';
import { track } from '@/lib/analytics/track';
import type { InterviewerType } from '@/lib/agents/interviewer/types';

export const maxDuration = 60; // 8 维度 × 真实 LLM ≈ 30-50s

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  if (!session) return errorResponse('UNAUTHENTICATED', '未登录', 401);

  const interview = await prisma.interview.findUnique({
    where: { id: params.id },
    include: { scenario: true, messages: { orderBy: { createdAt: 'asc' }, take: 200 } },
  });
  if (!interview) return errorResponse('INTERVIEW_NOT_FOUND', '面试不存在', 404);
  if (interview.userId !== session.userId) {
    return errorResponse('FORBIDDEN', '无权操作他人面试', 403);
  }

  // 幂等：已 COMPLETED 直接返回现有 reportId
  if (interview.status === 'COMPLETED') {
    const existing = await prisma.report.findUnique({
      where: { interviewId: interview.id },
      select: { id: true, totalScore: true },
    });
    return successResponse({
      interview: { id: interview.id, status: 'COMPLETED' },
      report: existing ? { id: existing.id, totalScore: existing.totalScore } : null,
      idempotent: true,
    });
  }

  const endedAt = new Date();
  const durationSec = Math.round((endedAt.getTime() - interview.startedAt.getTime()) / 1000);

  await prisma.interview.update({
    where: { id: interview.id },
    data: {
      status: 'COMPLETED',
      endedAt,
      durationSec,
    },
  });
  track(session.userId, 'interview_completed', { interviewId: interview.id });

  // 评分（与 message route finish 路径保持一致）
  try {
    const company = interview.scenario.company as InterviewerType;
    const dims = activeDimensions(company);

    // 把 prisma message 转成 scoreOne 期望的格式
    const transcript = interview.messages.map((m) => ({
      role: m.role === 'INTERVIEWER' ? ('assistant' as const) : ('user' as const),
      content: m.content,
    }));

    const scoreEntries = await Promise.all(
      dims.map(async (dim) => {
        const score = await scoreOne({
          company,
          role: interview.scenario.role,
          level: interview.scenario.level,
          dimension: dim,
          transcript,
        });
        return [dim, score] as const;
      })
    );
    const scores = Object.fromEntries(scoreEntries) as Record<
      string,
      (typeof scoreEntries)[number][1]
    >;

    const report = aggregate({ company, scores });
    const { reportId } = await saveReport({
      interviewId: interview.id,
      userId: session.userId,
      company: interview.scenario.company,
      scores,
      aggregated: report,
    });
    await prisma.interview.update({
      where: { id: interview.id },
      data: { totalScore: report.totalScore },
    });

    return successResponse({
      interview: { id: interview.id, status: 'COMPLETED', endedAt, durationSec },
      report: { id: reportId, totalScore: report.totalScore },
    });
  } catch (e) {
    console.warn(`[complete] scoring failed for ${interview.id}: ${(e as Error).message}`);
    // 评分失败不影响 status 已更新；用户可在 report 页重试
    return successResponse({
      interview: { id: interview.id, status: 'COMPLETED', endedAt, durationSec },
      report: null,
      scoringError: (e as Error).message,
    });
  }
}
