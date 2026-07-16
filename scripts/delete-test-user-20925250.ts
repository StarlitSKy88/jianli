/**
 * Phase 14.24 — 一键删除 prod 测试用户 20925250@qq.com
 * 用 prisma client 直连 TiDB → 删 User + 关联 (TrackEvent / Resume / Interview / Feedback 等)
 * 谨慎使用：仅在用户明确请求时执行。
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const target = '20925250@qq.com';
  console.log(`[delete] searching for user: ${target}`);

  const user = await prisma.user.findUnique({
    where: { email: target },
    select: { id: true, email: true, createdAt: true, emailVerified: true },
  });

  if (!user) {
    console.log('[delete] user not found, nothing to do');
    return;
  }

  console.log(
    `[delete] found: id=${user.id} verified=${user.emailVerified} created=${user.createdAt.toISOString()}`
  );

  // 关联数据清理（按 FK 级联顺序）
  const interview = await prisma.interview.deleteMany({ where: { userId: user.id } });
  const resume = await prisma.resume.deleteMany({ where: { userId: user.id } });
  const payment = await prisma.payment.deleteMany({ where: { userId: user.id } });
  const trackEvent = await prisma.trackEvent.deleteMany({ where: { userId: user.id } });
  const feedback = await prisma.feedback.deleteMany({ where: { userId: user.id } });
  const rateLimit = await prisma.rateLimit.deleteMany({ where: { userId: user.id } });

  console.log(`[delete] related rows removed:`, {
    interview: interview.count,
    resume: resume.count,
    payment: payment.count,
    trackEvent: trackEvent.count,
    feedback: feedback.count,
    rateLimit: rateLimit.count,
  });

  const deleted = await prisma.user.delete({ where: { id: user.id } });
  console.log(`[delete] user ${deleted.email} (id=${deleted.id}) removed`);
}

main()
  .catch((e) => {
    console.error('[delete] error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
