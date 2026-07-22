/**
 * ScoreAnchor 单条管理 — 更新 / 软删除
 *
 * 路由：PUT /api/admin/anchors/:id    — 更新字段（仅允许改 humanScore / expected* / driftThreshold / tags / isActive）
 * 路由：DELETE /api/admin/anchors/:id — 软删除（isActive=false），保留历史
 *
 * 鉴权：仅 admin
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
import { isAdmin } from '@/lib/auth/admin';

// 仅允许更新评分相关字段，禁止改 company/role/level/dimension（这些是 anchor 的"身份"）
const UpdateSchema = z.object({
  questionText: z.string().min(20).max(2000).optional(),
  referenceAnswer: z.string().min(20).max(5000).optional(),
  humanScore: z.number().int().min(0).max(100).optional(),
  expectedScoreMin: z.number().int().min(0).max(100).optional(),
  expectedScoreMax: z.number().int().min(0).max(100).optional(),
  driftThreshold: z.number().int().min(1).max(50).optional(),
  tags: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
});

export async function PUT(req: NextRequest, ctx: { params: { id: string } }) {
  const session = await getSession(req);
  if (!session) return errorResponse('UNAUTHENTICATED', '未登录', 401);
  if (!isAdmin(session.email)) return errorResponse('FORBIDDEN', '需要管理员权限', 403);

  const parsed = UpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationErrorResponse(parsed.error);

  const existing = await prisma.scoreAnchor.findUnique({ where: { id: ctx.params.id } });
  if (!existing) return errorResponse('ANCHOR_NOT_FOUND', '锚点不存在', 404);

  // 校验：更新后的 humanScore 必须在新的 expected* 区间内
  const newMin = parsed.data.expectedScoreMin ?? existing.expectedScoreMin;
  const newMax = parsed.data.expectedScoreMax ?? existing.expectedScoreMax;
  const newHuman = parsed.data.humanScore ?? existing.humanScore;
  if (newMin > newMax) {
    return errorResponse('INVALID_RANGE', 'expectedScoreMin 必须 ≤ expectedScoreMax', 400);
  }
  if (newHuman < newMin || newHuman > newMax) {
    return errorResponse(
      'HUMAN_SCORE_OUT_OF_RANGE',
      `humanScore=${newHuman} 必须在 [${newMin}, ${newMax}] 区间内`,
      400
    );
  }

  const updated = await prisma.scoreAnchor.update({
    where: { id: ctx.params.id },
    data: parsed.data,
  });

  return successResponse({ anchor: updated });
}

export async function DELETE(req: NextRequest, ctx: { params: { id: string } }) {
  const session = await getSession(req);
  if (!session) return errorResponse('UNAUTHENTICATED', '未登录', 401);
  if (!isAdmin(session.email)) return errorResponse('FORBIDDEN', '需要管理员权限', 403);

  const existing = await prisma.scoreAnchor.findUnique({ where: { id: ctx.params.id } });
  if (!existing) return errorResponse('ANCHOR_NOT_FOUND', '锚点不存在', 404);

  // 软删除：isActive=false（保留历史 evaluation 引用）
  await prisma.scoreAnchor.update({
    where: { id: ctx.params.id },
    data: { isActive: false },
  });

  return successResponse({ deleted: true, id: ctx.params.id });
}
