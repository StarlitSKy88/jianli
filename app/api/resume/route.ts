/**
 * GET /api/resume — 当前用户简历列表
 *
 * B12 修复：select 缺失 parsed + techStack 字段，导致前端
 * `r.parsed?.skills?.slice(0,5).join(' / ')` 永远 fallback 到
 * '未提取技能'，且 type assertion `r.parsed as Resume['parsed']`
 * 存在运行时隐患。
 *
 * 现在返回与 /api/resume/upload 一致的 schema，避免前端
 * 防御性 cast + 让用户看到真实提取的技能列表。
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/client';
import { getSession, successResponse, errorResponse } from '@/lib/auth/middleware';

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return errorResponse('UNAUTHENTICATED', '未登录', 401);

  const list = await prisma.resume.findMany({
    where: { userId: session.userId },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true,
      name: true,
      yearsOfExperience: true,
      techStack: true,
      parsed: true,
      createdAt: true,
    },
  });
  // Normalize：parsed 缺失/非对象时返回 {} 而非 undefined，让前端
  // r.parsed?.skills 始终有兜底空对象 (避免隐式 undefined 异常)
  // 包含: null/undefined/数组/字符串 都视为脏数据 → {}
  const normalized = list.map((r) => {
    const p = r.parsed;
    const parsed =
      p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
    const ts = Array.isArray(r.techStack) ? r.techStack : [];
    return { ...r, parsed, techStack: ts };
  });
  return successResponse({ resumes: normalized });
}
