/**
 * JWT session 单元测试
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { signSession, verifySession } from './session';

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long-OK';
});

describe('session', () => {
  it('sign 后 verify 返回相同 payload', async () => {
    const token = await signSession({ userId: 'u1', email: 'a@b.com' });
    const p = await verifySession(token);
    expect(p?.userId).toBe('u1');
    expect(p?.email).toBe('a@b.com');
  });

  it('错误 token 返回 null', async () => {
    const p = await verifySession('not-a-jwt');
    expect(p).toBeNull();
  });

  it('伪造 token 返回 null', async () => {
    const p = await verifySession('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fake.signature');
    expect(p).toBeNull();
  });
});
