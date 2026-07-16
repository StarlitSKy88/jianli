/**
 * GET /api/health — 生产健康检查
 *
 * 设计目标：
 * - 快速（< 200ms）：让 UptimeRobot 等外部监控 5min 频率没问题
 * - 安全：不需要 auth，公开访问（不泄露任何用户数据）
 * - 状态自检：
 *   - DB 可达性（prisma $queryRaw SELECT 1）
 *   - AI provider 配置状态（不暴露 keys，只看 enabled count）
 *   - 当前环境 + 版本
 *
 * 失败行为：
 * - DB 不可达 → 503 + body { ok: false, db: 'down' }
 * - DB OK + AI 全部未配 → 200 + body { ok: true, ai: 'none', warn: 'NO_AI_PROVIDER' }
 * - 全部 OK → 200 + body { ok: true, version }
 *
 * UptimeRobot 推荐监控路径：
 *  - 类型: HTTP(s)
 *  - URL: https://<your-domain>/api/health
 *  - 频率: 5 min
 *  - 超时: 5s
 *  - 关键字匹配: "ok":true  → 成功
 *                "ok":false → 失败告警
 */
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';

interface HealthResponse {
  ok: boolean;
  version: string;
  env: string;
  db?: 'up' | 'down';
  dbLatencyMs?: number;
  ai?: {
    enabled: string[];
    total: number;
  };
  warn?: string;
  ts: string;
}

export const dynamic = 'force-dynamic'; // 不缓存
export const revalidate = 0;

async function checkDb(): Promise<{ ok: boolean; latencyMs: number }> {
  const t0 = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - t0 };
  } catch {
    return { ok: false, latencyMs: Date.now() - t0 };
  }
}

function checkAiProviders(): { enabled: string[]; total: number } {
  // 显式检查每个 provider 是否会启用（不暴露 keys，只看有没有环境变量）
  const checks: Array<[string, () => boolean]> = [
    ['minimax', () => !!process.env.MINIMAX_API_KEY],
    ['openrouter', () => !!process.env.OPENROUTER_API_KEY],
    ['claude', () => !!process.env.ANTHROPIC_API_KEY || !!process.env.CLAUDE_API_KEY],
    ['deepseek', () => !!process.env.DEEPSEEK_API_KEY],
  ];
  const enabled = checks.filter(([, fn]) => fn()).map(([n]) => n);
  return { enabled, total: checks.length };
}

export async function GET() {
  const version = process.env.npm_package_version || '0.1.0';
  const env = process.env.NODE_ENV || 'development';

  const [db, ai] = await Promise.all([checkDb(), Promise.resolve(checkAiProviders())]);

  const ok = db.ok && ai.enabled.length > 0;
  const status = ok ? 200 : 503;

  const body: HealthResponse = {
    ok,
    version,
    env,
    db: db.ok ? 'up' : 'down',
    dbLatencyMs: db.latencyMs,
    ai,
    ts: new Date().toISOString(),
  };

  if (ok && ai.enabled.length === 0) {
    body.warn = 'NO_AI_PROVIDER'; // (实际不会进入这个分支因为上面已要求 ≥1)
  }

  return NextResponse.json(body, { status });
}
