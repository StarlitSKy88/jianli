/**
 * 密码模块单元测试
 */
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('password', () => {
  it('相同密码两次 hash 不同（自动 salt）', async () => {
    const h1 = await hashPassword('MySecureP@ss123');
    const h2 = await hashPassword('MySecureP@ss123');
    expect(h1).not.toBe(h2);
  });

  it('hash 后可被 verify 通过', async () => {
    const hash = await hashPassword('correct-password');
    expect(await verifyPassword('correct-password', hash)).toBe(true);
  });

  it('错误密码 verify 返回 false', async () => {
    const hash = await hashPassword('correct-password');
    expect(await verifyPassword('wrong-password', hash)).toBe(false);
  });

  it('空字符串 verify 返回 false', async () => {
    const hash = await hashPassword('any');
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('hash 长度 ≥ 50 字符（bcrypt 标准）', async () => {
    const h = await hashPassword('test');
    expect(h.length).toBeGreaterThanOrEqual(50);
  });
});
