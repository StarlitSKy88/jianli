/**
 * AI Provider 抽象接口
 *
 * 所有 Provider 必须实现：
 * - chat(messages)        单次返回
 * - streamChat(messages)   流式（用于面试对话的"打字机"效果）
 * - name                   provider 标识（用于日志/路由）
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  modelOverride?: string;
  signal?: AbortSignal;
}

export interface ChatResult {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  provider: string;
  model: string;
}

export interface StreamChunk {
  type: 'content' | 'done' | 'error';
  content?: string;
  error?: string;
  usage?: ChatResult['usage'];
}

export interface AiProvider {
  readonly name: string;
  chat(messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResult>;
  streamChat(
    messages: ChatMessage[],
    opts?: ChatOptions,
    onChunk?: (chunk: StreamChunk) => void
  ): Promise<ChatResult>;
}
