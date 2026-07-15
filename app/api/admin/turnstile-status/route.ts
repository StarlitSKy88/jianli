/**
 * GET /api/admin/turnstile-status
 *
 * 内部诊断：检查 Turnstile 是否配好（用于部署后验证）
 *
 * 鉴权：需要 admin 邮箱（与 /api/admin/models 一致）
 */
import { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/auth/middleware';

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export async function GET(req: NextRequest) {
  // 简单鉴权：admin 邮箱白名单（从 query 参数看 email）
  const url = new URL(req.url);
  const checkEmail = url.searchParams.get('email')?.toLowerCase();
  if (!checkEmail || !ADMIN_EMAILS.includes(checkEmail)) {
    return errorResponse('FORBIDDEN', 'admin only', 403);
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
