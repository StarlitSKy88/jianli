/**
 * POST /api/admin/models/[id]/test — 连通性测试
 */
import { NextRequest } from 'next/server';
import { getSession, successResponse, errorResponse } from '@/lib/auth/middleware';
import { isAdmin } from '@/lib/auth/admin';
import { testProvider } from '@/lib/ai/admin-store';

const ALLOWED_IDS = ['minimax', 'claude', 'deepseek'] as const;
type ProviderId = (typeof ALLOWED_IDS)[number];

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  if (!session) return errorResponse('UNAUTHENTICATED', '未登录', 401);
  if (!isAdmin(session.email)) return errorResponse('FORBIDDEN', '需要管理员权限', 403);

  const id = params.id as ProviderId;
  if (!ALLOWED_IDS.includes(id)) {
    return errorResponse('INVALID_PROVIDER', `未知的 provider: ${params.id}`, 400);
  }

  const result = await testProvider(id);
  return successResponse(result);
}
