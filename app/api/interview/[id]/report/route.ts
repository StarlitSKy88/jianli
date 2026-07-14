/**
 * GET /api/interview/[id]/report
 * 鉴权 → 返回该面试的 Report + AgentScores
 */
import { NextRequest } from 'next/server';
import { getSession, successResponse, errorResponse } from '@/lib/auth/middleware';
import { getReport } from '@/lib/scoring/persist';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  if (!session) return errorResponse('UNAUTHENTICATED', '未登录', 401);

  try {
    const report = await getReport(params.id, session.userId);
    if (!report) return errorResponse('REPORT_NOT_FOUND', '报告不存在', 404);
    return successResponse({ report });
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === 'forbidden') return errorResponse('FORBIDDEN', '无权查看他人报告', 403);
    if (msg === 'interview not found')
      return errorResponse('INTERVIEW_NOT_FOUND', '面试不存在', 404);
    console.warn(`[api/report] failed: ${msg}`);
    return errorResponse('REPORT_FAILED', '报告加载失败', 500);
  }
}
