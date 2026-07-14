/**
 * 限流中间件 — 免费 3 次/天，超出付费 ¥9.9/次
 *
 * 对齐 Prisma schema: RateLimit(userId, resourceType, windowStart)
 *
 * 流程：
 *  1. 已付费（payment.status=PAID + User.paidQuota > 0）→ 走付费路径：原子 decrement paidQuota
 *  2. 免费额度 → 走 RateLimit 表 upsert + increment，超过 FREE_DAILY_QUOTA 拒
 *
 * 安全：
 *  - 服务端从 DB 查 isPaid，不接受客户端传入（防 W4）
 *  - 同一事务内 decrement，防 TOCTOU
 */
import { prisma } from '@/lib/db/client';

export type RateLimitAction = 'interview' | 'message';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  paid: boolean;
  reason?: 'quota_exhausted' | 'unpaid';
}

const FREE_DAILY_QUOTA = 3;

/** 当日 0 点（UTC+8）作为 windowStart */
function windowStartOfDay(): Date {
  const now = new Date();
  const utc8Midnight = new Date(now.getTime() + 8 * 3600 * 1000);
  utc8Midnight.setUTCHours(0, 0, 0, 0);
  return new Date(utc8Midnight.getTime() - 8 * 3600 * 1000);
}

function endOfDay(): Date {
  const start = windowStartOfDay();
  return new Date(start.getTime() + 24 * 3600 * 1000 - 1);
}

/** 服务端根据 userId 判断是否真实有可用 paidQuota（不让客户端传 isPaid） */
export async function hasPaidQuota(userId: string): Promise<boolean> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { paidQuota: true },
  });
  return (u?.paidQuota ?? 0) > 0;
}

export async function checkLimit(
  userId: string,
  action: RateLimitAction
): Promise<RateLimitResult> {
  const resetAt = endOfDay();
  const windowStart = windowStartOfDay();

  // 服务端判断是否付费：检查 User.paidQuota
  const paidUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { paidQuota: true },
  });
  const paidQuota = paidUser?.paidQuota ?? 0;

  if (paidQuota > 0) {
    // 原子 decrement：若 decrement 后 < 0 自动拒。SQLite 不支持 conditional update 时用 updateMany
    const dec = await prisma.user.updateMany({
      where: { id: userId, paidQuota: { gt: 0 } },
      data: { paidQuota: { decrement: 1 } },
    });
    if (dec.count === 0) {
      // 并发竞态下没扣到，落到免费路径再判断
    } else {
      const remainingAfter = Math.max(0, paidQuota - 1);
      return { allowed: true, remaining: remainingAfter, resetAt, paid: true };
    }
  }

  // 免费路径：upsert + increment，count 超额就拒（W5: 这种"先写后判"审计难，但原子）
  // 修法：先 read 计数，< quota 时才 increment，否则直接 return allowed=false（不再递增）
  const existing = await prisma.rateLimit.findUnique({
    where: {
      userId_resourceType_windowStart: {
        userId,
        resourceType: action,
        windowStart,
      },
    },
    select: { count: true },
  });

  const currentCount = existing?.count ?? 0;
  if (currentCount >= FREE_DAILY_QUOTA) {
    return {
      allowed: false,
      remaining: 0,
      resetAt,
      paid: false,
      reason: 'quota_exhausted',
    };
  }

  const record = await prisma.rateLimit.upsert({
    where: {
      userId_resourceType_windowStart: {
        userId,
        resourceType: action,
        windowStart,
      },
    },
    create: { userId, resourceType: action, windowStart, count: 1 },
    update: { count: { increment: 1 } },
  });

  const remaining = Math.max(0, FREE_DAILY_QUOTA - record.count);
  return {
    allowed: record.count <= FREE_DAILY_QUOTA,
    remaining,
    resetAt,
    paid: false,
  };
}

/**
 * 兼容旧接口：保留 isPaid 参数但忽略（强制服务端验证）。
 * 已废弃 — 上游应该直接调 checkLimit(userId, action)。
 * @deprecated v0.2 — 请使用两参版本
 */
export async function checkLimitLegacy(
  userId: string,
  action: RateLimitAction,
  _isPaid: boolean
): Promise<RateLimitResult> {
  return checkLimit(userId, action);
}
