/**
 * GET /api/admin/models — 列出所有 AI provider 配置
 *
 * 鉴权：仅 admin（user.email 在 ADMIN_EMAILS 环境变量中）
 *
 * Bug-004 修复（2026-07-23）: 改用 lib/auth/admin.ts 共享 isAdmin,
 *   统一大小写处理(避免之前 models/anchors 漏 toLowerCase 导致鉴权失败)
 */
import { NextRequest } from 'next/server';
import { getSession, successResponse, errorResponse } from '@/lib/auth/middleware';
import { isAdmin } from '@/lib/auth/admin';
import { listProviders } from '@/lib/ai/admin-store';

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return errorResponse('UNAUTHENTICATED', '未登录', 401);
  if (!isAdmin(session.email)) return errorResponse('FORBIDDEN', '需要管理员权限', 403);
  return successResponse({ providers: listProviders() });
}
