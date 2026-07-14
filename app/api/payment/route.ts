/**
 * 支付接口（MVP mock — 真支付走 Phase 8 接入微信/支付宝）
 *
 * POST /api/payment — 创建 Payment（PENDING）
 * GET  /api/payment — 当前用户支付列表
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { prisma } from '@/lib/db/client';
import {
  getSession,
  successResponse,
  errorResponse,
  validationErrorResponse,
} from '@/lib/auth/middleware';
import { track } from '@/lib/analytics/track';

const PRICE_CNY = 990; // ¥9.9 = 990 分

const CreateSchema = z.object({
  quantity: z.number().int().min(1).max(100).default(1),
});

function genOutTradeNo(): string {
  return `mock-${Date.now()}-${randomBytes(4).toString('hex')}`;
}

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return errorResponse('UNAUTHENTICATED', '未登录', 401);

  const json = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(json);
  if (!parsed.success) return validationErrorResponse(parsed.error);

  const payment = await prisma.payment.create({
    data: {
      userId: session.userId,
      amount: PRICE_CNY * parsed.data.quantity,
      outTradeNo: genOutTradeNo(),
      productType: 'interview_quota',
      quantity: parsed.data.quantity,
    },
    select: { id: true, outTradeNo: true, amount: true, status: true },
  });

  track(session.userId, 'pay_click', { paymentId: payment.id, amount: payment.amount });

  return successResponse({
    payment,
    // mock 支付链接（前端跳这个 URL 直接标记为已支付）
    mockPayUrl: `/api/payment/${payment.id}/confirm`,
  });
}

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return errorResponse('UNAUTHENTICATED', '未登录', 401);

  const list = await prisma.payment.findMany({
    where: { userId: session.userId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return successResponse({ payments: list });
}
