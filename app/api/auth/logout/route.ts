/**
 * POST /api/auth/logout — 清 cookie
 *
 * 用 maxAge=0 + 同 path=/ 显式过期，确保与 set 时的 path 匹配，
 * 否则某些浏览器会留下"无效 cookie"
 */
import { successResponse } from '@/lib/auth/middleware';
import { clearAuthCookie } from '@/lib/auth/cookie';

export async function POST() {
  const res = successResponse({ loggedOut: true });
  clearAuthCookie(res);
  return res;
}
