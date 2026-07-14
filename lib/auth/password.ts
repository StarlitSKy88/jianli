/**
 * 密码加密/校验 — bcrypt 实现
 *
 * 设计要点：
 * - cost factor ≥ 10（M2 Mac 单次 hash 约 100ms，足够强）
 * - 每次 hash 都自动生成 salt（bcrypt 内置）
 * - 失败不返回具体原因（防 user enumeration）
 */
import * as bcrypt from 'bcryptjs';

const COST_FACTOR = 10;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST_FACTOR);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}
