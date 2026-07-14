/**
 * AI Provider 配置运行时存储
 *
 * 设计：
 * - 启动时从 .env 加载默认值
 * - 运行时可通过管理后台修改（key/model/enabled）
 * - 优先使用内存配置，回退到 env
 *
 * 注意：key 在内存中明文，但 GET API 永远不返回完整 key（只显示后 4 位）
 */
import { getMinimaxProvider } from './providers/minimax';
import { getClaudeProvider } from './providers/claude';
import { getDeepSeekProvider } from './providers/deepseek';

export interface ProviderConfig {
  id: 'minimax' | 'claude' | 'deepseek';
  enabled: boolean;
  model: string;
  baseURL: string;
  /** key 后 4 位（API 返回用），完整 key 不外泄 */
  keyFingerprint: string;
  /** 是否在 env 中配置 */
  hasEnvKey: boolean;
}

interface RuntimeState {
  enabled: boolean;
  model: string;
  baseURL: string;
  keyOverride?: string;
}

const state: Record<'minimax' | 'claude' | 'deepseek', RuntimeState> = {
  minimax: {
    enabled: true,
    model: process.env.MINIMAX_MODEL || 'MiniMax-M3',
    baseURL: process.env.MINIMAX_BASE_URL || 'https://api.MiniMax.chat/v1',
  },
  claude: {
    enabled: true,
    model: 'claude-sonnet-4-5',
    baseURL: 'https://api.anthropic.com',
  },
  deepseek: {
    enabled: true,
    model: 'deepseek-chat',
    baseURL: 'https://api.deepseek.com/v1',
  },
};

function fingerprint(key: string | undefined): string {
  if (!key) return '****';
  return `****${key.slice(-4)}`;
}

function effectiveKey(id: 'minimax' | 'claude' | 'deepseek'): string | undefined {
  const s = state[id];
  if (s.keyOverride) return s.keyOverride;
  if (id === 'minimax') return process.env.MINIMAX_API_KEY;
  if (id === 'claude') return process.env.ANTHROPIC_API_KEY;
  if (id === 'deepseek') return process.env.DEEPSEEK_API_KEY;
  return undefined;
}

export function listProviders(): ProviderConfig[] {
  const ids: Array<'minimax' | 'claude' | 'deepseek'> = ['minimax', 'claude', 'deepseek'];
  return ids.map((id) => {
    const s = state[id];
    const key = effectiveKey(id);
    return {
      id,
      enabled: s.enabled,
      model: s.model,
      baseURL: s.baseURL,
      keyFingerprint: fingerprint(key),
      hasEnvKey: !!key,
    };
  });
}

export function getProviderConfig(id: 'minimax' | 'claude' | 'deepseek'): ProviderConfig | null {
  return listProviders().find((p) => p.id === id) || null;
}

export interface UpdateInput {
  enabled?: boolean;
  model?: string;
  baseURL?: string;
  apiKey?: string;
}

export function updateProvider(
  id: 'minimax' | 'claude' | 'deepseek',
  input: UpdateInput
): ProviderConfig {
  const s = state[id];
  if (input.enabled !== undefined) s.enabled = input.enabled;
  if (input.model !== undefined) s.model = input.model;
  if (input.baseURL !== undefined) s.baseURL = input.baseURL;
  if (input.apiKey !== undefined && input.apiKey !== '') s.keyOverride = input.apiKey;
  // 关闭后清掉 override（避免下次重启时残留）
  if (input.enabled === false) s.keyOverride = undefined;

  return getProviderConfig(id)!;
}

/**
 * 给 factory 函数用：判断某个 provider 当前是否启用 + 提供 key/model
 */
export function isProviderEnabled(id: 'minimax' | 'claude' | 'deepseek'): boolean {
  if (!state[id].enabled) return false;
  return !!effectiveKey(id);
}

/** 测试 provider 连通性（chat with minimal token） */
export async function testProvider(
  id: 'minimax' | 'claude' | 'deepseek'
): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const t0 = Date.now();
  try {
    // 直接复用现有 factory 拿 provider（key 来自 env 或 override）
    let p;
    if (id === 'minimax') p = getMinimaxProvider();
    else if (id === 'claude') p = getClaudeProvider();
    else p = getDeepSeekProvider();
    if (!p) return { ok: false, latencyMs: 0, error: '未配置 key' };

    const r = await p.chat([{ role: 'user', content: 'ping' }], { maxTokens: 5, temperature: 0 });
    return { ok: !!r.content, latencyMs: Date.now() - t0 };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - t0, error: (e as Error).message };
  }
}
