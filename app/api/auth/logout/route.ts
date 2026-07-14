/**
 * POST /api/auth/logout — 清 cookie
 */
import { successResponse } from '@/lib/auth/middleware';

export async function POST() {
  const res = successResponse({ loggedOut: true });
  res.cookies.delete('token');
  return res;
}
