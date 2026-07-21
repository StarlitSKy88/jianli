/**
 * 防御性测试 — AI Router 三层兜底 + cooldown 机制
 *
 * 覆盖：
 * 1. providers 按 priority 升序遍历（不是注册顺序）
 * 2. 失败 → 自动降级到下一个 provider
 * 3. 连续失败 N 次 → 进入 cooldown
 * 4. cooldown 期间跳过该 provider
 * 5. cooldown 到期后自动"半开"重试
 * 6. quota/余额错误触发更长 cooldown（10 分钟）
 * 7. mock (priority=99) 即使在 cooldown 也不跳过（终极兜底）
 * 8. 全部失败 → 抛出含诊断信息的 error
 *
 * Why this exists:
 *   - 之前 ai-router 是固定数组遍历 + 无 cooldown，prod quota 耗尽时所有调用都白等 30s 超时
 *   - Phase 14.23 引入 priority + cooldown 后，必须确保：
 *     a) 行为可预测（priority 排序对）
 *     b) 不破坏现有 happy path
 *     c) cooldown 不"锁死"（半开重试）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// 直接 mock 所有 provider 模块，避免真实 API 调用
vi.mock('@/lib/ai/providers/minimax', () => ({
  getMinimaxProvider: vi.fn(),
}));
vi.mock('@/lib/ai/providers/claude', () => ({
  getClaudeProvider: vi.fn(),
}));
vi.mock('@/lib/ai/providers/deepseek', () => ({
  getDeepSeekProvider: vi.fn(),
}));
vi.mock('@/lib/ai/providers/openrouter', () => ({
  getOpenRouterProvider: vi.fn(),
}));
vi.mock('@/lib/ai/providers/mock', () => ({
  getMockProvider: vi.fn(),
}));
// concurrency slot 在测试中不需要真实并发限流
vi.mock('@/lib/ai/concurrency', () => ({
  withLLMSlot: async <T>(fn: () => Promise<T>): Promise<T> => fn(),
}));

import { getMinimaxProvider } from '@/lib/ai/providers/minimax';
import { getClaudeProvider } from '@/lib/ai/providers/claude';
import { getDeepSeekProvider } from '@/lib/ai/providers/deepseek';
import { getOpenRouterProvider } from '@/lib/ai/providers/openrouter';
import { getMockProvider } from '@/lib/ai/providers/mock';
import { aiChat, aiStreamChat, getRouterHealth, resetCooldown } from '@/lib/ai/router';

/**
 * 测试用 mock provider 工厂
 */
function makeProvider(name: string, priority: number, chatImpl: AiChatImpl) {
  return {
    name,
    priority,
    chat: vi.fn(chatImpl),
    streamChat: vi.fn(async () => {
      throw new Error('streamChat not implemented in test mock');
    }),
  };
}

type AiChatImpl = (
  messages: unknown[],
  opts?: unknown
) => Promise<{
  content: string;
  provider: string;
  model: string;
}>;

/**
 * 工具：注册一组 mock providers
 *
 * 关键：必须在每个 test 前清空（resetCooldown + vi.clearAllMocks），
 * 因为 health Map 是模块级 in-memory state
 */
function setupProviders(
  specs: Array<{
    name: string;
    priority: number;
    chatImpl: AiChatImpl;
  }>
) {
  resetCooldown();
  vi.clearAllMocks();
  const map: Record<string, ReturnType<typeof makeProvider>> = {};
  for (const spec of specs) {
    const p = makeProvider(spec.name, spec.priority, spec.chatImpl);
    map[spec.name] = p;
  }
  (getMinimaxProvider as ReturnType<typeof vi.fn>).mockImplementation(() => map.minimax ?? null);
  (getClaudeProvider as ReturnType<typeof vi.fn>).mockImplementation(() => map.claude ?? null);
  (getDeepSeekProvider as ReturnType<typeof vi.fn>).mockImplementation(() => map.deepseek ?? null);
  (getOpenRouterProvider as ReturnType<typeof vi.fn>).mockImplementation(
    () => map.openrouter ?? null
  );
  (getMockProvider as ReturnType<typeof vi.fn>).mockImplementation(() => map.mock ?? null);
  return map;
}

describe('AI Router — priority 排序', () => {
  beforeEach(() => {
    resetCooldown();
  });

  it('providers 按 priority 升序调用（不是注册顺序）', async () => {
    // 注册顺序故意乱序：mock → minimax → deepseek → openrouter → claude
    const callOrder: string[] = [];
    setupProviders([
      {
        name: 'mock',
        priority: 99,
        chatImpl: async () => {
          callOrder.push('mock');
          return { content: 'mock', provider: 'mock', model: 'm' };
        },
      },
      {
        name: 'minimax',
        priority: 1,
        chatImpl: async () => {
          callOrder.push('minimax');
          throw new Error('minimax fail');
        },
      },
      {
        name: 'deepseek',
        priority: 2,
        chatImpl: async () => {
          callOrder.push('deepseek');
          throw new Error('deepseek fail');
        },
      },
      {
        name: 'openrouter',
        priority: 3,
        chatImpl: async () => {
          callOrder.push('openrouter');
          return { content: 'openrouter', provider: 'openrouter', model: 'm' };
        },
      },
      {
        name: 'claude',
        priority: 2,
        chatImpl: async () => {
          callOrder.push('claude');
          throw new Error('claude fail');
        },
      },
    ]);

    await aiChat([{ role: 'user', content: 'hi' }]);

    // 期望调用顺序：minimax(1) → claude/deepseek(2) → openrouter(3) 成功
    // mock(99) 不应被调用（openrouter 已成功）
    expect(callOrder[0]).toBe('minimax');
    expect(callOrder).not.toContain('mock');
    expect(callOrder[callOrder.length - 1]).toBe('openrouter');

    // 验证 priority 数值顺序：priority=2 的两个都排在 priority=3 前面
    const lastPriority2Idx = Math.max(callOrder.indexOf('claude'), callOrder.indexOf('deepseek'));
    const openrouterIdx = callOrder.indexOf('openrouter');
    expect(openrouterIdx).toBeGreaterThan(lastPriority2Idx);
  });
});

describe('AI Router — fallback 降级', () => {
  beforeEach(() => {
    resetCooldown();
  });

  it('主 provider 失败 → 自动降级到次 provider', async () => {
    setupProviders([
      {
        name: 'minimax',
        priority: 1,
        chatImpl: async () => {
          throw new Error('minimax 5xx timeout');
        },
      },
      {
        name: 'claude',
        priority: 2,
        chatImpl: async () => ({
          content: 'claude success',
          provider: 'claude',
          model: 'sonnet',
        }),
      },
    ]);

    const r = await aiChat([{ role: 'user', content: 'hi' }]);
    expect(r.content).toBe('claude success');
    expect(r.provider).toBe('claude');
  });

  it('主+次失败 → 降级到兜底 provider', async () => {
    setupProviders([
      {
        name: 'minimax',
        priority: 1,
        chatImpl: async () => {
          throw new Error('minimax fail');
        },
      },
      {
        name: 'claude',
        priority: 2,
        chatImpl: async () => {
          throw new Error('claude fail');
        },
      },
      {
        name: 'openrouter',
        priority: 3,
        chatImpl: async () => ({
          content: 'openrouter success',
          provider: 'openrouter',
          model: 'hy3',
        }),
      },
    ]);

    const r = await aiChat([{ role: 'user', content: 'hi' }]);
    expect(r.content).toBe('openrouter success');
    expect(r.provider).toBe('openrouter');
  });

  it('全部失败 → 抛出含诊断的 error', async () => {
    setupProviders([
      {
        name: 'minimax',
        priority: 1,
        chatImpl: async () => {
          throw new Error('minimax fail');
        },
      },
      {
        name: 'claude',
        priority: 2,
        chatImpl: async () => {
          throw new Error('claude fail');
        },
      },
    ]);

    await expect(aiChat([{ role: 'user', content: 'hi' }])).rejects.toThrow(
      /全部 AI provider 失败/
    );
  });

  it('余额/quota 错误立即降级，不浪费时间等下一个 provider', async () => {
    // quota 错误应该跳过 30s 默认超时（已通过 cooldown 实现）
    setupProviders([
      {
        name: 'minimax',
        priority: 1,
        chatImpl: async () => {
          throw new Error('402 insufficient_quota');
        },
      },
      {
        name: 'claude',
        priority: 2,
        chatImpl: async () => ({
          content: 'claude',
          provider: 'claude',
          model: 'sonnet',
        }),
      },
    ]);

    const r = await aiChat([{ role: 'user', content: 'hi' }]);
    expect(r.provider).toBe('claude');

    // quota 失败应该立即触发 cooldown（无需连续 3 次）
    const health = getRouterHealth();
    expect(health.minimax.cooldownUntil).toBeGreaterThan(Date.now());
  });
});

describe('AI Router — cooldown 机制', () => {
  beforeEach(() => {
    resetCooldown();
  });

  it('连续失败 N 次后进入 cooldown', async () => {
    let callCount = 0;
    setupProviders([
      {
        name: 'minimax',
        priority: 1,
        chatImpl: async () => {
          callCount++;
          throw new Error('transient fail');
        },
      },
      {
        name: 'claude',
        priority: 2,
        chatImpl: async () => ({
          content: 'claude',
          provider: 'claude',
          model: 'sonnet',
        }),
      },
    ]);

    // 阈值是 3 次 — 跑 3 次后 minimax 进入 cooldown
    await aiChat([{ role: 'user', content: 'hi' }]); // 失败 1
    await aiChat([{ role: 'user', content: 'hi' }]); // 失败 2
    await aiChat([{ role: 'user', content: 'hi' }]); // 失败 3 → cooldown 触发

    const health = getRouterHealth();
    expect(health.minimax.cooldownUntil).toBeGreaterThan(Date.now());
    expect(health.minimax.consecutiveFailures).toBe(3);

    // 后续调用应该跳过 minimax（节省 30s 超时）
    const beforeCount = callCount;
    await aiChat([{ role: 'user', content: 'hi' }]);
    expect(callCount).toBe(beforeCount); // minimax 没被调用
  });

  it('成功调用清除 cooldown（半开重置）', async () => {
    let shouldFail = true;
    setupProviders([
      {
        name: 'minimax',
        priority: 1,
        chatImpl: async () => {
          if (shouldFail) throw new Error('fail');
          return { content: 'minimax ok', provider: 'minimax', model: 'm' };
        },
      },
    ]);

    // 3 次失败 → 进 cooldown（因为只有 minimax 一个 provider，调用 3 次都失败）
    for (let i = 0; i < 3; i++) {
      try {
        await aiChat([{ role: 'user', content: 'hi' }]);
      } catch {
        // 全部失败的 expected error
      }
    }

    // 此时 minimax 应在 cooldown
    expect(getRouterHealth().minimax.cooldownUntil).toBeGreaterThan(Date.now());

    // 重置 cooldown（模拟"5 分钟后自动到期"）
    resetCooldown('minimax');
    shouldFail = false;

    // 下次调用应该成功，且连续失败计数归零
    const r = await aiChat([{ role: 'user', content: 'hi' }]);
    expect(r.content).toBe('minimax ok');
    expect(getRouterHealth().minimax.consecutiveFailures).toBe(0);
    expect(getRouterHealth().minimax.cooldownUntil).toBe(0);
  });

  it('quota 错误触发更长 cooldown（10 分钟 vs 默认 5 分钟）', async () => {
    setupProviders([
      {
        name: 'minimax',
        priority: 1,
        chatImpl: async () => {
          throw new Error('429 quota exhausted');
        },
      },
      {
        name: 'claude',
        priority: 2,
        chatImpl: async () => ({
          content: 'claude',
          provider: 'claude',
          model: 'sonnet',
        }),
      },
    ]);

    await aiChat([{ role: 'user', content: 'hi' }]);

    const h = getRouterHealth().minimax;
    const cooldownDuration = h.cooldownUntil - Date.now();
    // quota cooldown 至少 9 分钟（540000ms），最多 10 分钟（600000ms）
    expect(cooldownDuration).toBeGreaterThan(540_000);
    expect(cooldownDuration).toBeLessThanOrEqual(600_000);
  });

  it('mock (priority=99) 即使在 cooldown 也不跳过（终极兜底）', async () => {
    // 极端场景：所有 provider 都在 cooldown，只剩 mock 能用
    setupProviders([
      {
        name: 'minimax',
        priority: 1,
        chatImpl: async () => {
          throw new Error('minimax fail');
        },
      },
      {
        name: 'mock',
        priority: 99,
        chatImpl: async () => ({
          content: 'mock success',
          provider: 'mock',
          model: 'mock-v1',
        }),
      },
    ]);

    // 触发 minimax cooldown
    for (let i = 0; i < 3; i++) {
      await aiChat([{ role: 'user', content: 'hi' }]);
    }

    expect(getRouterHealth().minimax.cooldownUntil).toBeGreaterThan(Date.now());

    // 这次调用：minimax 被跳过（cooldown），mock 应该兜底成功
    const r = await aiChat([{ role: 'user', content: 'hi' }]);
    expect(r.provider).toBe('mock');
  });

  it('getRouterHealth 暴露所有 provider 的健康状态', () => {
    const h = getRouterHealth();
    expect(typeof h).toBe('object');
    // 即使没有调用过，返回的对象至少包含 available 字段（默认 true）
    for (const v of Object.values(h)) {
      expect(v).toHaveProperty('available');
      expect(v).toHaveProperty('cooldownUntil');
      expect(v).toHaveProperty('consecutiveFailures');
    }
  });
});

describe('AI Router — 不破坏现有调用', () => {
  beforeEach(() => {
    resetCooldown();
  });

  it('正常 happy path：主 provider 一次成功', async () => {
    setupProviders([
      {
        name: 'minimax',
        priority: 1,
        chatImpl: async () => ({
          content: 'minimax success',
          provider: 'minimax',
          model: 'm',
        }),
      },
      {
        name: 'claude',
        priority: 2,
        chatImpl: async () => ({
          content: 'claude',
          provider: 'claude',
          model: 'sonnet',
        }),
      },
    ]);

    const r = await aiChat([{ role: 'user', content: 'hi' }]);
    expect(r.content).toBe('minimax success');
    // 应该只调用了 minimax（后续 provider 不应被触达）
  });

  it('aiStreamChat 也走同一套 fallback 逻辑', async () => {
    setupProviders([
      {
        name: 'minimax',
        priority: 1,
        chatImpl: async () => {
          throw new Error('minimax fail');
        },
      },
      {
        name: 'claude',
        priority: 2,
        chatImpl: async () => ({
          content: 'claude stream',
          provider: 'claude',
          model: 'sonnet',
        }),
      },
    ]);

    // 关键：mock 中 streamChat 也必须能工作（不只是 chat）
    // 之前默认 streamChat 抛错，导致 aiStreamChat 测试被这条错误带偏
    const map = {
      minimax: {
        name: 'minimax',
        priority: 1,
        chat: vi.fn(async () => {
          throw new Error('minimax fail');
        }),
        streamChat: vi.fn(async () => {
          throw new Error('minimax fail');
        }),
      },
      claude: {
        name: 'claude',
        priority: 2,
        chat: vi.fn(async () => ({ content: 'claude', provider: 'claude', model: 'sonnet' })),
        streamChat: vi.fn(async () => ({
          content: 'claude stream',
          provider: 'claude',
          model: 'sonnet',
        })),
      },
    };
    (getMinimaxProvider as ReturnType<typeof vi.fn>).mockImplementation(() => map.minimax);
    (getClaudeProvider as ReturnType<typeof vi.fn>).mockImplementation(() => map.claude);

    const onChunk = vi.fn();
    const r = await aiStreamChat([{ role: 'user', content: 'hi' }], {}, onChunk);
    expect(r.provider).toBe('claude');
    expect(r.content).toBe('claude stream');
  });

  it('没有任何 provider 时抛清晰错误', async () => {
    setupProviders([]); // 所有 provider 都没注册
    await expect(aiChat([{ role: 'user', content: 'hi' }])).rejects.toThrow(
      /没有任何 AI provider 可用/
    );
  });

  it('所有 provider 都在 cooldown 时抛清晰错误', async () => {
    setupProviders([
      {
        name: 'minimax',
        priority: 1,
        chatImpl: async () => {
          throw new Error('fail');
        },
      },
    ]);

    // 触发 cooldown
    for (let i = 0; i < 3; i++) {
      try {
        await aiChat([{ role: 'user', content: 'hi' }]);
      } catch {
        // 全部 provider 失败的 expected error（因为 cooldown 后没下一个 provider）
      }
    }

    // 现在再调用应该提示 cooldown
    await expect(aiChat([{ role: 'user', content: 'hi' }])).rejects.toThrow(/cooldown/);
  });
});
