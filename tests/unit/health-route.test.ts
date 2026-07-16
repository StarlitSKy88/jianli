/**
 * /api/health 路由单元测试 — Phase 15.5 Bug B3 修复固化
 *
 * 关键行为契约（防止再 regress）：
 * 1. DB up + AI 配 → 200 + ok: true
 * 2. DB up + AI 未配 → 200 + ok: true + warn: 'NO_AI_PROVIDER'（不是 503）
 * 3. DB down → 503 + ok: false（不管 AI 状态）
 * 4. mock provider (USE_MOCK_AI=1) 算作 AI 可用，不触发 warn
 * 5. health 不应返回 passwordHash / token / 任何 PII
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// vitest hoisting 修复：vi.mock factory 不能引用顶层变量，必须用 vi.hoisted
const { mockQueryRaw } = vi.hoisted(() => ({
  mockQueryRaw: vi.fn().mockResolvedValue([{ '1': 1 }]),
}));

// Mock prisma — DB up
vi.mock('@/lib/db/client', () => ({
  prisma: {
    $queryRaw: mockQueryRaw,
  },
}));

// Mock NextResponse.json to capture args
vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      body,
      status: init?.status ?? 200,
    }),
  },
}));

// 必须先 import route（mock 在 import 之前生效）
import { GET } from '@/app/api/health/route';

describe('/api/health — Bug B3 修复固化', () => {
  beforeEach(() => {
    mockQueryRaw.mockClear();
    delete process.env.MINIMAX_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.USE_MOCK_AI;
  });

  it('场景 1：DB up + AI 全配 → 200 + ok: true', async () => {
    process.env.MINIMAX_API_KEY = 'test-key';
    process.env.OPENROUTER_API_KEY = 'test-key';

    const res = await GET();
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.db).toBe('up');
    expect((body.ai as { enabled: string[] }).enabled).toContain('minimax');
    expect(body.warn).toBeUndefined();
  });

  it('场景 2：DB up + AI 全未配 + USE_MOCK_AI=0 → 200 + ok: true + warn: NO_AI_PROVIDER', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.db).toBe('up');
    expect(body.warn).toBe('NO_AI_PROVIDER');
    // 关键：不应该是 503（B3 修复的核心）
    expect(res.status).not.toBe(503);
  });

  it('场景 3：DB down → 503 + ok: false（不管 AI）', async () => {
    mockQueryRaw.mockRejectedValueOnce(new Error('DB connection refused'));

    process.env.MINIMAX_API_KEY = 'test-key'; // 即使 AI 有配，DB 挂也是 503

    const res = await GET();
    expect(res.status).toBe(503);
    const body = res.body as Record<string, unknown>;
    expect(body.ok).toBe(false);
    expect(body.db).toBe('down');
  });

  it('场景 4：USE_MOCK_AI=1 + 无真实 provider → 200 + ok: true + 不 warn', async () => {
    process.env.USE_MOCK_AI = '1';

    const res = await GET();
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.warn).toBeUndefined();
    expect((body.ai as { mockEnabled: boolean }).mockEnabled).toBe(true);
  });

  it('场景 5：返回 body 不含 PII / secrets / tokens', async () => {
    process.env.MINIMAX_API_KEY = 'super-secret-key-do-not-leak';
    process.env.USE_MOCK_AI = '1';

    const res = await GET();
    const body = res.body as Record<string, unknown>;
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('super-secret-key-do-not-leak');
    expect(serialized).not.toMatch(/password/i);
    expect(serialized).not.toMatch(/token/i);
    expect(serialized).not.toMatch(/hash/i);
  });

  it('场景 6：DB latency 数字有效（> 0 且 < 5s）', async () => {
    const res = await GET();
    const body = res.body as Record<string, unknown>;
    const latency = body.dbLatencyMs as number;
    expect(latency).toBeGreaterThanOrEqual(0);
    expect(latency).toBeLessThan(5000);
  });
});
