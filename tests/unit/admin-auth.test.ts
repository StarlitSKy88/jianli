/**
 * Admin 鉴权工具单测 — 防止 Bug-004 复发
 *
 * Bug-004: 之前 6 个 admin 路由各自重复定义 isAdmin(),models/anchors
 *   漏调 toLowerCase,导致 ADMIN_EMAILS="Admin@X.com" + session="admin@x.com"
 *   鉴权失败。DRY 提取到 lib/auth/admin.ts 后,所有路由用同一份,加此单测锁定行为。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('isAdmin', () => {
  const originalEnv = process.env.ADMIN_EMAILS;

  beforeEach(() => {
    // 每个 case 重置,避免互相污染
    process.env.ADMIN_EMAILS = 'admin@x.com, Super@Y.COM  ,  ,user@z.com';
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.ADMIN_EMAILS;
    } else {
      process.env.ADMIN_EMAILS = originalEnv;
    }
  });

  it('匹配小写 admin email', async () => {
    const { isAdmin } = await import('@/lib/auth/admin');
    expect(isAdmin('admin@x.com')).toBe(true);
  });

  it('大小写不敏感(防 Bug-004 复发)', async () => {
    const { isAdmin } = await import('@/lib/auth/admin');
    // env 里有 "Super@Y.COM",session 是小写
    expect(isAdmin('super@y.com')).toBe(true);
    expect(isAdmin('SUPER@Y.COM')).toBe(true);
    expect(isAdmin('Super@y.Com')).toBe(true);
  });

  it('不在白名单返回 false', async () => {
    const { isAdmin } = await import('@/lib/auth/admin');
    expect(isAdmin('hacker@evil.com')).toBe(false);
    expect(isAdmin('admin')).toBe(false); // 不完整 email
  });

  it('null/undefined/空字符串 返回 false', async () => {
    const { isAdmin } = await import('@/lib/auth/admin');
    expect(isAdmin(null)).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
    expect(isAdmin('')).toBe(false);
  });

  it('env 里的空格被 trim', async () => {
    // beforeEach 设置了 " Super@Y.COM  " (前后空格)
    const { isAdmin } = await import('@/lib/auth/admin');
    expect(isAdmin('super@y.com')).toBe(true);
  });

  it('env 里的空邮箱(末尾逗号)被过滤', async () => {
    // beforeEach 设置了 ",  ," 这种空段
    const { isAdmin } = await import('@/lib/auth/admin');
    // 不应该匹配到空字符串
    expect(isAdmin('')).toBe(false);
    expect(isAdmin(' ')).toBe(false);
  });

  it('env 未设置时全部 false', async () => {
    delete process.env.ADMIN_EMAILS;
    // 必须重新 import 才能让 module-level 常量重新求值
    vi.resetModules();
    const { isAdmin } = await import('@/lib/auth/admin');
    expect(isAdmin('anyone@x.com')).toBe(false);
  });
});

describe('ADMIN_EMAILS export', () => {
  it('导出 readonly 数组', async () => {
    const { ADMIN_EMAILS } = await import('@/lib/auth/admin');
    expect(Array.isArray(ADMIN_EMAILS)).toBe(true);
    // 全部小写
    for (const e of ADMIN_EMAILS) {
      expect(e).toBe(e.toLowerCase());
    }
    // 无空字符串
    expect(ADMIN_EMAILS.every((e) => e.length > 0)).toBe(true);
  });
});
