/**
 * ScoreAnchor CRUD API — 评分锚点管理（admin 专用）
 *
 * GET  /api/admin/anchors         — 列出所有 anchor（支持 ?company=&dimension=&active= 过滤）
 * POST /api/admin/anchors         — 创建新 anchor
 *
 * PUT  /api/admin/anchors/[id]    — 更新 anchor（humanScore / expectedScoreRange / driftThreshold / isActive）
 * DELETE /api/admin/anchors/[id]  — 软删除（isActive=false），保留历史
 *
 * 鉴权：仅 admin（user.email 在 ADMIN_EMAILS 环境变量中）
 *
 * Why this exists:
 *   - T3.2 anchor 基础设施 — 让 PM/QA 能随时更新金标准答案
 *   - 漂移检测的 ground truth 来自人工打分，必须有 admin 维护入口
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

const COMPANY_VALUES = ['byte', 'ali', 'tencent', 'bili'] as const;
const DIMENSION_VALUES = [
  'tech',
  'project',
  'sysdesign',
  'algo',
  'cs',
  'culture',
  'star',
  'pressure',
] as const;

const CreateSchema = z
  .object({
    company: z.enum(COMPANY_VALUES),
    role: z.string().min(1).max(64),
    level: z.string().min(1).max(16),
    dimension: z.enum(DIMENSION_VALUES),
    questionText: z.string().min(20).max(2000),
    referenceAnswer: z.string().min(20).max(5000),
    humanScore: z.number().int().min(0).max(100),
    expectedScoreMin: z.number().int().min(0).max(100),
    expectedScoreMax: z.number().int().min(0).max(100),
    driftThreshold: z.number().int().min(1).max(50).optional(),
    tags: z.array(z.string()).optional(),
  })
  .refine((d) => d.expectedScoreMin <= d.expectedScoreMax, {
    message: 'expectedScoreMin 必须 ≤ expectedScoreMax',
    path: ['expectedScoreMin'],
  })
  .refine((d) => d.expectedScoreMin <= d.humanScore && d.humanScore <= d.expectedScoreMax, {
    message: 'humanScore 必须在 expectedScoreMin/Max 区间内',
    path: ['humanScore'],
  });

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return errorResponse('UNAUTHENTICATED', '未登录', 401);
  if (!isAdmin(session.email)) return errorResponse('FORBIDDEN', '需要管理员权限', 403);

  const url = new URL(req.url);
  const company = url.searchParams.get('company');
  const dimension = url.searchParams.get('dimension');
  const activeParam = url.searchParams.get('active');

  const where: Record<string, unknown> = {};
  if (company && (COMPANY_VALUES as readonly string[]).includes(company)) where.company = company;
  if (dimension && (DIMENSION_VALUES as readonly string[]).includes(dimension))
    where.dimension = dimension;
  if (activeParam === 'true') where.isActive = true;
  if (activeParam === 'false') where.isActive = false;

  const anchors = await prisma.scoreAnchor.findMany({
    where,
    orderBy: [{ company: 'asc' }, { dimension: 'asc' }, { humanScore: 'desc' }],
    take: 200,
    select: {
      id: true,
      company: true,
      role: true,
      level: true,
      dimension: true,
      questionText: true,
      referenceAnswer: true,
      humanScore: true,
      expectedScoreMin: true,
      expectedScoreMax: true,
      driftThreshold: true,
      tags: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { evaluations: true } },
    },
  });

  return successResponse({ anchors });
}

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return errorResponse('UNAUTHENTICATED', '未登录', 401);
  if (!isAdmin(session.email)) return errorResponse('FORBIDDEN', '需要管理员权限', 403);

  const parsed = CreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationErrorResponse(parsed.error);

  // 复合唯一：(company, role, level, dimension)
  const existing = await prisma.scoreAnchor.findFirst({
    where: {
      company: parsed.data.company,
      role: parsed.data.role,
      level: parsed.data.level,
      dimension: parsed.data.dimension,
    },
  });
  if (existing) {
    return errorResponse(
      'ANCHOR_EXISTS',
      `${parsed.data.company}/${parsed.data.role}/${parsed.data.level}/${parsed.data.dimension} 已存在`,
      409
    );
  }

  const anchor = await prisma.scoreAnchor.create({
    data: {
      company: parsed.data.company,
      role: parsed.data.role,
      level: parsed.data.level,
      dimension: parsed.data.dimension,
      questionText: parsed.data.questionText,
      referenceAnswer: parsed.data.referenceAnswer,
      humanScore: parsed.data.humanScore,
      expectedScoreMin: parsed.data.expectedScoreMin,
      expectedScoreMax: parsed.data.expectedScoreMax,
      driftThreshold: parsed.data.driftThreshold ?? 5,
      tags: parsed.data.tags ?? [],
      isActive: true,
    },
  });

  return successResponse({ anchor });
}
