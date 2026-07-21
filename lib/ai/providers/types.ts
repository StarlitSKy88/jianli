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
  /**
   * 优先级（数字越小越优先）。Router 按 priority 升序遍历。
   * - 1: 主 provider（成本最低/性能最好）
   * - 2: 次 provider（主失败时降级）
   * - 3: 兜底 provider（次也失败时）
   * - 99: mock（仅 USE_MOCK_AI=1 时启用，最终兜底）
   */
  readonly priority: number;
  chat(messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResult>;
  streamChat(
    messages: ChatMessage[],
    opts?: ChatOptions,
    onChunk?: (chunk: StreamChunk) => void
  ): Promise<ChatResult>;
}
