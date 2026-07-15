/**
 * AI Router — 三层兜底
 *
 * 优先级（按 enabled 排序）：
 *   minimax → Claude → DeepSeek
 *
 * 任一失败 → 自动降级到下一个 → 全部失败抛错
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
import { withLLMSlot } from './concurrency';

export type ProviderName = 'minimax' | 'claude' | 'deepseek' | 'openrouter';

interface RouteEntry {
  name: ProviderName;
  factory: () => AiProvider | null;
}

const PROVIDERS: RouteEntry[] = [
  { name: 'minimax', factory: getMinimaxProvider },
  { name: 'openrouter', factory: getOpenRouterProvider },
  { name: 'claude', factory: getClaudeProvider },
  { name: 'deepseek', factory: getDeepSeekProvider },
];

export interface RouterOptions extends ChatOptions {
  signal?: AbortSignal;
}

/**
 * 获取所有已启用的 providers
 */
function enabledProviders(): AiProvider[] {
  const list: AiProvider[] = [];
  for (const entry of PROVIDERS) {
    const p = entry.factory();
    if (p) list.push(p);
  }
  return list;
}

export async function aiChat(messages: ChatMessage[], opts?: RouterOptions): Promise<ChatResult> {
  return withLLMSlot(async () => {
    const providers = enabledProviders();
    if (providers.length === 0) {
      throw new Error('没有任何 AI provider 可用 — 请配置 API keys');
    }

    let lastErr: Error | null = null;
    for (const p of providers) {
      try {
        const result = await p.chat(messages, opts);
        console.info(`[ai-router] ${p.name}.chat → ${result.content.length} chars`);
        return result;
      } catch (e) {
        lastErr = e as Error;
        console.warn(`[ai-router] ${p.name}.chat failed: ${(e as Error).message}`);
      }
    }

    throw new Error(`全部 AI provider 失败：${lastErr?.message || 'unknown'}`);
  });
}

export async function aiStreamChat(
  messages: ChatMessage[],
  opts?: RouterOptions,
  onChunk?: (chunk: StreamChunk) => void
): Promise<ChatResult> {
  return withLLMSlot(async () => {
    const providers = enabledProviders();
    if (providers.length === 0) {
      onChunk?.({ type: 'error', error: '没有任何 AI provider 可用' });
      throw new Error('No AI provider available');
    }

    let lastErr: Error | null = null;
    for (const p of providers) {
      try {
        return await p.streamChat(messages, opts, onChunk);
      } catch (e) {
        lastErr = e as Error;
        console.warn(`[ai-router] ${p.name}.streamChat failed: ${(e as Error).message}`);
      }
    }
    throw new Error(`全部 AI provider 失败：${lastErr?.message || 'unknown'}`);
  });
}
