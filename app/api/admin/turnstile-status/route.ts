/**
 * GET /api/admin/turnstile-status
 *
 * 内部诊断：检查 Turnstile 是否配好（用于部署后验证）
 *
 * 鉴权：与 /api/admin/models /api/admin/anchors 一致 ——
 *   必须先登录(session cookie),且 email 在 ADMIN_EMAILS 白名单内
 *
 * Bug-003 修复（2026-07-23）:
 *   之前用 query 参数 ?email= 鉴权,任何人都能绕过认证读 admin 状态
 *   改用 getSession() + isAdmin() 统一鉴权
 */
import { NextRequest } from 'next/server';
import { successResponse, errorResponse, getSession } from '@/lib/auth/middleware';

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

function isAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.toLowerCase());
}

export async function GET(req: NextRequest) {
  // Bug-003 修复：统一用 session 鉴权，不再信任 query 参数
  const session = await getSession(req);
  if (!session) {
    return errorResponse('UNAUTHENTICATED', '需要登录', 401, req);
  }
  if (!isAdmin(session.email)) {
    return errorResponse('FORBIDDEN', '需要管理员权限', 403, req);
  }

  const siteKeySet = !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const secretSet = !!process.env.TURNSTILE_SECRET_KEY;
  const isProd = process.env.NODE_ENV === 'production';

  return successResponse({
    siteKeySet,
    secretSet,
    isProd,
    mode: isProd ? 'enforce' : 'dev-skip-if-secret-missing',
    siteKeyPreview: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
      ? process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY.slice(0, 12) + '...'
      : null,
    hint: !siteKeySet
      ? '前端 widget 不会渲染（用户看不到 CAPTCHA）'
      : !secretSet
        ? '后端会返回 500（fail-closed）'
        : '✅ 前后端都配好',
  });
}
