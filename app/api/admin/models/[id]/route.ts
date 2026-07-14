/**
 * PATCH /api/admin/models/[id] — 更新 provider 配置
 * GET    /api/admin/models/[id] — 查询 provider 配置
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import {
  getSession,
  successResponse,
  errorResponse,
  validationErrorResponse,
} from '@/lib/auth/middleware';
import { updateProvider, getProviderConfig } from '@/lib/ai/admin-store';

const UpdateSchema = z.object({
  enabled: z.boolean().optional(),
  model: z.string().max(100).optional(),
  baseURL: z.string().url().optional(),
  apiKey: z.string().min(1).max(500).optional(),
});

function isAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.includes(email);
}

const ALLOWED_IDS = ['minimax', 'claude', 'deepseek'] as const;
type ProviderId = (typeof ALLOWED_IDS)[number];

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  if (!session) return errorResponse('UNAUTHENTICATED', '未登录', 401);
  if (!isAdmin(session.email)) return errorResponse('FORBIDDEN', '需要管理员权限', 403);

  const id = params.id as ProviderId;
  if (!ALLOWED_IDS.includes(id)) {
    return errorResponse('INVALID_PROVIDER', `未知的 provider: ${params.id}`, 400);
  }

  const parsed = UpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationErrorResponse(parsed.error);

  const updated = updateProvider(id, parsed.data);
  return successResponse({ provider: updated });
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  if (!session) return errorResponse('UNAUTHENTICATED', '未登录', 401);
  if (!isAdmin(session.email)) return errorResponse('FORBIDDEN', '需要管理员权限', 403);

  const p = getProviderConfig(params.id as ProviderId);
  if (!p) return errorResponse('PROVIDER_NOT_FOUND', `未找到 provider: ${params.id}`, 404);
  return successResponse({ provider: p });
}
