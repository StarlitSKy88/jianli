/**
 * 邮箱验证码服务
 *
 * 存储：使用 User 表的 verifyCode + verifyExpiry 字段
 * 流程：
 *   1) sendVerifyCode(email) — 生成 6 位随机码 + 存 User.verifyCode + 设 verifyExpiry = now+10min
 *   2) verifyCode(email, code) — 比对 + 用后即焚（清空 verifyCode）
 *
 * 注意：邮件发送是 side effect，主流程先更新 DB 再调用 sender
 */

import { prisma } from '@/lib/db/client';
import { getEmailSender } from '@/lib/email';

const CODE_TTL_MIN = 10; // 验证码 10 分钟有效
const RESEND_COOLDOWN_SEC = 60; // 同邮箱 60 秒内只能发一次

export type SendResult =
  | { ok: true; cooldownSec: number }
  | { ok: false; reason: 'COOLDOWN' | 'USER_EXISTS' | 'INVALID_EMAIL'; cooldownSec?: number };

/**
 * 发送验证码
 *
 * 业务规则：
 * - 邮箱已注册 → 拒绝（防枚举）
 * - 60 秒内重复发 → 拒绝（防刷）
 * - 验证码 6 位数字
 */
export async function sendVerifyCode(rawEmail: string): Promise<SendResult> {
  const email = rawEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, reason: 'INVALID_EMAIL' };
  }

  // 已注册检查（防枚举 + 防止给已存在用户重发码）
  // 关键：只有 passwordHash 非空 才算「已注册」
  // pending user（验证中但未注册）应该允许重发码
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, verifyExpiry: true, emailVerified: true, passwordHash: true },
  });
  if (existing && existing.passwordHash && existing.passwordHash.length > 0) {
    return { ok: false, reason: 'USER_EXISTS' };
  }

  // 冷却检查 + 创建 pending user
  // 用 upsert 拿到 userId（pending 时 emailVerified=false + passwordHash=''）
  const user = await prisma.user.upsert({
    where: { email },
    create: {
      email,
      passwordHash: '', // pending 占位
      emailVerified: false,
    },
    update: {},
    select: { id: true, verifyExpiry: true },
  });

  if (user.verifyExpiry) {
    const remaining = Math.ceil((user.verifyExpiry.getTime() - Date.now()) / 1000);
    const totalTtl = CODE_TTL_MIN * 60;
    const elapsed = totalTtl - remaining;
    if (elapsed < RESEND_COOLDOWN_SEC) {
      return { ok: false, reason: 'COOLDOWN', cooldownSec: RESEND_COOLDOWN_SEC - elapsed };
    }
  }

  const code = generateCode();
  const expiry = new Date(Date.now() + CODE_TTL_MIN * 60_000);

  await prisma.user.update({
    where: { id: user.id },
    data: { verifyCode: code, verifyExpiry: expiry },
  });

  // 发邮件（失败不影响主流程，但记录）
  const sender = getEmailSender();
  const sendResult = await sender.send({
    to: email,
    subject: '【面试陪练】您的验证码',
    text: `您的注册验证码是：${code}\n\n10 分钟内有效，请尽快使用。\n\n如果不是您本人操作，请忽略此邮件。`,
    html: `<div style="font-family:-apple-system,sans-serif;max-width:480px;margin:auto;padding:24px">
      <h2 style="color:#37352f">面试陪练</h2>
      <p>您的注册验证码：</p>
      <div style="font-size:32px;font-weight:700;letter-spacing:8px;color:#2eaadc;padding:16px;text-align:center;background:#f7f7f5;border-radius:8px">${code}</div>
      <p style="color:#787774;font-size:13px;margin-top:16px">10 分钟内有效，请尽快使用。</p>
      <hr style="border:none;border-top:1px solid #e9e9e7;margin:24px 0"/>
      <p style="color:#9b9a97;font-size:12px">如果不是您本人操作，请忽略此邮件。</p>
    </div>`,
  });

  if (!sendResult.ok) {
    // eslint-disable-next-line no-console
    console.warn(`[verify-code] email send failed for ${email}: ${sendResult.error}`);
  }

  return { ok: true, cooldownSec: RESEND_COOLDOWN_SEC };
}

/**
 * 校验验证码 + 标记 email 已验证
 *
 * 返回值：
 * - ok: true → userId
 * - ok: false → reason
 */
export async function consumeVerifyCode(
  email: string,
  code: string
): Promise<
  { ok: true; userId: string } | { ok: false; reason: 'NOT_FOUND' | 'EXPIRED' | 'MISMATCH' }
> {
  const e = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email: e },
    select: { id: true, verifyCode: true, verifyExpiry: true },
  });
  if (!user) return { ok: false, reason: 'NOT_FOUND' };
  if (!user.verifyCode || !user.verifyExpiry) return { ok: false, reason: 'NOT_FOUND' };
  if (user.verifyExpiry.getTime() < Date.now()) return { ok: false, reason: 'EXPIRED' };
  if (user.verifyCode !== code) return { ok: false, reason: 'MISMATCH' };

  // 校验通过 — 标记 verified + 清空 verifyCode（防重放）
  await prisma.user.update({
    where: { id: user.id },
    data: { verifyCode: null, verifyExpiry: null, emailVerified: true },
  });

  return { ok: true, userId: user.id };
}

// ============ Phase 14.32 密码重置流程 ============

export type ResetSendResult =
  | { ok: true; cooldownSec: number }
  | { ok: false; reason: 'COOLDOWN' | 'USER_NOT_FOUND' | 'INVALID_EMAIL'; cooldownSec?: number };

/**
 * 发送密码重置验证码（已注册用户专用）
 *
 * 业务规则：
 * - 邮箱**未注册** → 拒绝（USER_NOT_FOUND）
 * - 60 秒内重复发 → 拒绝（防刷）
 * - 验证码 6 位数字
 *
 * 与 sendVerifyCode 的区别：
 * - sendVerifyCode：发注册验证码（已注册拒绝）
 * - sendPasswordResetCode：发重置验证码（未注册拒绝）
 */
export async function sendPasswordResetCode(rawEmail: string): Promise<ResetSendResult> {
  const email = rawEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, reason: 'INVALID_EMAIL' };
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, verifyExpiry: true, passwordHash: true },
  });
  if (!user || !user.passwordHash || user.passwordHash.length === 0) {
    return { ok: false, reason: 'USER_NOT_FOUND' };
  }

  if (user.verifyExpiry) {
    const remaining = Math.ceil((user.verifyExpiry.getTime() - Date.now()) / 1000);
    const totalTtl = CODE_TTL_MIN * 60;
    const elapsed = totalTtl - remaining;
    if (elapsed < RESEND_COOLDOWN_SEC) {
      return { ok: false, reason: 'COOLDOWN', cooldownSec: RESEND_COOLDOWN_SEC - elapsed };
    }
  }

  const code = generateCode();
  const expiry = new Date(Date.now() + CODE_TTL_MIN * 60_000);

  await prisma.user.update({
    where: { id: user.id },
    data: { verifyCode: code, verifyExpiry: expiry },
  });

  const sender = getEmailSender();
  const sendResult = await sender.send({
    to: email,
    subject: '【面试陪练】密码重置验证码',
    text: `您的密码重置验证码是：${code}\n\n10 分钟内有效，请尽快使用。\n\n如果不是您本人操作，请忽略此邮件。`,
    html: `<div style="font-family:-apple-system,sans-serif;max-width:480px;margin:auto;padding:24px">
      <h2 style="color:#37352f">面试陪练 · 密码重置</h2>
      <p>您正在重置账户密码，验证码：</p>
      <div style="font-size:32px;font-weight:700;letter-spacing:8px;color:#2eaadc;padding:16px;text-align:center;background:#f7f7f5;border-radius:8px">${code}</div>
      <p style="color:#787774;font-size:13px;margin-top:16px">10 分钟内有效，请尽快使用。</p>
      <hr style="border:none;border-top:1px solid #e9e9e7;margin:24px 0"/>
      <p style="color:#9b9a97;font-size:12px">如果不是您本人操作，请忽略此邮件。</p>
    </div>`,
  });

  if (!sendResult.ok) {
    // eslint-disable-next-line no-console
    console.warn(`[password-reset] email send failed for ${email}: ${sendResult.error}`);
  }

  return { ok: true, cooldownSec: RESEND_COOLDOWN_SEC };
}

/**
 * 重置密码（不消费 verifyCode，留给 reset-password route 自行清空）
 *
 * 返回值：
 * - ok: true → userId
 * - ok: false → reason
 */
export async function consumeResetCode(
  email: string,
  code: string
): Promise<
  { ok: true; userId: string } | { ok: false; reason: 'NOT_FOUND' | 'EXPIRED' | 'MISMATCH' }
> {
  const e = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email: e },
    select: { id: true, verifyCode: true, verifyExpiry: true, passwordHash: true },
  });
  if (!user || !user.passwordHash || user.passwordHash.length === 0) {
    return { ok: false, reason: 'NOT_FOUND' };
  }
  if (!user.verifyCode || !user.verifyExpiry) return { ok: false, reason: 'NOT_FOUND' };
  if (user.verifyExpiry.getTime() < Date.now()) return { ok: false, reason: 'EXPIRED' };
  if (user.verifyCode !== code) return { ok: false, reason: 'MISMATCH' };
  return { ok: true, userId: user.id };
}

function generateCode(): string {
  // 6 位数字（100000-999999，排除前导 0 简化输入）
  return Math.floor(100000 + Math.random() * 900000).toString();
}
