/**
 * Admin 鉴权工具 — DRY 提取 (2026-07-23)
 *
 * Why this file exists:
 *   - 之前 6 个 admin 路由各自重复定义 ADMIN_EMAILS + isAdmin
 *   - turnstile-status 用了 toLowerCase + trim,其他 5 个只 trim 不 toLowerCase
 *   - Bug-004: 如果 ADMIN_EMAILS="Admin@X.com" 且 session.email="admin@x.com"
 *     → models/anchors 鉴权失败(漏 toLowerCase)
 *
 * 修复:
 *   - 统一在这里 toLowerCase + trim,所有 admin 路由 import 这个版本
 *   - 加单测 tests/unit/admin-auth.test.ts 验证一致性
 *
 * 使用方法:
 *   import { isAdmin } from '@/lib/auth/admin';
 *   if (!isAdmin(session.email)) return errorResponse('FORBIDDEN', ...);
 */

const ADMIN_EMAILS_RAW = process.env.ADMIN_EMAILS ?? '';

/**
 * Admin 邮箱白名单 — 解析 + 规范化
 *
 * 规范化策略:
 *   - 全部转小写(防大小写不一致)
 *   - 去掉前后空格(防 " admin@x.com , " 这种手抖)
 *   - 过滤空字符串(防末尾逗号产生空邮箱)
 *
 * 注意:这是 module-level 常量,每次模块加载时解析一次
 *   如果 ADMIN_EMAILS 在运行时变化(不应该),需要重启 server
 */
export const ADMIN_EMAILS: readonly string[] = ADMIN_EMAILS_RAW.split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

/**
 * 判断 email 是否为 admin
 *
 * @param email - 待检查的邮箱(支持 null/undefined)
 * @returns true = 是 admin, false = 不是 admin 或邮箱为空
 *
 * 设计:
 *   - email 也转小写后再比对,避免 env 是大写而 session 是小写
 *   - null/undefined 直接返回 false(类型安全)
 */
export function isAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.toLowerCase());
}
