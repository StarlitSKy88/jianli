/**
 * 共享 Cookie 工具 — 所有认证/会话 cookie 必须经过这里
 *
 * 安全属性（OWASP Top 10 — A07:2021 Identification and Authentication Failures）：
 * - httpOnly: true   — 防 XSS 窃 token
 * - secure: NODE_ENV=production 时 true — 仅 https 传输
 * - sameSite: 'lax'  — 防 CSRF（顶层导航带 cookie，跨站 POST 不带）
 * - path: '/'         — 全站可用，logout 时必须 path=/ 才能删干净
 *
 * 不要直接把 cookieName/options 散在 login/logout 各处：未来要加 __Host- 前缀
 * （防 subdomain 攻击）、partitioned（防第三方 cookie 滥用）只改一处。
 */

import type { NextResponse } from 'next/server';

export const AUTH_COOKIE_NAME = 'token';

/** 7 天 = 60 * 60 * 24 * 7 */
export const AUTH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export interface AuthCookieOptions {
  maxAge?: number;
}

/**
 * 在 NextResponse 上 set auth cookie
 * - 用法：res.cookies 里拿到的是 ResponseCookies（Next.js 包装），它接受 name/value/options
 */
export function setAuthCookie(
  res: NextResponse,
  token: string,
  opts: AuthCookieOptions = {}
): void {
  res.cookies.set(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: opts.maxAge ?? AUTH_COOKIE_MAX_AGE_SECONDS,
  });
}

/**
 * 清除 auth cookie
 * - 必须 path=/ 才对得上 set 时的 path
 * - maxAge=0 即立即过期
 */
export function clearAuthCookie(res: NextResponse): void {
  res.cookies.set(AUTH_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

/**
 * 一行式：删 auth cookie 并返回原 res（兼容 response.cookies.delete）
 *
 * 两种行为都给实现：调用方按场景选。
 *   - clearAuthCookie(res)：显式 set maxAge=0，跨浏览器最稳
 *   - deleteAuthCookie(res)：调 ResponseCookies.delete，部分浏览器版本对 missing path 的删除更干净
 */
export function deleteAuthCookie(res: NextResponse): void {
  res.cookies.delete(AUTH_COOKIE_NAME);
}
