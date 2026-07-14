/**
 * 防刷号三件套
 *
 * 1) 蜜罐字段（Honeypot）：表单里塞一个隐藏 input，机器人会填，真人不会
 * 2) IP 限流：同一 IP 在窗口内只能调用 N 次
 * 3) Turnstile：Cloudflare 无感 CAPTCHA（防高级机器人）
 *
 * 设计原则：
 * - 全部 **fail-closed**（检测到滥用 → 拒绝，但不告诉对方具体原因）
 * - 全部 **fast**（< 5ms，不阻塞主流程）
 * - 全部 **server-side trust**（前端绕过不算）
 */

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
 * @param key 限流 key（通常是 IP 或 IP+endpoint）
 * @param maxHits 窗口内最大次数
 * @param windowMs 窗口大小（毫秒）
 * @returns true = 允许，false = 拒绝
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
  // 清理过期 hit
  bucket.hits = bucket.hits.filter((t) => now - t < windowMs);
  if (bucket.hits.length >= maxHits) {
    return false;
  }
  bucket.hits.push(now);
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

/** 默认配置：注册/发码 限流 */
export const RATE_LIMITS = {
  register: { maxHits: 3, windowMs: 5 * 60_000 }, // 5 分钟内 3 次
  sendVerifyCode: { maxHits: 1, windowMs: 60_000 }, // 60s 内 1 次（与 verify-code 内部 cooldown 互补）
  login: { maxHits: 10, windowMs: 5 * 60_000 }, // 5 分钟内 10 次
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
