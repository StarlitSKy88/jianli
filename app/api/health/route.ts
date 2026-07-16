/**
 * GET /api/health — 生产健康检查
 *
 * 设计目标：
 * - 快速（< 200ms）：让 UptimeRobot 等外部监控 5min 频率没问题
 * - 安全：不需要 auth，公开访问（不泄露任何用户数据）
 * - 状态自检：
 *   - DB 可达性（prisma $queryRaw SELECT 1） — **决定 ok 标志**
 *   - AI provider 配置状态 — **只作 warn 字段，不影响 ok**
 *   - 当前环境 + 版本
 *
 * 失败行为（Phase 15.5-B3 修复后）：
 * - DB 不可达 → 503 + body { ok: false, db: 'down' }   ← 真故障
 * - DB OK + AI 全未配 → 200 + body { ok: true, warn: 'NO_AI_PROVIDER' } ← 软警告
 * - DB OK + AI 配置 → 200 + body { ok: true, version }
 *
 * ⚠️ Bug B3 教训：早期版本要求 `db.ok && ai.enabled.length > 0` 才 200，
 * 导致 prod 无 AI key 时一直 503，UptimeRobot 误报警。AI 是业务功能而非基础设施，
 * 不该让健康检查 503。
 *
 * UptimeRobot 推荐监控路径：
 *  - 类型: HTTP(s)
 *  - URL: https://<your-domain>/api/health
 *  - 频率: 5 min
 *  - 超时: 5s
 *  - 关键字匹配: "ok":true  → 成功
 *                "ok":false → 失败告警
 *  - 告警策略：warn: 'NO_AI_PROVIDER' 仅在 dev 监控关注，prod 可忽略
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
    mockEnabled?: boolean;
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

function checkAiProviders(): {
  enabled: string[];
  total: number;
  mockEnabled: boolean;
} {
  // 显式检查每个 provider 是否会启用（不暴露 keys，只看有没有环境变量）
  const checks: Array<[string, () => boolean]> = [
    ['minimax', () => !!process.env.MINIMAX_API_KEY],
    ['openrouter', () => !!process.env.OPENROUTER_API_KEY],
    ['claude', () => !!process.env.ANTHROPIC_API_KEY || !!process.env.CLAUDE_API_KEY],
    ['deepseek', () => !!process.env.DEEPSEEK_API_KEY],
  ];
  const enabled = checks.filter(([, fn]) => fn()).map(([n]) => n);

  // Phase 14.4 mock provider：USE_MOCK_AI=1 时启用（独立于真实 provider 列表）
  const mockEnabled = process.env.USE_MOCK_AI === '1';

  return { enabled, total: checks.length, mockEnabled };
}

export async function GET() {
  const version = process.env.npm_package_version || '0.1.0';
  const env = process.env.NODE_ENV || 'development';

  const [db, ai] = await Promise.all([checkDb(), Promise.resolve(checkAiProviders())]);

  // B3 修复：ok 仅取决于 DB（基础设施），AI 是业务能力
  const ok = db.ok;
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

  // 软警告：DB OK 但没有任何 AI 能力可用（既无真实 provider，也未开 mock）
  if (ok && ai.enabled.length === 0 && !ai.mockEnabled) {
    body.warn = 'NO_AI_PROVIDER';
  }

  return NextResponse.json(body, { status });
}
