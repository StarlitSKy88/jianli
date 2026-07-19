/**
 * GET /api/interview/[id]/report
 * 鉴权 → 返回该面试的 Report + AgentScores
 *
 * 响应 envelope（双形状兼容）：
 *   {
 *     ok: true,
 *     data: { report },   ← 新前端（d.data.report）
 *     report,             ← 老前端（d.report 直读）— Bug-028 dual-envelope
 *   }
 *
 * Bug-028 dual-envelope 背景：
 *   Bug-028 修复把 /report 改回 successResponse envelope（标准 {ok,data}）。
 *   但 prod 老前端期望 d.report（顶层直读）。EdgeOne 部署有 5-10 分钟延迟，
 *   等部署完才能让 prod 老前端解析新形状——期间用户卡"加载中…"。
 *   折中：在 envelope 顶层同时挂一份 report，两端都能解析。
 *   Phase 15 全量统一 envelope 后清理。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession, errorResponse } from '@/lib/auth/middleware';
import { getReport } from '@/lib/scoring/persist';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  if (!session) return errorResponse('UNAUTHENTICATED', '未登录', 401);

  try {
    const report = await getReport(params.id, session.userId);
    if (!report) return errorResponse('REPORT_NOT_FOUND', '报告不存在', 404);
    // 双形状：data.report（新前端）+ 顶层 report（老前端 d.report 直读）
    return NextResponse.json({ ok: true, data: { report }, report });
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === 'forbidden') return errorResponse('FORBIDDEN', '无权查看他人报告', 403);
    if (msg === 'interview not found')
      return errorResponse('INTERVIEW_NOT_FOUND', '面试不存在', 404);
    console.warn(`[api/report] failed: ${msg}`);
    return errorResponse('REPORT_FAILED', '报告加载失败', 500);
  }
}
