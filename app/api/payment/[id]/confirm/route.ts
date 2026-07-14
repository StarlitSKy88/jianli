/**
 * POST /api/payment/[id]/confirm — mock 支付确认（dev only）
 *
 * 真接入（Phase 8）将由微信/支付宝回调触发，这里只用于开发自测。
 * 流程：在单个 Prisma 事务里把 Payment.status 改成 PAID，并把 User.paidQuota 按
 * Payment.quantity 累加。否则 paidQuota 永不写入，付费门槛失效（一次性 ¥9.9 = 无限）。
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { getSession, errorResponse } from '@/lib/auth/middleware';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (process.env.NODE_ENV === 'production') {
    return errorResponse('MOCK_DISABLED', '沙箱接口已关闭，生产请接微信/支付宝回调', 403);
  }

  const session = await getSession(req);
  if (!session) return errorResponse('UNAUTHENTICATED', '未登录', 401);

  // 用条件 updateMany + count 替代 findUnique+update，防并发 confirm 双重充值（TOCTOU）
  const result = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({
      where: { id: params.id },
      select: { id: true, userId: true, status: true, quantity: true },
    });
    if (!payment) return { kind: 'not_found' as const };
    if (payment.userId !== session.userId) return { kind: 'forbidden' as const };

    // 幂等：已支付直接返回，不重扣
    if (payment.status === 'PAID') return { kind: 'already_paid' as const };

    // 条件更新：只有 PENDING 才转 PAID，避免并发双扣
    const updated = await tx.payment.updateMany({
      where: { id: params.id, status: 'PENDING' },
      data: {
        status: 'PAID',
        transactionId: `mock-tx-${Date.now()}`,
        paidAt: new Date(),
      },
    });
    if (updated.count === 0) return { kind: 'race' as const };

    // 单事务内给 paidQuota 充值（quantity 是次数）
    await tx.user.update({
      where: { id: session.userId },
      data: { paidQuota: { increment: payment.quantity } },
    });

    return { kind: 'paid' as const, quantity: payment.quantity };
  });

  if (result.kind === 'not_found') return errorResponse('PAYMENT_NOT_FOUND', '订单不存在', 404);
  if (result.kind === 'forbidden') return errorResponse('FORBIDDEN', '无权操作他人订单', 403);
  if (result.kind === 'race') return errorResponse('PAYMENT_RACE', '订单状态竞争，请重试', 409);
  if (result.kind === 'already_paid') return NextResponse.json({ ok: true, alreadyPaid: true });

  return NextResponse.json({ ok: true, granted: result.quantity });
}
