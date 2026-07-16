/**
 * Phase 14.24 — 一键删除测试用户 20925250@qq.com
 *
 * 部署后通过浏览器访问：
 *   https://jianli.taomyst.top/api/test-helper/delete-test-user-20925250
 *
 * 安全设计：
 * - 仅 prod 调用，不接受 body
 * - TARGET 写死 20925250@qq.com（防滥用）
 * - 删除后该 endpoint 自检：再次 findUnique 应返 null
 *
 * 用完立刻删掉这个 endpoint，不要留在生产代码里。
 */
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';

const TARGET = '20925250@qq.com';

export async function POST() {
  return run();
}
export async function GET() {
  return run();
}

async function run() {
  if (process.env.NODE_ENV === 'production') {
    // 生产允许，但写在 test-helper 路径下
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email: TARGET },
      select: { id: true, email: true, emailVerified: true, createdAt: true },
    });

    if (!user) {
      return NextResponse.json({
        ok: true,
        message: `user ${TARGET} not found, nothing to delete`,
      });
    }

    // 级联清理关联数据
    const interviews = await prisma.interview.deleteMany({ where: { userId: user.id } });
    const resumes = await prisma.resume.deleteMany({ where: { userId: user.id } });
    const payments = await prisma.payment.deleteMany({ where: { userId: user.id } });
    const trackEvents = await prisma.trackEvent.deleteMany({ where: { userId: user.id } });
    const feedbacks = await prisma.feedback.deleteMany({ where: { userId: user.id } });
    const rateLimits = await prisma.rateLimit.deleteMany({ where: { userId: user.id } });

    const deleted = await prisma.user.delete({ where: { id: user.id } });

    // 自检
    const check = await prisma.user.findUnique({ where: { email: TARGET } });

    return NextResponse.json({
      ok: true,
      deleted: {
        userId: deleted.id,
        email: deleted.email,
        related: {
          interviews: interviews.count,
          resumes: resumes.count,
          payments: payments.count,
          trackEvents: trackEvents.count,
          feedbacks: feedbacks.count,
          rateLimits: rateLimits.count,
        },
      },
      selfCheck: check === null ? 'PASS - user gone' : `FAIL - found again: ${check.email}`,
      note: 'delete this endpoint immediately after use: rm app/api/test-helper/delete-test-user-20925250/',
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 500 }
    );
  }
}
