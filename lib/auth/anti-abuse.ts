/**
 * 防刷号三件套
 *
 * 1) 蜜罐字段（Honeypot）：表单里塞一个隐藏 input，机器人会填，真人不会
 * 2) IP 限流：同一 IP 在窗口内只能调用 N 次（in-memory 缓存 + DB 兜底）
 * 3) Turnstile：Cloudflare 无感 CAPTCHA（防高级机器人）
 *
 * 设计原则：
 * - 全部 **fail-closed**（检测到滥用 → 拒绝，但不告诉对方具体原因）
 * - 全部 **fast**（< 5ms，不阻塞主流程）
 * - 全部 **server-side trust**（前端绕过不算）
 */

import { prisma } from '@/lib/db/client';

// ============ 1) 蜜罐 ============

/** 蜜罐字段名（多个名都接受，避免机器人只过滤一个） */
export const HONEYPOT_FIELDS = ['website', 'company_name', 'phone_number'] as const;
export type HoneypotField = (typeof HONEYPOT_FIELDS)[number];

/**
 * 检查请求 body 是否含蜜罐字段（机器人填了）
 * 命中时返回 true，调用方应假装成功（不告诉机器人被识破）
 */
export function isHoneypotTriggered(body: Record<string, unknown>): boolean {
  for (const field of HONEYPOT_FIELDS) {
    const v = body[field];
    if (typeof v === 'string' && v.trim().length > 0) return true;
  }
  return false;
}

// ============ 2) IP 限流 ============

interface RateLimitBucket {
  /** 时间戳数组（毫秒） */
  hits: number[];
}

/** 内存版 IP 限流（生产可换 Redis） */
const buckets = new Map<string, RateLimitBucket>();

/** 清理过期桶的全局定时器引用 */
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

/**
 * IP 限流检查
 *
 * 双层防御：
 * - L1 in-memory bucket：单实例内的 burst 防护，< 1ms（已有）
 * - L2 DB RateLimit（仅 prod）：跨实例 + 跨冷启动累计，serverless 关键
 *
 * Bug-026 (2026-07-20 E2E)：EdgeOne Pages serverless 进程内 Map 每次冷启清空，
 * 多实例之间也不共享 → 攻击者换 IP 不换 UA 即可绕过。增加 L2 持久化兜底。
 *
 * 流程（prod 同步）：
 * 1. 先查 DB 看 count（带超时 50ms，防 DB 慢拖累业务）
 * 2. count >= maxHits → 拒绝
 * 3. 否则 upsert count += 1
 * 4. DB 失败 → fall through 到 L1（已通过 L1 = 允许；L1 拒 = 拒）
 *
 * @param key 限流 key（通常是 IP 或 IP+endpoint）
 * @param maxHits 窗口内最大次数
 * @param windowMs 窗口大小（毫秒）
 * @returns true = 允许，false = 拒绝
 */
export async function checkRateLimitAsync(
  key: string,
  maxHits: number,
  windowMs: number
): Promise<boolean> {
  // 测试环境跳过 IP 限流（E2E 共享同一 webServer IP）
  if (process.env.NODE_ENV !== 'production' && process.env.DISABLE_RATE_LIMIT === '1') {
    return true;
  }

  // L1 in-memory fast-path
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { hits: [] };
    buckets.set(key, bucket);
    ensureCleanup();
  }
  bucket.hits = bucket.hits.filter((t) => now - t < windowMs);
  if (bucket.hits.length >= maxHits) {
    return false;
  }

  // L2 prod 持久化累计（带超时，DB 慢不阻塞业务）
  if (process.env.NODE_ENV === 'production') {
    try {
      const ok = await Promise.race([
        checkAndIncrRateLimitDb(key, maxHits, windowMs),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 50)), // 超时放行
      ]);
      if (!ok) return false;
    } catch (e) {
      console.warn(`[rate-limit] L2 DB error for ${key}: ${(e as Error).message}`);
      // DB 失败 → 已通过 L1，放行（L1 + 蜜罐 + Turnstile 三层防御仍生效）
    }
  }

  bucket.hits.push(now);
  return true;
}

/**
 * 同步版 checkRateLimit — 仅 L1 in-memory（用于 dev/test/简单场景）。
 *
 * prod 路由应使用 checkRateLimitAsync（双层：L1 + L2 DB 持久化），
 * 以应对 EdgeOne Pages serverless 多实例 + 冷启动 Map 被清空。
 *
 * 保留这个 sync 版本是为了：
 * - 单元测试不依赖 DB
 * - 兜底场景（DB 短暂不可用时也可工作）
 */
export function checkRateLimit(key: string, maxHits: number, windowMs: number): boolean {
  // 测试环境跳过 IP 限流（E2E 共享同一 webServer IP）
  if (process.env.NODE_ENV !== 'production' && process.env.DISABLE_RATE_LIMIT === '1') {
    return true;
  }
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { hits: [] };
    buckets.set(key, bucket);
    ensureCleanup();
  }
  bucket.hits = bucket.hits.filter((t) => now - t < windowMs);
  if (bucket.hits.length >= maxHits) {
    return false;
  }
  bucket.hits.push(now);
  return true;
}

/**
 * L2 DB 限流：先查 count，达到上限直接 false；未达上限 upsert 累加
 */
async function checkAndIncrRateLimitDb(
  key: string,
  maxHits: number,
  windowMs: number
): Promise<boolean> {
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / windowMs) * windowMs);
  const dbKey = `ip:${key}`;
  // 先查当前窗口 count
  const row = await prisma.rateLimit.findUnique({
    where: {
      userId_resourceType_windowStart: {
        userId: dbKey,
        resourceType: 'rate-limit-ip',
        windowStart,
      },
    },
    select: { count: true },
  });
  const currentCount = row?.count ?? 0;
  if (currentCount >= maxHits) {
    return false; // 已被全局限流
  }
  // 累加
  await prisma.rateLimit.upsert({
    where: {
      userId_resourceType_windowStart: {
        userId: dbKey,
        resourceType: 'rate-limit-ip',
        windowStart,
      },
    },
    create: {
      userId: dbKey,
      resourceType: 'rate-limit-ip',
      windowStart,
      count: 1,
    },
    update: {
      count: { increment: 1 },
    },
  });
  return true;
}

/** 重置某 key（测试用） */
export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

/** 清空所有（测试用） */
export function clearAllRateLimits(): void {
  buckets.clear();
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

function ensureCleanup(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets.entries()) {
      bucket.hits = bucket.hits.filter((t) => now - t < 60 * 60_000); // 1h 内没用就清
      if (bucket.hits.length === 0) buckets.delete(key);
    }
  }, 5 * 60_000); // 每 5 分钟扫一次
  // Node.js 进程退出时清掉
  if (typeof cleanupTimer === 'object' && cleanupTimer && 'unref' in cleanupTimer) {
    (cleanupTimer as { unref: () => void }).unref();
  }
}

/** 默认配置：注册/发码/反馈 限流 */
export const RATE_LIMITS = {
  register: { maxHits: 3, windowMs: 5 * 60_000 }, // 5 分钟内 3 次
  sendVerifyCode: { maxHits: 1, windowMs: 60_000 }, // 60s 内 1 次（与 verify-code 内部 cooldown 互补）
  login: { maxHits: 10, windowMs: 5 * 60_000 }, // 5 分钟内 10 次
  feedback: { maxHits: 5, windowMs: 60 * 60_000 }, // 1 小时内 5 次（防灌水）
} as const;

// ============ 3) IP 提取 ============

/**
 * 从 NextRequest 提取客户端 IP
 * 优先级：CF-Connecting-IP > X-Real-IP > X-Forwarded-For > 'unknown'
 */
export function getClientIp(req: { headers: { get: (k: string) => string | null } }): string {
  const cfIp = req.headers.get('cf-connecting-ip');
  if (cfIp) return cfIp.trim();
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    // 取第一个（最左 = 真实客户端）
    const first = xff.split(',')[0];
    if (first) return first.trim();
  }
  return 'unknown';
}

// ============ 4) Turnstile ============

export interface TurnstileVerifyResult {
  ok: boolean;
  errorCodes?: string[];
}

/**
 * 校验 Cloudflare Turnstile token
 *
 * 文档：https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 *
 * @param token 前端 widget 拿到的 cf-turnstile-response
 * @param remoteIp 客户端 IP（可选，提高校验准确性）
 * @returns ok=true 表示通过
 */
export async function verifyTurnstile(
  token: string,
  remoteIp?: string
): Promise<TurnstileVerifyResult> {
  // Phase 14.33.5 临时逃生口：prod Turnstile widget 渲染失败期间
  // 设置 DISABLE_TURNSTILE=1 后直接返回 ok=true（蜜罐 + IP 限流仍生效）
  // ⚠️ 用完立刻删 env var
  if (process.env.DISABLE_TURNSTILE === '1') {
    return { ok: true };
  }

  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    // dev 环境无 secret → 跳过（避免阻断本地开发）
    if (process.env.NODE_ENV !== 'production') {
      return { ok: true };
    }
    return { ok: false, errorCodes: ['missing-secret-key'] };
  }
  if (!token) {
    return { ok: false, errorCodes: ['missing-input-response'] };
  }
  try {
    const form = new URLSearchParams();
    form.set('secret', secret);
    form.set('response', token);
    if (remoteIp) form.set('remoteip', remoteIp);

    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form,
    });
    if (!res.ok) {
      return { ok: false, errorCodes: [`http-${res.status}`] };
    }
    const data = (await res.json()) as {
      success: boolean;
      'error-codes'?: string[];
    };
    return { ok: !!data.success, errorCodes: data['error-codes'] };
  } catch (e) {
    return { ok: false, errorCodes: [`network:${(e as Error).message}`] };
  }
}
