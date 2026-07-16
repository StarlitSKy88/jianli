/**
 * 统一环境变量校验 + 访问层（zod）
 *
 * 设计目标（解决 bug-019 衍生教训：dev/prod 不对称）：
 * - 懒校验：每个 env 第一次访问时才校验格式，避免一次性报错阻断整个进程
 * - 缺失关键 env 时，错误信息明确（不是 "JWT malformed"）
 * - 类型安全：env.JWT_SECRET 是 string，不再是 string | undefined
 *
 * 铁律：
 * - 不要在任意 lib 路径下直接读 process.env，必须走 requireEnv() / getOptionalEnv()
 * - 不要在请求路径上调 validateEnv()（启动期一次性即可）
 * - 启动期（next.config.js 或第一个请求）调一次 validateEnv()
 */
import { z } from 'zod';

// ============ 单 key schema 定义（懒校验，按需触发） ============

const Schemas = {
  JWT_SECRET: z.string().min(32, 'JWT_SECRET 必须 ≥ 32 字符（推荐 openssl rand -hex 32 生成）'),
  DATABASE_URL: z.string().url('DATABASE_URL 必须是合法 URL'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  USE_MOCK_AI: z
    .union([z.literal('0'), z.literal('1'), z.literal('true'), z.literal('false')])
    .default('0'),
  EMAIL_SENDER_MODE: z.enum(['console', 'ses']).default('console'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_SECURE: z
    .union([z.literal('0'), z.literal('1'), z.literal('true'), z.literal('false')])
    .optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().email().optional(),
  TURNSTILE_SECRET_KEY: z.string().optional(),
  TURNSTILE_SITE_KEY: z.string().optional(),
  ENABLE_TEST_HELPERS: z
    .union([z.literal('0'), z.literal('1'), z.literal('true'), z.literal('false')])
    .default('0'),
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
  NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional(),
  SENTRY_AUTH_TOKEN: z.string().optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
};

export type EnvKey = keyof typeof Schemas;
export type ValidatedEnv = { [K in EnvKey]: z.infer<(typeof Schemas)[K]> };

// 缓存：每个 key 独立缓存解析结果（含 default）
const _cache = new Map<string, unknown>();

/**
 * 重置缓存（仅测试用）
 */
export function _resetEnvCache(): void {
  _cache.clear();
}

/**
 * 懒校验：第一次读某个 env key 时校验 + 缓存。后续读直接走缓存。
 * 缺失/格式错时抛清晰错误。
 */
function readEnv<K extends EnvKey>(key: K): ValidatedEnv[K] {
  if (_cache.has(key)) return _cache.get(key) as ValidatedEnv[K];
  const raw = process.env[key];
  const schema = Schemas[key];
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(
      `[env] ${String(key)} 校验失败: ${issue?.message ?? 'unknown'}\n` +
        `  当前值: ${raw === undefined ? '<undefined>' : `"${raw.slice(0, 50)}"`}\n` +
        `💡 修复: .env.local 或 EdgeOne 控制台环境变量`
    );
  }
  _cache.set(key, result.data);
  return result.data as ValidatedEnv[K];
}

/**
 * 读取 env（必填字段缺失时抛错）
 */
export function getEnv<K extends EnvKey>(key: K): ValidatedEnv[K] {
  return readEnv(key);
}

/**
 * 显式读取 + 自定义错误信息
 */
export function requireEnv<K extends EnvKey>(key: K, hint?: string): ValidatedEnv[K] {
  try {
    return readEnv(key);
  } catch {
    throw new Error(`[env] 缺失关键环境变量: ${String(key)} ${hint ? `（${hint}）` : ''}`);
  }
}

/**
 * 启动期一次性校验多个 key。失败抛带全部问题的错误。
 * 推荐在 next.config.js 顶部调用一次。
 */
export function validateEnv(keys?: EnvKey[]): void {
  const toCheck = keys ?? (Object.keys(Schemas) as EnvKey[]);
  for (const key of toCheck) {
    readEnv(key); // 触发懒校验，错误自然抛出
  }
}
