/**
 * JWT session 管理 — 用 jose 库（轻量、现代）
 *
 * 设计要点：
 * - HS256 算法 + secret ≥ 32 字符
 * - 默认 7 天过期（可配置）
 * - 失败统一返回 null（不泄露原因）
 */
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { getEnv } from '@/lib/env';

const ALG = 'HS256';

function getSecret(): Uint8Array {
  // 启动期已校验：必 ≥ 32 字符
  const secret = getEnv('JWT_SECRET');
  return new TextEncoder().encode(secret);
}

function getExpiry(): string {
  return getEnv('JWT_EXPIRES_IN');
}

export interface SessionPayload extends JWTPayload {
  userId: string;
  email: string;
}

export async function signSession(payload: { userId: string; email: string }): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(getExpiry())
    .sign(getSecret());
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (typeof payload.userId !== 'string' || typeof payload.email !== 'string') {
      return null;
    }
    return payload as SessionPayload;
  } catch {
    return null;
  }
}
