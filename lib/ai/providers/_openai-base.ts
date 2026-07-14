/**
 * OpenAI 兼容 Provider 通用基类
 *
 * minimax / Claude (via proxy) / DeepSeek 都用这个模式
 */
import OpenAI from 'openai';
import type { AiProvider, ChatMessage, ChatOptions, ChatResult, StreamChunk } from './types';

export interface OpenAiCompatibleConfig {
  name: string;
  apiKey: string;
  baseURL: string;
  defaultModel: string;
}

export class OpenAiCompatible implements AiProvider {
  readonly name: string;
  private readonly client: OpenAI;
  private readonly defaultModel: string;

  constructor(config: OpenAiCompatibleConfig) {
    if (!config.apiKey) {
      throw new Error(`[${config.name}] API key 未配置`);
    }
    this.name = config.name;
    this.defaultModel = config.defaultModel;
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      timeout: 30_000,
    });
  }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
    const r = await this.client.chat.completions.create({
      model: opts.modelOverride || this.defaultModel,
      messages,
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.maxTokens,
      stream: false,
    });
    const choice = r.choices[0];
    if (!choice) throw new Error(`[${this.name}] No choice in response`);
    return {
      content: choice.message?.content || '',
      usage: r.usage
        ? {
            promptTokens: r.usage.prompt_tokens,
            completionTokens: r.usage.completion_tokens,
            totalTokens: r.usage.total_tokens,
          }
        : undefined,
      provider: this.name,
      model: r.model,
    };
  }

  async streamChat(
    messages: ChatMessage[],
    opts: ChatOptions = {},
    onChunk?: (chunk: StreamChunk) => void
  ): Promise<ChatResult> {
    const stream = await this.client.chat.completions.create({
      model: opts.modelOverride || this.defaultModel,
      messages,
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.maxTokens,
      stream: true,
    });

    let full = '';
    let usage: ChatResult['usage'] | undefined;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || '';
      if (delta) {
        full += delta;
        onChunk?.({ type: 'content', content: delta });
      }
      // OpenAI SDK 兼容层 usage 通常在最后一块
      const finalUsage = (
        chunk as unknown as {
          usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
        }
      ).usage;
      if (finalUsage) {
        usage = {
          promptTokens: finalUsage.prompt_tokens,
          completionTokens: finalUsage.completion_tokens,
          totalTokens: finalUsage.total_tokens,
        };
      }
    }

    onChunk?.({ type: 'done', usage });
    return { content: full, usage, provider: this.name, model: this.defaultModel };
  }
}
