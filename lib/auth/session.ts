/**
 * JWT session 管理 — 用 jose 库（轻量、现代）
 *
 * 设计要点：
 * - HS256 算法 + secret ≥ 32 字符
 * - 默认 7 天过期（可配置）
 * - 失败统一返回 null（不泄露原因）
 */
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

const ALG = 'HS256';

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET 未设置或短于 32 字符');
  }
  return new TextEncoder().encode(secret);
}

function getExpiry(): string {
  return process.env.JWT_EXPIRES_IN || '7d';
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
