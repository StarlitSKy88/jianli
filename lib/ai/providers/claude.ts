/**
 * Claude Provider — 兜底 Provider（优先级 2）
 * 直接走 Anthropic API（非 OpenAI 兼容）
 */
import Anthropic from '@anthropic-ai/sdk';
import type { AiProvider, ChatMessage, ChatOptions, ChatResult } from './types';

let _instance: ClaudeProvider | null = null;

export class ClaudeProvider implements AiProvider {
  readonly name = 'claude';
  /** 2 = 次 provider（minimax 失败时降级） */
  readonly priority = 2;
  private client: Anthropic;
  private defaultModel = 'claude-sonnet-4-5';

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
    const sysMsg = messages.find((m) => m.role === 'system');
    const convMsgs = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const r = await this.client.messages.create({
      model: opts.modelOverride || this.defaultModel,
      system: sysMsg?.content,
      messages: convMsgs,
      max_tokens: opts.maxTokens || 4096,
      temperature: opts.temperature ?? 0.7,
    });

    const content = r.content[0]?.type === 'text' ? r.content[0].text : '';
    return {
      content,
      usage: {
        promptTokens: r.usage.input_tokens,
        completionTokens: r.usage.output_tokens,
        totalTokens: r.usage.input_tokens + r.usage.output_tokens,
      },
      provider: this.name,
      model: r.model,
    };
  }

  async streamChat(): Promise<ChatResult> {
    throw new Error('Claude streaming 暂未实现 — 使用 chat');
  }
}

export function getClaudeProvider(): ClaudeProvider | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  if (!_instance) _instance = new ClaudeProvider(apiKey);
  return _instance;
}
