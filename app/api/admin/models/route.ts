/**
 * GET /api/admin/models — 列出所有 AI provider 配置
 *
 * 鉴权：仅 admin（user.email 在 ADMIN_EMAILS 环境变量中）
 */
import { NextRequest } from 'next/server';
import { getSession, successResponse, errorResponse } from '@/lib/auth/middleware';
import { listProviders } from '@/lib/ai/admin-store';

function isAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.includes(email);
}

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return errorResponse('UNAUTHENTICATED', '未登录', 401);
  if (!isAdmin(session.email)) return errorResponse('FORBIDDEN', '需要管理员权限', 403);
  return successResponse({ providers: listProviders() });
}
