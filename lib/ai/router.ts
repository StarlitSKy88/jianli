/**
 * AI Router — 三层兜底 + 智能降级
 *
 * 优先级（按 priority 升序）：
 *   1. minimax   — 主 provider（成本最低/性能最好）
 *   2. claude    — 次 provider（minimax 失败时降级）
 *   3. openrouter — 兜底 provider（用 fetch，多 free 模型自动 failover）
 *   4. deepseek  — 备用 provider
 *   99. mock     — 测试终极兜底（USE_MOCK_AI=1 时启用）
 *
 * 智能降级（Phase 14.23 新增）：
 *   - provider 失败计数累计，连续 N 次失败进入 cooldown（5 分钟）
 *   - cooldown 期间跳过该 provider，下次直接试下一个
 *   - cooldown 到期后自动"半开"重试：成功则恢复，失败则重新进入 cooldown
 *   - 余额/配额错误（402/429/insufficient_quota）立即触发更长 cooldown（10 分钟）
 *
 * 可观测性（Phase 14.23 新增）：
 *   - 每次调用记录 attempt 链路：[provider] → [fail reason] → [cooldown end time]
 *   - console.info 暴露 "为什么这次走到了 provider X"
 */
import type {
  AiProvider,
  ChatMessage,
  ChatOptions,
  ChatResult,
  StreamChunk,
} from './providers/types';
import { getMinimaxProvider } from './providers/minimax';
import { getClaudeProvider } from './providers/claude';
import { getDeepSeekProvider } from './providers/deepseek';
import { getOpenRouterProvider } from './providers/openrouter';
import { getMockProvider } from './providers/mock';
import { withLLMSlot } from './concurrency';

export type ProviderName = 'minimax' | 'claude' | 'deepseek' | 'openrouter' | 'mock';

interface RouteEntry {
  name: ProviderName;
  factory: () => AiProvider | null;
}

// Phase 14.23：注册表保留（用于 enabledProviders 发现 + 排序）
// 不再硬编码顺序 —— 由 priority 字段决定
const PROVIDERS: RouteEntry[] = [
  { name: 'minimax', factory: getMinimaxProvider },
  { name: 'claude', factory: getClaudeProvider },
  { name: 'deepseek', factory: getDeepSeekProvider },
  { name: 'openrouter', factory: getOpenRouterProvider },
  { name: 'mock', factory: getMockProvider },
];

export interface RouterOptions extends ChatOptions {
  signal?: AbortSignal;
  /**
   * 强制指定 provider 名称（跳过 priority 排序）
   *
   * 用例：
   *   - 漂移检测脚本 `anchor-vs-ai.ts --agent=mock` 想隔离真实 AI quota
   *   - 调试时强制走某个 provider
   *
   * 注意：仍会走 fallback 链（如果指定 provider 失败）— 这是有意的，
   *       否则一个 quota 错误就完全阻断脚本。
   *       想"硬切"请配合 cooldown 一起用：`resetCooldown('minimax')` 后再指定
   */
  provider?: ProviderName;
}

/**
 * Cooldown 配置
 *
 * - THRESHOLD: 连续失败 N 次后进入 cooldown
 * - BASE_DURATION_MS: cooldown 默认时长
 * - QUOTA_DURATION_MS: 余额/配额错误专属更长 cooldown
 */
const COOLDOWN_CONFIG = {
  THRESHOLD: 3, // 连续失败 3 次 → 进 cooldown
  BASE_DURATION_MS: 5 * 60 * 1000, // 5 分钟
  QUOTA_DURATION_MS: 10 * 60 * 1000, // 10 分钟（quota/余额错误）
};

interface ProviderHealth {
  consecutiveFailures: number;
  cooldownUntil: number; // 0 = 不在 cooldown
  totalSuccess: number;
  totalFailures: number;
}

/**
 * Provider 健康状态表（in-memory）
 *
 * 注意：单实例内存。EdgeOne Pages 多实例时各自独立，但 cooldown 是"自我保护"，
 * 跨实例不需要严格一致 — 每个实例学到一次即可。
 */
const health: Map<string, ProviderHealth> = new Map();

function getHealth(name: string): ProviderHealth {
  let h = health.get(name);
  if (!h) {
    h = { consecutiveFailures: 0, cooldownUntil: 0, totalSuccess: 0, totalFailures: 0 };
    health.set(name, h);
  }
  return h;
}

function isInCooldown(name: string, now: number): boolean {
  const h = getHealth(name);
  return h.cooldownUntil > now;
}

/**
 * 判断错误是否属于"quota/余额"类（应触发更长 cooldown + 立即降级）
 */
function isQuotaError(msg: string): boolean {
  return /402|429|insufficient_quota|quota|billing|balance/i.test(msg);
}

function recordFailure(name: string, err: Error): { cooldownUntil: number; isQuota: boolean } {
  const h = getHealth(name);
  h.consecutiveFailures += 1;
  h.totalFailures += 1;
  const isQuota = isQuotaError(err.message);
  if (h.consecutiveFailures >= COOLDOWN_CONFIG.THRESHOLD || isQuota) {
    const duration = isQuota ? COOLDOWN_CONFIG.QUOTA_DURATION_MS : COOLDOWN_CONFIG.BASE_DURATION_MS;
    h.cooldownUntil = Date.now() + duration;
    const reason = isQuota ? 'quota' : `${h.consecutiveFailures} consecutive failures`;
    console.warn(
      `[ai-router] ${name} 进入 cooldown ${duration / 1000}s（${reason}），until ${new Date(h.cooldownUntil).toISOString()}`
    );
    return { cooldownUntil: h.cooldownUntil, isQuota };
  }
  return { cooldownUntil: 0, isQuota: false };
}

function recordSuccess(name: string): void {
  const h = getHealth(name);
  h.consecutiveFailures = 0;
  h.cooldownUntil = 0; // 成功后清除 cooldown（半开重置）
  h.totalSuccess += 1;
}

/**
 * 获取所有已启用的 providers，按 priority 升序排序
 *
 * 关键：mock 的 priority=99 会自动排到最末尾，
 * 即使误开 USE_MOCK_AI 也不会抢占真实 provider
 */
function enabledProviders(): AiProvider[] {
  const list: AiProvider[] = [];
  for (const entry of PROVIDERS) {
    const p = entry.factory();
    if (p) list.push(p);
  }
  list.sort((a, b) => a.priority - b.priority);
  return list;
}

/**
 * 过滤掉当前在 cooldown 的 provider
 *
 * 注意：mock (priority=99) 即使在 cooldown 也不跳过 — 它就是兜底中的兜底
 */
function filterAvailable(providers: AiProvider[], now: number): AiProvider[] {
  return providers.filter((p) => p.priority === 99 || !isInCooldown(p.name, now));
}

/**
 * 导出健康状态（用于管理面板 / 调试端点）
 */
export function getRouterHealth(): Record<string, ProviderHealth & { available: boolean }> {
  const now = Date.now();
  const result: Record<string, ProviderHealth & { available: boolean }> = {};
  for (const [name, h] of health.entries()) {
    result[name] = { ...h, available: h.cooldownUntil <= now };
  }
  return result;
}

/**
 * 手动重置 cooldown（admin 工具 / 测试 helper）
 */
export function resetCooldown(name?: string): void {
  if (name) {
    health.delete(name);
  } else {
    health.clear();
  }
}

export async function aiChat(messages: ChatMessage[], opts?: RouterOptions): Promise<ChatResult> {
  return withLLMSlot(async () => {
    const allProviders = enabledProviders();
    if (allProviders.length === 0) {
      throw new Error('没有任何 AI provider 可用 — 请配置 API keys');
    }

    const now = Date.now();
    let available = filterAvailable(allProviders, now);
    if (available.length === 0) {
      throw new Error('所有 AI provider 都在 cooldown 中 — 请稍后重试或检查 quota');
    }

    // Bug-008 修复：USE_MOCK_AI=1 且未显式 opts.provider → 强制只调 mock
    // 之前行为:mock 加入候选池但按 priority 排最后,真实 provider 没 cooldown
    //   时直接被选中,真实 AI 返回 <think>...CoT 污染评分
    // 现在行为:测试环境用 USE_MOCK_AI=1 就是"只用 mock",不再回退到真实 AI
    if (process.env.USE_MOCK_AI === '1' && !opts?.provider) {
      const mockOnly = available.filter((p) => p.name === 'mock');
      if (mockOnly.length === 0) {
        throw new Error('USE_MOCK_AI=1 但 mock provider 不可用');
      }
      available = mockOnly;
      console.info(
        `[ai-router] USE_MOCK_AI=1 → 强制只用 mock (跳过其他 ${available.length - 1} 个 provider)`
      );
    }

    // 强制指定 provider：把它移到可用列表最前面
    // 用例：anchor-vs-ai.ts --agent=mock 想隔离真实 quota
    // 仍走 fallback 链（如果指定 provider 抛错），保证不阻断
    if (opts?.provider) {
      const forced = available.find((p) => p.name === opts.provider);
      if (forced) {
        available = [forced, ...available.filter((p) => p.name !== opts.provider)];
        console.info(`[ai-router] forced provider=${opts.provider}（移到可用列表最前）`);
      } else {
        console.warn(
          `[ai-router] opts.provider=${opts.provider} 但未在 enabledProviders 中找到（可能 USE_MOCK_AI=1 未开）— 忽略`
        );
      }
    }

    let lastErr: Error | null = null;
    let lastCooldownProvider: { name: string; until: number; isQuota: boolean } | null = null;

    for (const p of available) {
      try {
        console.info(`[ai-router] attempt ${p.name} (priority=${p.priority})`);
        const result = await p.chat(messages, opts);
        recordSuccess(p.name);
        console.info(`[ai-router] ${p.name}.chat ✓ ${result.content.length} chars`);
        return result;
      } catch (e) {
        const err = e as Error;
        lastErr = err;
        const { cooldownUntil, isQuota } = recordFailure(p.name, err);
        console.warn(`[ai-router] ${p.name}.chat ✗ ${err.message.slice(0, 120)}`);

        if (cooldownUntil > 0) {
          lastCooldownProvider = { name: p.name, until: cooldownUntil, isQuota };
        }

        // Quota/余额错误：跳过 cooldown 直接降级到下一个（避免无意义等待）
        // 但仍记录 cooldown —— 下次调用就不会再试这个 provider
        if (isQuota) {
          continue;
        }
      }
    }

    // 全部失败 — 暴露详细诊断
    const diagnosis = lastCooldownProvider
      ? ` 最近 cooldown: ${lastCooldownProvider.name} until ${new Date(lastCooldownProvider.until).toISOString()}` +
        (lastCooldownProvider.isQuota ? ' (quota/billing 错误)' : '')
      : '';
    throw new Error(`全部 AI provider 失败：${lastErr?.message || 'unknown'}.${diagnosis}`);
  });
}

export async function aiStreamChat(
  messages: ChatMessage[],
  opts?: RouterOptions,
  onChunk?: (chunk: StreamChunk) => void
): Promise<ChatResult> {
  return withLLMSlot(async () => {
    const allProviders = enabledProviders();
    if (allProviders.length === 0) {
      onChunk?.({ type: 'error', error: '没有任何 AI provider 可用' });
      throw new Error('No AI provider available');
    }

    const now = Date.now();
    let available = filterAvailable(allProviders, now);
    if (available.length === 0) {
      onChunk?.({ type: 'error', error: '所有 AI provider 都在 cooldown 中' });
      throw new Error('All AI providers in cooldown');
    }

    // 强制指定 provider（与 aiChat 保持一致）
    if (opts?.provider) {
      const forced = available.find((p) => p.name === opts.provider);
      if (forced) {
        available = [forced, ...available.filter((p) => p.name !== opts.provider)];
        console.info(`[ai-router] forced provider=${opts.provider}（stream 模式）`);
      }
    }

    let lastErr: Error | null = null;
    for (const p of available) {
      try {
        console.info(`[ai-router] stream attempt ${p.name} (priority=${p.priority})`);
        const r = await p.streamChat(messages, opts, onChunk);
        recordSuccess(p.name);
        return r;
      } catch (e) {
        const err = e as Error;
        lastErr = err;
        const { cooldownUntil, isQuota } = recordFailure(p.name, err);
        console.warn(`[ai-router] ${p.name}.streamChat ✗ ${err.message.slice(0, 120)}`);
        if (cooldownUntil > 0) {
          console.warn(
            `[ai-router] ${p.name} cooldown until ${new Date(cooldownUntil).toISOString()}`
          );
        }
        if (isQuota) continue;
      }
    }
    throw new Error(`全部 AI provider 失败：${lastErr?.message || 'unknown'}`);
  });
}
