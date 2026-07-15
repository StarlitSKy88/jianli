/**
 * OpenRouter Provider — 通过 fetch 直接调用
 *
 * 为什么不用 OpenAI SDK?
 *   - OpenRouter 需要 reasoning_effort / stream_options 等 SDK 没暴露的参数
 *   - OpenAI SDK union type 流式响应处理麻烦
 *   - 直接 fetch 完全可控 + 不依赖 SDK 版本
 *
 * 默认模型：tencent/hy3:free（腾讯混元 Hy3，free 2.6s 延迟 44 tps）
 * 注意：tencent/hy3:free 2026-07-21 下线，届时需切换 paid 或其他 free 模型
 */
import type { AiProvider, ChatMessage, ChatOptions, ChatResult, StreamChunk } from './types';

interface OpenRouterPayload {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  reasoning_effort?: 'low' | 'high' | 'no';
}

interface OpenRouterResponse {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string | null };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

class OpenRouterProvider implements AiProvider {
  readonly name = 'openrouter';
  private readonly apiKey: string;
  private readonly baseURL = 'https://openrouter.ai/api/v1';
  private readonly defaultModel: string;
  private readonly extraHeaders: Record<string, string>;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.defaultModel = process.env.OPENROUTER_MODEL ?? 'tencent/hy3:free';
    this.extraHeaders = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL ?? 'https://jianli.taomyst.top',
      'X-Title': 'Interview Buddy',
    };
  }

  private buildPayload(messages: ChatMessage[], opts: ChatOptions): OpenRouterPayload {
    const payload: OpenRouterPayload = {
      model: opts.modelOverride || this.defaultModel,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.maxTokens ?? 1024,
    };
    // Hy3 默认 reasoning，会把内部思考塞 content 里；显式设 low 让它只输出回答
    if (this.defaultModel.includes('hy3') || this.defaultModel.includes('hunyuan')) {
      payload.reasoning_effort = 'low';
    }
    return payload;
  }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
    const payload = { ...this.buildPayload(messages, opts), stream: false };
    const r = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: this.extraHeaders,
      body: JSON.stringify(payload),
      // Node 18+ fetch timeout via AbortSignal
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) {
      const errText = await r.text();
      throw new Error(`[openrouter] ${r.status} ${r.statusText}: ${errText.slice(0, 200)}`);
    }
    const data = (await r.json()) as OpenRouterResponse;
    const choice = data.choices?.[0];
    if (!choice) throw new Error('[openrouter] No choice in response');
    return {
      content: choice.message.content || '',
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
          }
        : undefined,
      provider: this.name,
      model: data.model,
    };
  }

  async streamChat(
    messages: ChatMessage[],
    opts: ChatOptions = {},
    onChunk?: (chunk: StreamChunk) => void
  ): Promise<ChatResult> {
    const payload = { ...this.buildPayload(messages, opts), stream: true };
    const r = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: this.extraHeaders,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60_000),
    });
    if (!r.ok) {
      const errText = await r.text();
      onChunk?.({ type: 'error', error: `HTTP ${r.status}: ${errText.slice(0, 200)}` });
      throw new Error(`[openrouter] ${r.status} ${r.statusText}: ${errText.slice(0, 200)}`);
    }
    if (!r.body) {
      throw new Error('[openrouter] No response body');
    }

    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';
    let usage: ChatResult['usage'] | undefined;
    let modelName = this.defaultModel;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE：每行以 "data: " 开头
      let lineEnd;
      while ((lineEnd = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, lineEnd);
        buffer = buffer.slice(lineEnd + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') {
          onChunk?.({ type: 'done', usage });
          return { content: full, usage, provider: this.name, model: modelName };
        }
        try {
          const parsed = JSON.parse(data) as {
            model?: string;
            choices: Array<{
              delta: { content?: string };
              finish_reason?: string;
            }>;
            usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
          };
          if (parsed.model) modelName = parsed.model;
          const delta = parsed.choices?.[0]?.delta?.content || '';
          if (delta) {
            full += delta;
            onChunk?.({ type: 'content', content: delta });
          }
          if (parsed.usage) {
            usage = {
              promptTokens: parsed.usage.prompt_tokens,
              completionTokens: parsed.usage.completion_tokens,
              totalTokens: parsed.usage.total_tokens,
            };
          }
        } catch {
          // ignore partial JSON
        }
      }
    }
    onChunk?.({ type: 'done', usage });
    return { content: full, usage, provider: this.name, model: modelName };
  }
}

let _instance: OpenRouterProvider | null = null;

export function getOpenRouterProvider(): OpenRouterProvider | null {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  if (!_instance) _instance = new OpenRouterProvider(apiKey);
  return _instance;
}
